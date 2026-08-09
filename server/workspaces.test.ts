import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { getAuditEventsForUser, getUserByOpenId, upsertUser } from "./db";
import { appRouter } from "./routers";
import { WORKSPACE_LIMITS } from "./workspaceService";

async function context(openId: string, email: string): Promise<TrpcContext> {
  await upsertUser({ openId, email, name: openId, role: "user" });
  const user = await getUserByOpenId(openId);
  if (!user) throw new Error("Test user was not created");
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

afterEach(() => vi.useRealTimers());

describe("workspace governance", () => {
  it("publishes bounded workload ceilings", () => {
    expect(WORKSPACE_LIMITS).toEqual({
      ownedPerUser: 20,
      membershipsPerUser: 100,
      membersPerWorkspace: 100,
      activeInvitationsPerWorkspace: 50,
    });
  });

  it("binds invitations to email, conceals other workspaces, and accepts once idempotently", async () => {
    const ownerContext = await context("workspace-owner-a", "owner-a@example.local");
    const memberContext = await context("workspace-member-a", "member-a@example.local");
    const outsiderContext = await context("workspace-outsider-a", "outsider-a@example.local");
    const owner = appRouter.createCaller(ownerContext);
    const member = appRouter.createCaller(memberContext);
    const outsider = appRouter.createCaller(outsiderContext);

    const workspace = await owner.workspaces.create({ name: "Candidate Operations" });
    expect(workspace).toMatchObject({ role: "owner", candidateDataShared: false });
    await expect(outsider.workspaces.detail({ workspaceId: workspace.id })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const invitation = await owner.workspaces.invite({
      workspaceId: workspace.id,
      email: "MEMBER-A@example.local",
      role: "member",
    });
    expect(invitation.token).toHaveLength(43);
    await expect(outsider.workspaces.acceptInvitation({ token: invitation.token })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(member.workspaces.acceptInvitation({ token: invitation.token })).resolves.toMatchObject({ workspaceId: workspace.id, existing: false });
    await expect(member.workspaces.acceptInvitation({ token: invitation.token })).resolves.toMatchObject({ workspaceId: workspace.id, existing: true });

    const detail = await owner.workspaces.detail({ workspaceId: workspace.id });
    expect(detail.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: memberContext.user!.id, role: "member" }),
    ]));
    expect(detail.invitations).toEqual([]);
    expect(JSON.stringify(detail)).not.toContain(invitation.token);
    await owner.workspaces.invite({ workspaceId: workspace.id, email: "pending-a@example.local", role: "member" });
    const memberDetail = await member.workspaces.detail({ workspaceId: workspace.id });
    expect(memberDetail.candidateDataShared).toBe(false);
    expect(memberDetail.invitations).toEqual([]);
  });

  it("enforces manager ceilings, owner-only role changes, and self-leave rules", async () => {
    const ownerContext = await context("workspace-owner-b", "owner-b@example.local");
    const adminContext = await context("workspace-admin-b", "admin-b@example.local");
    const memberContext = await context("workspace-member-b", "member-b@example.local");
    const owner = appRouter.createCaller(ownerContext);
    const admin = appRouter.createCaller(adminContext);
    const member = appRouter.createCaller(memberContext);
    const workspace = await owner.workspaces.create({ name: "Hiring Review" });

    const adminInvite = await owner.workspaces.invite({ workspaceId: workspace.id, email: adminContext.user!.email!, role: "admin" });
    const memberInvite = await owner.workspaces.invite({ workspaceId: workspace.id, email: memberContext.user!.email!, role: "member" });
    await admin.workspaces.acceptInvitation({ token: adminInvite.token });
    await member.workspaces.acceptInvitation({ token: memberInvite.token });

    await expect(admin.workspaces.invite({ workspaceId: workspace.id, email: "second-admin@example.local", role: "admin" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(admin.workspaces.changeMemberRole({ workspaceId: workspace.id, targetUserId: memberContext.user!.id, role: "admin" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(admin.workspaces.removeMember({ workspaceId: workspace.id, targetUserId: ownerContext.user!.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(member.workspaces.invite({ workspaceId: workspace.id, email: "blocked@example.local", role: "member" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await owner.workspaces.changeMemberRole({ workspaceId: workspace.id, targetUserId: memberContext.user!.id, role: "admin" });
    await expect(member.workspaces.removeMember({ workspaceId: workspace.id, targetUserId: memberContext.user!.id })).resolves.toMatchObject({ selfRemoval: true });
    await expect(owner.workspaces.removeMember({ workspaceId: workspace.id, targetUserId: ownerContext.user!.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("transfers exactly one owner and reserves archival for the new owner", async () => {
    const ownerContext = await context("workspace-owner-c", "owner-c@example.local");
    const successorContext = await context("workspace-successor-c", "successor-c@example.local");
    const owner = appRouter.createCaller(ownerContext);
    const successor = appRouter.createCaller(successorContext);
    const workspace = await owner.workspaces.create({ name: "Transfer Test" });
    const invitation = await owner.workspaces.invite({ workspaceId: workspace.id, email: successorContext.user!.email!, role: "member" });
    await successor.workspaces.acceptInvitation({ token: invitation.token });

    await owner.workspaces.transferOwnership({ workspaceId: workspace.id, targetUserId: successorContext.user!.id });
    const detail = await successor.workspaces.detail({ workspaceId: workspace.id });
    expect(detail.members.filter(item => item.role === "owner")).toEqual([
      expect.objectContaining({ userId: successorContext.user!.id }),
    ]);
    await expect(owner.workspaces.archive({ workspaceId: workspace.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(successor.workspaces.archive({ workspaceId: workspace.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await successor.workspaces.removeMember({ workspaceId: workspace.id, targetUserId: ownerContext.user!.id });
    await expect(successor.workspaces.archive({ workspaceId: workspace.id })).resolves.toEqual({ workspaceId: workspace.id, status: "archived" });
    await expect(successor.workspaces.detail({ workspaceId: workspace.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects revoked and expired invitation tokens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T08:00:00Z"));
    const ownerContext = await context("workspace-owner-d", "owner-d@example.local");
    const firstContext = await context("workspace-member-d1", "member-d1@example.local");
    const secondContext = await context("workspace-member-d2", "member-d2@example.local");
    const owner = appRouter.createCaller(ownerContext);
    const first = appRouter.createCaller(firstContext);
    const second = appRouter.createCaller(secondContext);
    const workspace = await owner.workspaces.create({ name: "Invitation Lifecycle" });
    const revoked = await owner.workspaces.invite({ workspaceId: workspace.id, email: firstContext.user!.email!, role: "member" });
    await owner.workspaces.revokeInvitation({ workspaceId: workspace.id, invitationId: revoked.invitationId });
    await expect(first.workspaces.acceptInvitation({ token: revoked.token })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    const expired = await owner.workspaces.invite({ workspaceId: workspace.id, email: secondContext.user!.email!, role: "member" });
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);
    await expect(second.workspaces.acceptInvitation({ token: expired.token })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("records governance actions without storing invitation plaintext in audit evidence", async () => {
    const ownerContext = await context("workspace-owner-e", "owner-e@example.local");
    const owner = appRouter.createCaller(ownerContext);
    const workspace = await owner.workspaces.create({ name: "Audited Workspace" });
    const invitation = await owner.workspaces.invite({ workspaceId: workspace.id, email: "audit-invite@example.local", role: "member" });
    const events = await getAuditEventsForUser(ownerContext.user!.id, 20);

    expect(events.map(event => event.action)).toEqual(expect.arrayContaining([
      "workspace_created",
      "workspace_invitation_created",
    ]));
    expect(JSON.stringify(events)).not.toContain(invitation.token);
  });
});
