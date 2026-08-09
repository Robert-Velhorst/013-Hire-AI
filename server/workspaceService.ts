import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gt, isNull } from "drizzle-orm";
import {
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
  type Workspace,
  type WorkspaceInvitation,
  type WorkspaceMember,
} from "../drizzle/schema";
import { getDb, getUserByEmail, getUserById } from "./db";

export type WorkspaceRole = "owner" | "admin" | "member";
export type InvitableWorkspaceRole = Exclude<WorkspaceRole, "owner">;
export type WorkspaceErrorCode = "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "PRECONDITION_FAILED";

export class WorkspaceError extends Error {
  constructor(public readonly code: WorkspaceErrorCode, message: string) {
    super(message);
  }
}

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const WORKSPACE_LIMITS = {
  ownedPerUser: 20,
  membershipsPerUser: 100,
  membersPerWorkspace: 100,
  activeInvitationsPerWorkspace: 50,
} as const;

const MAX_OWNED_WORKSPACES = WORKSPACE_LIMITS.ownedPerUser;
const MAX_USER_WORKSPACES = WORKSPACE_LIMITS.membershipsPerUser;
const MAX_WORKSPACE_MEMBERS = WORKSPACE_LIMITS.membersPerWorkspace;
const MAX_ACTIVE_INVITATIONS = WORKSPACE_LIMITS.activeInvitationsPerWorkspace;

type MemoryWorkspace = Workspace;
type MemoryMember = WorkspaceMember;
type MemoryInvitation = WorkspaceInvitation;

const memoryWorkspaces: MemoryWorkspace[] = [];
const memoryMembers: MemoryMember[] = [];
const memoryInvitations: MemoryInvitation[] = [];

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function resultInsertId(result: unknown) {
  const packet = Array.isArray(result) ? result[0] : result;
  return Number((packet as { insertId?: number } | undefined)?.insertId ?? 0);
}

function resultAffectedRows(result: unknown) {
  const packet = Array.isArray(result) ? result[0] : result;
  return Number((packet as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}

function workspaceView(workspace: Workspace, membership: WorkspaceMember) {
  return {
    id: workspace.id,
    name: workspace.name,
    status: workspace.status,
    role: membership.role,
    canManage: membership.role === "owner" || membership.role === "admin",
    canTransferOwnership: membership.role === "owner",
    candidateDataShared: false as const,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

async function requireActiveMembership(userId: number, workspaceId: number) {
  const db = await getDb();
  if (!db) {
    const workspace = memoryWorkspaces.find(item => item.id === workspaceId && item.status === "active");
    const membership = memoryMembers.find(item =>
      item.workspaceId === workspaceId && item.userId === userId && item.status === "active"
    );
    if (!workspace || !membership) throw new WorkspaceError("NOT_FOUND", "Workspace not found.");
    return { workspace, membership };
  }
  const row = (await db
    .select({ workspace: workspaces, membership: workspaceMembers })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
      eq(workspaceMembers.status, "active"),
      eq(workspaces.status, "active")
    ))
    .limit(1))[0];
  if (!row) throw new WorkspaceError("NOT_FOUND", "Workspace not found.");
  return row;
}

function requireManager(role: WorkspaceRole) {
  if (role !== "owner" && role !== "admin") {
    throw new WorkspaceError("FORBIDDEN", "Workspace manager access is required.");
  }
}

function requireOwner(role: WorkspaceRole) {
  if (role !== "owner") throw new WorkspaceError("FORBIDDEN", "Workspace owner access is required.");
}

export async function listUserWorkspaces(userId: number) {
  const db = await getDb();
  if (!db) {
    return memoryMembers
      .filter(member => member.userId === userId && member.status === "active")
      .flatMap(member => {
        const workspace = memoryWorkspaces.find(item => item.id === member.workspaceId && item.status === "active");
        return workspace ? [workspaceView(workspace, member)] : [];
      })
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, MAX_USER_WORKSPACES);
  }
  const rows = await db
    .select({ workspace: workspaces, membership: workspaceMembers })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(
      eq(workspaceMembers.userId, userId),
      eq(workspaceMembers.status, "active"),
      eq(workspaces.status, "active")
    ))
    .orderBy(asc(workspaces.name), asc(workspaces.id))
    .limit(MAX_USER_WORKSPACES);
  return rows.map(row => workspaceView(row.workspace, row.membership));
}

