import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { Archive, Copy, Loader2, ShieldCheck, UserMinus, UserPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type MemberRole = "admin" | "member";

export default function Team() {
  const utils = trpc.useUtils();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [invitationToken, setInvitationToken] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("member");
  const [issuedInvitation, setIssuedInvitation] = useState<{ token: string; email: string; expiresAt: Date } | null>(null);

  const workspaceList = trpc.workspaces.list.useQuery();
  const detail = trpc.workspaces.detail.useQuery(
    { workspaceId: selectedWorkspaceId ?? 0 },
    { enabled: selectedWorkspaceId !== null }
  );

  useEffect(() => {
    if (selectedWorkspaceId !== null || !workspaceList.data?.length) return;
    setSelectedWorkspaceId(workspaceList.data[0].id);
  }, [selectedWorkspaceId, workspaceList.data]);

  useEffect(() => {
    setIssuedInvitation(null);
  }, [selectedWorkspaceId]);

  useEffect(() => {
    setRenameValue(detail.data?.name ?? "");
  }, [detail.data?.name]);

  const refreshWorkspace = async (workspaceId?: number) => {
    await utils.workspaces.list.invalidate();
    await utils.workspaces.detail.invalidate();
    if (workspaceId) setSelectedWorkspaceId(workspaceId);
  };

  const createWorkspace = trpc.workspaces.create.useMutation({
    onSuccess: async workspace => {
      setWorkspaceName("");
      await refreshWorkspace(workspace.id);
      toast.success("Workspace created");
    },
    onError: error => toast.error(error.message),
  });
  const acceptInvitation = trpc.workspaces.acceptInvitation.useMutation({
    onSuccess: async result => {
      setInvitationToken("");
      await refreshWorkspace(result.workspaceId);
      toast.success(result.existing ? "Invitation was already accepted" : "Workspace joined");
    },
    onError: error => toast.error(error.message),
  });
  const inviteMember = trpc.workspaces.invite.useMutation({
    onSuccess: async invitation => {
      setInviteEmail("");
      setIssuedInvitation(invitation);
      await refreshWorkspace();
      toast.success("Invitation created");
    },
    onError: error => toast.error(error.message),
  });
  const renameWorkspace = trpc.workspaces.rename.useMutation({
    onSuccess: async () => { await refreshWorkspace(); toast.success("Workspace renamed"); },
    onError: error => toast.error(error.message),
  });
  const revokeInvitation = trpc.workspaces.revokeInvitation.useMutation({
    onSuccess: async () => { await refreshWorkspace(); toast.success("Invitation revoked"); },
    onError: error => toast.error(error.message),
  });
  const changeRole = trpc.workspaces.changeMemberRole.useMutation({
    onSuccess: async () => { await refreshWorkspace(); toast.success("Member role updated"); },
    onError: error => toast.error(error.message),
  });
  const removeMember = trpc.workspaces.removeMember.useMutation({
    onSuccess: async result => {
      await refreshWorkspace();
      if (result.selfRemoval) setSelectedWorkspaceId(null);
      toast.success(result.selfRemoval ? "You left the workspace" : "Member removed");
    },
    onError: error => toast.error(error.message),
  });
  const transferOwnership = trpc.workspaces.transferOwnership.useMutation({
    onSuccess: async () => { await refreshWorkspace(); toast.success("Ownership transferred"); },
    onError: error => toast.error(error.message),
  });
  const archiveWorkspace = trpc.workspaces.archive.useMutation({
    onSuccess: async () => {
      setSelectedWorkspaceId(null);
      await refreshWorkspace();
      toast.success("Workspace archived");
    },
    onError: error => toast.error(error.message),
  });

  const current = detail.data;
  const isOwner = current?.role === "owner";
  const pending = createWorkspace.isPending || acceptInvitation.isPending || inviteMember.isPending;

  return (
    <DashboardLayout>
      <main className="mx-auto max-w-6xl space-y-8" data-testid="team-management">
        <header className="flex flex-col gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">Team access</h1>
            <p className="mt-1 text-sm text-slate-400">Manage workspace membership and governance roles.</p>
          </div>
          {workspaceList.data?.length ? (
            <Select value={selectedWorkspaceId?.toString()} onValueChange={value => setSelectedWorkspaceId(Number(value))}>
              <SelectTrigger className="w-full border-slate-700 bg-slate-900 sm:w-72" aria-label="Active workspace">
                <SelectValue placeholder="Select workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaceList.data.map(workspace => (
                  <SelectItem key={workspace.id} value={workspace.id.toString()}>{workspace.name} ({workspace.role})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </header>

        <section className="grid gap-6 lg:grid-cols-2">
          <form
            className="space-y-3 border-b border-slate-800 pb-6 lg:border-b-0 lg:border-r lg:pr-6"
            onSubmit={event => {
              event.preventDefault();
              createWorkspace.mutate({ name: workspaceName });
            }}
          >
            <Label htmlFor="workspace-name">New workspace</Label>
            <div className="flex gap-2">
              <Input id="workspace-name" value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} minLength={2} maxLength={120} placeholder="Workspace name" />
              <Button type="submit" disabled={workspaceName.trim().length < 2 || pending}>Create</Button>
            </div>
          </form>
          <form
            className="space-y-3"
            onSubmit={event => {
              event.preventDefault();
              acceptInvitation.mutate({ token: invitationToken });
            }}
          >
            <Label htmlFor="invitation-token">Invitation code</Label>
            <div className="flex gap-2">
              <Input id="invitation-token" value={invitationToken} onChange={event => setInvitationToken(event.target.value)} minLength={32} maxLength={128} autoComplete="off" placeholder="Paste invitation code" />
              <Button type="submit" disabled={invitationToken.trim().length < 32 || pending}>Join</Button>
            </div>
          </form>
        </section>

        {workspaceList.isLoading || (selectedWorkspaceId && detail.isLoading) ? (
          <div className="flex min-h-52 items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-cyan-400" /></div>
        ) : current ? (
          <>
            <section className="flex flex-col gap-3 border-y border-cyan-500/20 bg-cyan-500/5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400" />
                <div>
                  <p className="font-medium text-white">Candidate data remains private</p>
                  <p className="text-sm text-slate-400">Membership controls team governance only. Profiles, resumes, applications, messages, and billing records remain owner-scoped.</p>
                </div>
              </div>
              <Badge variant="outline" className="w-fit border-cyan-500/30 text-cyan-300">{current.role}</Badge>
            </section>

            {current.canManage ? (
              <section className="space-y-4 border-b border-slate-800 pb-8">
                <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={event => {
                  event.preventDefault();
                  renameWorkspace.mutate({ workspaceId: current.id, name: renameValue });
                }}>
                  <div className="space-y-2"><Label htmlFor="workspace-display-name">Workspace name</Label><Input id="workspace-display-name" value={renameValue} onChange={event => setRenameValue(event.target.value)} minLength={2} maxLength={120} /></div>
                  <Button type="submit" className="self-end" variant="outline" disabled={renameValue.trim().length < 2 || renameValue.trim() === current.name || renameWorkspace.isPending}>Rename</Button>
                </form>
                <div className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-cyan-400" /><h2 className="text-lg font-medium text-white">Invite member</h2></div>
                <form
                  className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_auto]"
                  onSubmit={event => {
                    event.preventDefault();
                    inviteMember.mutate({ workspaceId: current.id, email: inviteEmail, role: inviteRole });
                  }}
                >
                  <Input type="email" value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} maxLength={320} placeholder="person@example.com" aria-label="Invite email" />
                  <Select value={inviteRole} onValueChange={value => setInviteRole(value as MemberRole)}>
                    <SelectTrigger aria-label="Invitation role"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      {isOwner ? <SelectItem value="admin">Admin</SelectItem> : null}
                    </SelectContent>
                  </Select>
                  <Button type="submit" disabled={!inviteEmail.trim() || inviteMember.isPending}>Invite</Button>
                </form>
                {issuedInvitation ? (
                  <div className="flex flex-col gap-3 border border-amber-500/30 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="issued-invitation">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-amber-200">One-time code for {issuedInvitation.email}</p>
                      <code className="mt-1 block truncate text-xs text-slate-300">{issuedInvitation.token}</code>
                    </div>
                    <Button type="button" variant="outline" size="icon" title="Copy invitation code" onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(issuedInvitation.token);
                        toast.success("Invitation code copied");
                      } catch {
                        toast.error("Unable to copy the invitation code");
                      }
                    }}><Copy className="h-4 w-4" /></Button>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="space-y-4">
              <div className="flex items-center gap-2"><Users className="h-5 w-5 text-cyan-400" /><h2 className="text-lg font-medium text-white">Members</h2></div>
              <div className="divide-y divide-slate-800 border-y border-slate-800">
                {current.members.map(member => (
                  <div key={member.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{member.name || member.email || `User ${member.userId}`}</p>
                      <p className="truncate text-sm text-slate-500">{member.email || "No email"}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {isOwner && member.role !== "owner" ? (
                        <Select value={member.role} onValueChange={role => changeRole.mutate({ workspaceId: current.id, targetUserId: member.userId, role: role as MemberRole })}>
                          <SelectTrigger className="w-28" aria-label={`Role for ${member.name || member.email}`}><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="member">Member</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent>
                        </Select>
                      ) : <Badge variant="outline">{member.role}</Badge>}
                      {isOwner && member.role !== "owner" ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button variant="outline" size="sm">Transfer ownership</Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>Transfer workspace ownership?</AlertDialogTitle><AlertDialogDescription>You will become an admin. Only the new owner can reverse this change.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => transferOwnership.mutate({ workspaceId: current.id, targetUserId: member.userId })}>Transfer</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}
                      {member.role !== "owner" && (current.canManage || member.isCurrentUser) ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button variant="ghost" size="icon" title={member.isCurrentUser ? "Leave workspace" : "Remove member"}><UserMinus className="h-4 w-4" /></Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>{member.isCurrentUser ? "Leave this workspace?" : "Remove this workspace member?"}</AlertDialogTitle><AlertDialogDescription>Candidate data remains private and unchanged. Workspace access ends immediately.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => removeMember.mutate({ workspaceId: current.id, targetUserId: member.userId })}>{member.isCurrentUser ? "Leave" : "Remove"}</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {current.canManage && current.invitations.length ? (
              <section className="space-y-4">
                <h2 className="text-lg font-medium text-white">Pending invitations</h2>
                <div className="divide-y divide-slate-800 border-y border-slate-800">
                  {current.invitations.map(invitation => (
                    <div key={invitation.id} className="flex items-center justify-between gap-3 py-4">
                      <div className="min-w-0"><p className="truncate text-white">{invitation.email}</p><p className="text-sm text-slate-500">{invitation.role} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</p></div>
                      <Button variant="outline" size="sm" onClick={() => revokeInvitation.mutate({ workspaceId: current.id, invitationId: invitation.id })}>Revoke</Button>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {isOwner ? (
              <section className="flex flex-col gap-3 border-t border-red-500/20 pt-6 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="font-medium text-white">Archive workspace</p><p className="text-sm text-slate-500">All other active members must be removed first.</p></div>
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button variant="destructive"><Archive className="mr-2 h-4 w-4" />Archive</Button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>Archive this workspace?</AlertDialogTitle><AlertDialogDescription>Pending invitations will be revoked and the workspace will disappear from active team access.</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => archiveWorkspace.mutate({ workspaceId: current.id })}>Archive workspace</AlertDialogAction></AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </section>
            ) : null}
          </>
        ) : (
          <div className="flex min-h-52 flex-col items-center justify-center gap-3 border-y border-slate-800 text-center">
            <Users className="h-8 w-8 text-slate-600" />
            <p className="text-slate-400">Create a workspace or enter an invitation code.</p>
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}
