import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Activity, User, Settings, LogOut, Zap } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";

interface AppHeaderProps {
  currentPage?: "dashboard" | "profile" | "settings" | "ai-preferences";
}

export default function AppHeader({ currentPage }: AppHeaderProps) {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { t } = useLocale();

  const handleLogout = async () => {
    await logout();
    setLocation("/");
    toast.success(t("loggedOut"));
  };

  const getButtonClass = (page: string) => {
    if (currentPage === page) {
      return "text-cyan-400 bg-cyan-500/10";
    }
    return "text-slate-300 hover:text-white";
  };

  return (
    <header className="border-b border-slate-800/50 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4 flex justify-between items-center">
        <button
          type="button"
          className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          onClick={() => setLocation("/")}
          aria-label={t("hireAiHome")}
        >
          <Activity className="h-8 w-8 text-cyan-400" />
          <span className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            Hire.AI
          </span>
        </button>
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            className={getButtonClass("dashboard")}
            onClick={() => setLocation("/dashboard")}
          >
            {t("dashboard")}
          </Button>
          
          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="relative h-10 w-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600"
                aria-label={t("openAccountMenu")}
              >
                <span className="text-white font-semibold">
                  {user?.name?.charAt(0).toUpperCase() || "U"}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56 bg-slate-900 border-slate-800" align="end">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium text-white">{user?.name || t("userFallback")}</p>
                <p className="text-xs text-slate-400">{user?.email}</p>
              </div>
              <DropdownMenuSeparator className="bg-slate-800" />
              <DropdownMenuItem 
                className="text-slate-300 focus:bg-slate-800 focus:text-white cursor-pointer"
                onClick={() => setLocation("/profile")}
              >
                <User className="mr-2 h-4 w-4" />
                {t("profile")}
              </DropdownMenuItem>
              <DropdownMenuItem 
                className="text-slate-300 focus:bg-slate-800 focus:text-white cursor-pointer"
                onClick={() => setLocation("/ai-preferences")}
              >
                <Zap className="mr-2 h-4 w-4" />
                {t("aiPreferences")}
              </DropdownMenuItem>
              <DropdownMenuItem 
                className="text-slate-300 focus:bg-slate-800 focus:text-white cursor-pointer"
                onClick={() => setLocation("/settings")}
              >
                <Settings className="mr-2 h-4 w-4" />
                {t("settings")}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-slate-800" />
              <DropdownMenuItem 
                className="text-red-400 focus:bg-red-500/10 focus:text-red-400 cursor-pointer"
                onClick={handleLogout}
              >
                <LogOut className="mr-2 h-4 w-4" />
                {t("signOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