export async function createWorkspace(userId: number, name: string) {
  const db = await getDb();
  const now = new Date();
  if (!db) {
    if (memoryWorkspaces.filter(item => item.createdByUserId === userId && item.status === "active").length >= MAX_OWNED_WORKSPACES) {
      throw new WorkspaceError("PRECONDITION_FAILED", "The active workspace ownership limit has been reached.");
    }
    const workspace: MemoryWorkspace = {
      id: memoryWorkspaces.length + 1,
      name,
      createdByUserId: userId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    const membership: MemoryMember = {
      id: memoryMembers.length + 1,
      workspaceId: workspace.id,
      userId,
      role: "owner",
      status: "active",
      joinedAt: now,
      updatedAt: now,
    };
    memoryWorkspaces.push(workspace);
    memoryMembers.push(membership);
    return workspaceView(workspace, membership);
  }
  return db.transaction(async tx => {
    const owned = await tx.select({ value: count() }).from(workspaces).where(and(
      eq(workspaces.createdByUserId, userId), eq(workspaces.status, "active")
    ));
    if (Number(owned[0]?.value ?? 0) >= MAX_OWNED_WORKSPACES) {
      throw new WorkspaceError("PRECONDITION_FAILED", "The active workspace ownership limit has been reached.");
    }
    const created = await tx.insert(workspaces).values({ name, createdByUserId: userId });
    const workspaceId = resultInsertId(created);
    await tx.insert(workspaceMembers).values({ workspaceId, userId, role: "owner" });
    const workspace = (await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0];
    const membership = (await tx.select().from(workspaceMembers).where(and(
      eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)
    )).limit(1))[0];
    return workspaceView(workspace, membership);
  });
}

export async function getWorkspaceDetail(userId: number, workspaceId: number) {
  const { workspace, membership } = await requireActiveMembership(userId, workspaceId);
  const db = await getDb();
  const canManage = membership.role === "owner" || membership.role === "admin";
  if (!db) {
    const members = await Promise.all(memoryMembers
      .filter(item => item.workspaceId === workspaceId && item.status === "active")
      .sort((left, right) => left.id - right.id)
      .slice(0, MAX_WORKSPACE_MEMBERS)
      .map(async item => {
        const user = await getUserById(item.userId);
        return { id: item.id, userId: item.userId, role: item.role, name: user?.name ?? null, email: user?.email ?? null, joinedAt: item.joinedAt, isCurrentUser: item.userId === userId };
      }));
    const invitations = canManage ? memoryInvitations
      .filter(item => item.workspaceId === workspaceId && !item.acceptedAt && !item.revokedAt && item.expiresAt > new Date())
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, MAX_ACTIVE_INVITATIONS)
      .map(item => ({ id: item.id, email: item.email, role: item.role, expiresAt: item.expiresAt, createdAt: item.createdAt })) : [];
    return { ...workspaceView(workspace, membership), members, invitations };
  }
  const members = await db
    .select({
      id: workspaceMembers.id,
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      name: users.name,
      email: users.email,
      joinedAt: workspaceMembers.joinedAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.status, "active")))
    .orderBy(asc(workspaceMembers.id))
    .limit(MAX_WORKSPACE_MEMBERS);
  const invitations = canManage ? await db
    .select({
      id: workspaceInvitations.id,
      email: workspaceInvitations.email,
      role: workspaceInvitations.role,
      expiresAt: workspaceInvitations.expiresAt,
      createdAt: workspaceInvitations.createdAt,
    })
    .from(workspaceInvitations)
    .where(and(
      eq(workspaceInvitations.workspaceId, workspaceId),
      isNull(workspaceInvitations.acceptedAt),
      isNull(workspaceInvitations.revokedAt),
      gt(workspaceInvitations.expiresAt, new Date())
    ))
    .orderBy(desc(workspaceInvitations.createdAt), desc(workspaceInvitations.id))
    .limit(MAX_ACTIVE_INVITATIONS) : [];
  return {
    ...workspaceView(workspace, membership),
    members: members.map(item => ({ ...item, isCurrentUser: item.userId === userId })),
    invitations,
  };
}

