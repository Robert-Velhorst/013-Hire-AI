import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { createAuditEvent } from "../db";
import {
  acceptWorkspaceInvitation,
  archiveWorkspace,
  changeWorkspaceMemberRole,
  createWorkspace,
  getWorkspaceDetail,
  inviteWorkspaceMember,
  listUserWorkspaces,
  removeWorkspaceMember,
  renameWorkspace,
  revokeWorkspaceInvitation,
  transferWorkspaceOwnership,
  WorkspaceError,
} from "../workspaceService";

const workspaceIdInput = z.number().int().positive();
const workspaceNameInput = z.string().trim().min(2).max(120);
const invitableRoleInput = z.enum(["admin", "member"]);

async function workspaceAction<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof WorkspaceError) {
      throw new TRPCError({ code: error.code, message: error.message });
    }
    throw error;
  }
}

async function auditWorkspaceAction(input: {
  userId: number;
  workspaceId: number;
  action: string;
  source: string;
  beforeState?: object;
  afterState?: object;
  riskLevel?: "low" | "medium" | "high" | "critical";
}) {
  await createAuditEvent({
    userId: input.userId,
    entityType: "workspace",
    entityId: input.workspaceId,
    action: input.action,
    actor: "user",
    source: input.source,
    beforeState: input.beforeState ? JSON.stringify(input.beforeState) : null,
    afterState: input.afterState ? JSON.stringify(input.afterState) : null,
    riskLevel: input.riskLevel ?? "medium",
  });
}

export const workspacesRouter = router({
  list: protectedProcedure.query(({ ctx }) => listUserWorkspaces(ctx.user.id)),

  detail: protectedProcedure
    .input(z.object({ workspaceId: workspaceIdInput }))
    .query(({ ctx, input }) => workspaceAction(() => getWorkspaceDetail(ctx.user.id, input.workspaceId))),

  create: protectedProcedure
    .input(z.object({ name: workspaceNameInput }))
    .mutation(async ({ ctx, input }) => {
      const workspace = await createWorkspace(ctx.user.id, input.name);
      await auditWorkspaceAction({
        userId: ctx.user.id,
        workspaceId: workspace.id,
        action: "workspace_created",
        source: "workspaces.create",
        afterState: { name: workspace.name, role: workspace.role, candidateDataShared: false },
      });
      return workspace;
    }),

  rename: protectedProcedure
    .input(z.object({ workspaceId: workspaceIdInput, name: workspaceNameInput }))
    .mutation(async ({ ctx, input }) => {
      const result = await workspaceAction(() => renameWorkspace(ctx.user.id, input.workspaceId, input.name));
      await auditWorkspaceAction({
        userId: ctx.user.id,
        workspaceId: input.workspaceId,
        action: "workspace_renamed",
        source: "workspaces.rename",
        afterState: { name: result.name },
      });
      return result;
    }),

  invite: protectedProcedure
    .input(z.object({
      workspaceId: workspaceIdInput,
      email: z.string().trim().email().max(320),
      role: invitableRoleInput,
    }))
    .mutation(async ({ ctx, input }) => {
      const invitation = await workspaceAction(() => inviteWorkspaceMember(
        ctx.user.id, input.workspaceId, input.email, input.role
      ));
      await auditWorkspaceAction({
        userId: ctx.user.id,
        workspaceId: input.workspaceId,
        action: "workspace_invitation_created",
        source: "workspaces.invite",
        afterState: { invitationId: invitation.invitationId, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt },
      });
      return invitation;
    }),

  acceptInvitation: protectedProcedure
    .input(z.object({ token: z.string().trim().min(32).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const result = await workspaceAction(() => acceptWorkspaceInvitation(
        ctx.user.id, ctx.user.email, input.token
      ));
      await auditWorkspaceAction({
        userId: ctx.user.id,
        workspaceId: result.workspaceId,
        action: "workspace_invitation_accepted",
        source: "workspaces.acceptInvitation",
        afterState: { existing: result.existing },
      });
      return result;
    }),

  revokeInvitation: protectedProcedure
    .input(z.object({ workspaceId: workspaceIdInput, invitationId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const result = await workspaceAction(() => revokeWorkspaceInvitation(
        ctx.user.id, input.workspaceId, input.invitationId
      ));
      await auditWorkspaceAction({
        userId: ctx.user.id,
        workspaceId: input.workspaceId,
        action: "workspace_invitation_revoked",
        source: "workspaces.revokeInvitation",
        afterState: { invitationId: input.invitationId },
      });
      return result;
    }),

  changeMemberRole: protectedProcedure
    .input(z.object({ workspaceId: workspaceIdInput, targetUserId: z.number().int().positive(), role: invitableRoleInput }))
    .mutation(async ({ ctx, input }) => {
      const result = await workspaceAction(() => changeWorkspaceMemberRole(
        ctx.user.id, input.workspaceId, input.targetUserId, input.role
      ));
      await auditWorkspaceAction({
        userId: ctx.user.id,
        workspaceId: input.workspaceId,
        action: "workspace_member_role_changed",
        source: "workspaces.changeMemberRole",
        afterState: { targetUserId: input.targetUserId, role: input.role },
        riskLevel: "high",
      });
      return result;
    }),

  removeMember: protectedProcedure
    .input(z.object({ workspaceId: workspaceIdInput, targetUserId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const result = await workspaceAction(() => removeWorkspaceMember(
        ctx.user.id, input.workspaceId, input.targetUserId
      ));
      await auditWorkspaceAction({
        userId: ctx.user.id,
        workspaceId: input.workspaceId,
        action: result.selfRemoval ? "workspace_member_left" : "workspace_member_removed",
        source: "workspaces.removeMember",
        afterState: { targetUserId: input.targetUserId },
        riskLevel: "high",
      });
      return result;
    }),

  transferOwnership: protectedProcedure
    .input(z.object({ workspaceId: workspaceIdInput, targetUserId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const result = await workspaceAction(() => transferWorkspaceOwnership(
        ctx.user.id, input.workspaceId, input.targetUserId
      ));
      await auditWorkspaceAction({
        userId: ctx.user.id,
        workspaceId: input.workspaceId,
        action: "workspace_ownership_transferred",
        source: "workspaces.transferOwnership",
        beforeState: { ownerUserId: result.previousOwnerUserId },
        afterState: { ownerUserId: result.ownerUserId },
        riskLevel: "critical",
      });
      return result;
    }),

  archive: protectedProcedure
    .input(z.object({ workspaceId: workspaceIdInput }))
    .mutation(async ({ ctx, input }) => {
      const result = await workspaceAction(() => archiveWorkspace(ctx.user.id, input.workspaceId));
      await auditWorkspaceAction({
        userId: ctx.user.id,
        workspaceId: input.workspaceId,
        action: "workspace_archived",
        source: "workspaces.archive",
        afterState: { status: result.status },
        riskLevel: "critical",
      });
      return result;
    }),
});
