import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { accountRestriction } from "@/lib/accountAccess";
import { Clock3, LogOut, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";

export default function AccountStatusGate({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const { t } = useLocale();
  const restriction = user ? accountRestriction(user.accountStatus) : null;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
        <div className="flex items-center gap-3 text-sm" role="status" aria-live="polite">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          {t("loading")}
        </div>
      </div>
    );
  }

  if (!restriction) return children;

  const pending = restriction === "pending";
  const Icon = pending ? Clock3 : ShieldAlert;

  return (
    <main className="flex min-h-screen items-center bg-slate-950 px-6 py-12 text-slate-100">
      <section className="mx-auto w-full max-w-xl" aria-labelledby="account-status-title">
        <Icon className="mb-6 h-10 w-10 text-amber-400" aria-hidden="true" />
        <p className="mb-3 text-sm font-medium text-amber-300">
          {t(pending ? "accountPendingLabel" : "accountSuspendedLabel")}
        </p>
        <h1 id="account-status-title" className="text-3xl font-semibold leading-tight">
          {t(pending ? "accountPendingTitle" : "accountSuspendedTitle")}
        </h1>
        <p className="mt-4 max-w-lg text-base leading-7 text-slate-300">
          {t(pending ? "accountPendingDescription" : "accountSuspendedDescription")}
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-8 border-slate-600 bg-transparent text-slate-100 hover:bg-slate-800 hover:text-white"
          onClick={async () => {
            await logout();
            window.location.href = "/";
          }}
        >
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("signOut")}
        </Button>
      </section>
    </main>
  );
}