export async function renameWorkspace(userId: number, workspaceId: number, name: string) {
  const { workspace, membership } = await requireActiveMembership(userId, workspaceId);
  requireManager(membership.role);
  const db = await getDb();
  if (!db) {
    workspace.name = name;
    workspace.updatedAt = new Date();
  } else {
    await db.update(workspaces).set({ name }).where(and(eq(workspaces.id, workspaceId), eq(workspaces.status, "active")));
  }
  return { workspaceId, name };
}

export async function inviteWorkspaceMember(
  userId: number,
  workspaceId: number,
  email: string,
  role: InvitableWorkspaceRole
) {
  const { membership } = await requireActiveMembership(userId, workspaceId);
  requireManager(membership.role);
  if (membership.role === "admin" && role === "admin") {
    throw new WorkspaceError("FORBIDDEN", "Only the workspace owner can invite another admin.");
  }
  const normalizedEmail = normalizeEmail(email);
  const existingUser = await getUserByEmail(normalizedEmail);
  const db = await getDb();
  if (!db) {
    const activeMemberCount = memoryMembers.filter(item => item.workspaceId === workspaceId && item.status === "active").length;
    const activeInvitationCount = memoryInvitations.filter(item =>
      item.workspaceId === workspaceId && !item.acceptedAt && !item.revokedAt && item.expiresAt > new Date()
    ).length;
    if (activeMemberCount >= MAX_WORKSPACE_MEMBERS) throw new WorkspaceError("PRECONDITION_FAILED", "The workspace member limit has been reached.");
    if (activeInvitationCount >= MAX_ACTIVE_INVITATIONS) throw new WorkspaceError("PRECONDITION_FAILED", "The active invitation limit has been reached.");
    if (existingUser && memoryMembers.some(item =>
      item.workspaceId === workspaceId && item.userId === existingUser.id && item.status === "active"
    )) throw new WorkspaceError("CONFLICT", "This person is already an active workspace member.");
  } else if (existingUser) {
    const active = await db.select({ id: workspaceMembers.id }).from(workspaceMembers).where(and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, existingUser.id),
      eq(workspaceMembers.status, "active")
    )).limit(1);
    if (active.length) throw new WorkspaceError("CONFLICT", "This person is already an active workspace member.");
  }
  if (db) {
    const [memberRows, invitationRows] = await Promise.all([
      db.select({ value: count() }).from(workspaceMembers).where(and(
        eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.status, "active")
      )),
      db.select({ value: count() }).from(workspaceInvitations).where(and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        isNull(workspaceInvitations.acceptedAt),
        isNull(workspaceInvitations.revokedAt),
        gt(workspaceInvitations.expiresAt, new Date())
      )),
    ]);
    if (Number(memberRows[0]?.value ?? 0) >= MAX_WORKSPACE_MEMBERS) throw new WorkspaceError("PRECONDITION_FAILED", "The workspace member limit has been reached.");
    if (Number(invitationRows[0]?.value ?? 0) >= MAX_ACTIVE_INVITATIONS) throw new WorkspaceError("PRECONDITION_FAILED", "The active invitation limit has been reached.");
  }
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashInvitationToken(token);
  const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_MS);
  if (!db) {
    for (const invitation of memoryInvitations) {
      if (invitation.workspaceId === workspaceId && invitation.email === normalizedEmail && !invitation.acceptedAt && !invitation.revokedAt) {
        invitation.revokedAt = new Date();
      }
    }
    const invitation: MemoryInvitation = {
      id: memoryInvitations.length + 1,
      workspaceId,
      email: normalizedEmail,
      role,
      tokenHash,
      expiresAt,
      invitedByUserId: userId,
      acceptedByUserId: null,
      acceptedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    };
    memoryInvitations.push(invitation);
    return { invitationId: invitation.id, email: normalizedEmail, role, token, expiresAt };
  }
  return db.transaction(async tx => {
    await tx.update(workspaceInvitations).set({ revokedAt: new Date() }).where(and(
      eq(workspaceInvitations.workspaceId, workspaceId),
      eq(workspaceInvitations.email, normalizedEmail),
      isNull(workspaceInvitations.acceptedAt),
      isNull(workspaceInvitations.revokedAt)
    ));
    const created = await tx.insert(workspaceInvitations).values({
      workspaceId, email: normalizedEmail, role, tokenHash, expiresAt, invitedByUserId: userId,
    });
    return { invitationId: resultInsertId(created), email: normalizedEmail, role, token, expiresAt };
  });
}

export async function acceptWorkspaceInvitation(userId: number, userEmail: string | null | undefined, token: string) {
  if (!userEmail) throw new WorkspaceError("PRECONDITION_FAILED", "A verified account email is required to accept a workspace invitation.");
  const normalizedEmail = normalizeEmail(userEmail);
  const tokenHash = hashInvitationToken(token);
  const db = await getDb();
  const now = new Date();
  if (!db) {
    const invitation = memoryInvitations.find(item => item.tokenHash === tokenHash);
    if (!invitation) throw new WorkspaceError("NOT_FOUND", "Workspace invitation not found.");
    if (invitation.email !== normalizedEmail) throw new WorkspaceError("FORBIDDEN", "This invitation belongs to a different email address.");
    if (invitation.acceptedAt) {
      if (invitation.acceptedByUserId === userId) return { workspaceId: invitation.workspaceId, existing: true };
      throw new WorkspaceError("CONFLICT", "This workspace invitation has already been accepted.");
    }
    if (invitation.revokedAt || invitation.expiresAt <= now) throw new WorkspaceError("PRECONDITION_FAILED", "This workspace invitation is no longer active.");
    const workspace = memoryWorkspaces.find(item => item.id === invitation.workspaceId && item.status === "active");
    if (!workspace) throw new WorkspaceError("PRECONDITION_FAILED", "This workspace is no longer active.");
    if (memoryMembers.filter(item => item.userId === userId && item.status === "active").length >= MAX_USER_WORKSPACES) {
      throw new WorkspaceError("PRECONDITION_FAILED", "The workspace membership limit has been reached.");
    }
    if (memoryMembers.filter(item => item.workspaceId === invitation.workspaceId && item.status === "active").length >= MAX_WORKSPACE_MEMBERS) {
      throw new WorkspaceError("PRECONDITION_FAILED", "The workspace member limit has been reached.");
    }
    const existing = memoryMembers.find(item => item.workspaceId === invitation.workspaceId && item.userId === userId);
    if (existing) {
      existing.role = invitation.role;
      existing.status = "active";
      existing.updatedAt = now;
    } else {
      memoryMembers.push({
        id: memoryMembers.length + 1,
        workspaceId: invitation.workspaceId,
        userId,
        role: invitation.role,
        status: "active",
        joinedAt: now,
        updatedAt: now,
      });
    }
    invitation.acceptedByUserId = userId;
    invitation.acceptedAt = now;
    return { workspaceId: invitation.workspaceId, existing: false };
  }
  return db.transaction(async tx => {
    const invitation = (await tx.select().from(workspaceInvitations).where(eq(workspaceInvitations.tokenHash, tokenHash)).limit(1))[0];
    if (!invitation) throw new WorkspaceError("NOT_FOUND", "Workspace invitation not found.");
    if (invitation.email !== normalizedEmail) throw new WorkspaceError("FORBIDDEN", "This invitation belongs to a different email address.");
    if (invitation.acceptedAt) {
      if (invitation.acceptedByUserId === userId) return { workspaceId: invitation.workspaceId, existing: true };
      throw new WorkspaceError("CONFLICT", "This workspace invitation has already been accepted.");
    }
    if (invitation.revokedAt || invitation.expiresAt <= now) throw new WorkspaceError("PRECONDITION_FAILED", "This workspace invitation is no longer active.");
    const workspace = (await tx.select({ id: workspaces.id }).from(workspaces).where(and(
      eq(workspaces.id, invitation.workspaceId), eq(workspaces.status, "active")
    )).limit(1))[0];
    if (!workspace) throw new WorkspaceError("PRECONDITION_FAILED", "This workspace is no longer active.");
    const [userMembershipRows, workspaceMemberRows] = await Promise.all([
      tx.select({ value: count() }).from(workspaceMembers).where(and(
        eq(workspaceMembers.userId, userId), eq(workspaceMembers.status, "active")
      )),
      tx.select({ value: count() }).from(workspaceMembers).where(and(
        eq(workspaceMembers.workspaceId, invitation.workspaceId), eq(workspaceMembers.status, "active")
      )),
    ]);
    if (Number(userMembershipRows[0]?.value ?? 0) >= MAX_USER_WORKSPACES) throw new WorkspaceError("PRECONDITION_FAILED", "The workspace membership limit has been reached.");
    if (Number(workspaceMemberRows[0]?.value ?? 0) >= MAX_WORKSPACE_MEMBERS) throw new WorkspaceError("PRECONDITION_FAILED", "The workspace member limit has been reached.");
    const claimed = await tx.update(workspaceInvitations).set({ acceptedByUserId: userId, acceptedAt: now }).where(and(
      eq(workspaceInvitations.id, invitation.id),
      isNull(workspaceInvitations.acceptedAt),
      isNull(workspaceInvitations.revokedAt),
      gt(workspaceInvitations.expiresAt, now)
    ));
    if (resultAffectedRows(claimed) !== 1) throw new WorkspaceError("CONFLICT", "This workspace invitation was already used.");
    await tx.insert(workspaceMembers).values({
      workspaceId: invitation.workspaceId, userId, role: invitation.role, status: "active", joinedAt: now,
    }).onDuplicateKeyUpdate({ set: { role: invitation.role, status: "active", joinedAt: now } });
    return { workspaceId: invitation.workspaceId, existing: false };
  });
}

export async function revokeWorkspaceInvitation(userId: number, workspaceId: number, invitationId: number) {
  const { membership } = await requireActiveMembership(userId, workspaceId);
  requireManager(membership.role);
  const db = await getDb();
  if (!db) {
    const invitation = memoryInvitations.find(item => item.id === invitationId && item.workspaceId === workspaceId && !item.acceptedAt && !item.revokedAt);
    if (!invitation) throw new WorkspaceError("NOT_FOUND", "Active workspace invitation not found.");
    invitation.revokedAt = new Date();
  } else {
    const result = await db.update(workspaceInvitations).set({ revokedAt: new Date() }).where(and(
      eq(workspaceInvitations.id, invitationId),
      eq(workspaceInvitations.workspaceId, workspaceId),
      isNull(workspaceInvitations.acceptedAt),
      isNull(workspaceInvitations.revokedAt)
    ));
    if (resultAffectedRows(result) !== 1) throw new WorkspaceError("NOT_FOUND", "Active workspace invitation not found.");
  }
  return { workspaceId, invitationId };
}

export async function changeWorkspaceMemberRole(
  userId: number,
  workspaceId: number,
  targetUserId: number,
  role: InvitableWorkspaceRole
) {
  const { membership } = await requireActiveMembership(userId, workspaceId);
  requireOwner(membership.role);
  const db = await getDb();
  if (!db) {
    const target = memoryMembers.find(item => item.workspaceId === workspaceId && item.userId === targetUserId && item.status === "active");
    if (!target) throw new WorkspaceError("NOT_FOUND", "Workspace member not found.");
    if (target.role === "owner") throw new WorkspaceError("PRECONDITION_FAILED", "Transfer ownership instead of changing the owner role.");
    target.role = role;
    target.updatedAt = new Date();
  } else {
    const target = (await db.select().from(workspaceMembers).where(and(
      eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId), eq(workspaceMembers.status, "active")
    )).limit(1))[0];
    if (!target) throw new WorkspaceError("NOT_FOUND", "Workspace member not found.");
    if (target.role === "owner") throw new WorkspaceError("PRECONDITION_FAILED", "Transfer ownership instead of changing the owner role.");
    await db.update(workspaceMembers).set({ role }).where(eq(workspaceMembers.id, target.id));
  }
  return { workspaceId, targetUserId, role };
}

export async function removeWorkspaceMember(userId: number, workspaceId: number, targetUserId: number) {
  const { membership } = await requireActiveMembership(userId, workspaceId);
  const db = await getDb();
  const target = !db
    ? memoryMembers.find(item => item.workspaceId === workspaceId && item.userId === targetUserId && item.status === "active")
    : (await db.select().from(workspaceMembers).where(and(
        eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId), eq(workspaceMembers.status, "active")
      )).limit(1))[0];
  if (!target) throw new WorkspaceError("NOT_FOUND", "Workspace member not found.");
  const selfRemoval = userId === targetUserId;
  if (target.role === "owner") throw new WorkspaceError("PRECONDITION_FAILED", "Transfer ownership before the owner leaves the workspace.");
  if (!selfRemoval) {
    requireManager(membership.role);
    if (membership.role === "admin" && target.role !== "member") {
      throw new WorkspaceError("FORBIDDEN", "Workspace admins can remove members only.");
    }
  }
  if (!db) {
    target.status = "removed";
    target.updatedAt = new Date();
  } else {
    await db.update(workspaceMembers).set({ status: "removed" }).where(eq(workspaceMembers.id, target.id));
  }
  return { workspaceId, targetUserId, selfRemoval };
}

export async function transferWorkspaceOwnership(userId: number, workspaceId: number, targetUserId: number) {
  const { membership } = await requireActiveMembership(userId, workspaceId);
  requireOwner(membership.role);
  if (targetUserId === userId) throw new WorkspaceError("CONFLICT", "This person already owns the workspace.");
  const db = await getDb();
  if (!db) {
    const target = memoryMembers.find(item => item.workspaceId === workspaceId && item.userId === targetUserId && item.status === "active");
    if (!target) throw new WorkspaceError("NOT_FOUND", "Workspace member not found.");
    membership.role = "admin";
    membership.updatedAt = new Date();
    target.role = "owner";
    target.updatedAt = new Date();
    const workspace = memoryWorkspaces.find(item => item.id === workspaceId)!;
    workspace.createdByUserId = targetUserId;
    workspace.updatedAt = new Date();
  } else {
    await db.transaction(async tx => {
      const target = (await tx.select().from(workspaceMembers).where(and(
        eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId), eq(workspaceMembers.status, "active")
      )).limit(1))[0];
      if (!target) throw new WorkspaceError("NOT_FOUND", "Workspace member not found.");
      await tx.update(workspaceMembers).set({ role: "admin" }).where(eq(workspaceMembers.id, membership.id));
      await tx.update(workspaceMembers).set({ role: "owner" }).where(eq(workspaceMembers.id, target.id));
      await tx.update(workspaces).set({ createdByUserId: targetUserId }).where(eq(workspaces.id, workspaceId));
    });
  }
  return { workspaceId, previousOwnerUserId: userId, ownerUserId: targetUserId };
}

export async function archiveWorkspace(userId: number, workspaceId: number) {
  const { workspace, membership } = await requireActiveMembership(userId, workspaceId);
  requireOwner(membership.role);
  const now = new Date();
  const db = await getDb();
  if (!db) {
    if (memoryMembers.some(item => item.workspaceId === workspaceId && item.userId !== userId && item.status === "active")) {
      throw new WorkspaceError("PRECONDITION_FAILED", "Remove all other active members before archiving this workspace.");
    }
    workspace.status = "archived";
    workspace.updatedAt = now;
    memoryInvitations.filter(item => item.workspaceId === workspaceId && !item.acceptedAt && !item.revokedAt).forEach(item => { item.revokedAt = now; });
  } else {
    await db.transaction(async tx => {
      const otherMember = await tx.select({ id: workspaceMembers.id }).from(workspaceMembers).where(and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.status, "active")
      ));
      if (otherMember.some(item => item.id !== membership.id)) {
        throw new WorkspaceError("PRECONDITION_FAILED", "Remove all other active members before archiving this workspace.");
      }
      await tx.update(workspaces).set({ status: "archived" }).where(eq(workspaces.id, workspaceId));
      await tx.update(workspaceInvitations).set({ revokedAt: now }).where(and(
        eq(workspaceInvitations.workspaceId, workspaceId), isNull(workspaceInvitations.acceptedAt), isNull(workspaceInvitations.revokedAt)
      ));
    });
  }
  return { workspaceId, status: "archived" as const };
}
