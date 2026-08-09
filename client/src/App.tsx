import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LocaleProvider, useLocale } from "./contexts/LocaleContext";

const LandingPage = lazy(() => import("./pages/LandingPage"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Profile = lazy(() => import("./pages/Profile"));
const Settings = lazy(() => import("./pages/Settings"));
const AIPreferences = lazy(() => import("./pages/AIPreferences"));
const SavedJobs = lazy(() => import("./pages/SavedJobs"));
const Billing = lazy(() => import("./pages/Billing"));
const AdminPanel = lazy(() => import("./pages/AdminPanel"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const JobSearch = lazy(() => import("./pages/JobSearch"));
const Applications = lazy(() => import("./pages/Applications"));
const JobAlerts = lazy(() => import("./pages/JobAlerts"));
const ReviewQueue = lazy(() => import("./pages/ReviewQueue"));
const NotFound = lazy(() => import("./pages/NotFound"));

function RouteLoadingFallback() {
  const { t } = useLocale();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
      <div className="flex items-center gap-3 text-sm" role="status" aria-live="polite">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
        {t("loading")}
      </div>
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Switch>
        <Route path={"/"} component={LandingPage} />
        <Route path={"/dashboard"} component={Dashboard} />
        <Route path={"/jobs"} component={JobSearch} />
        <Route path={"/applications"} component={Applications} />
        <Route path={"/review-queue"} component={ReviewQueue} />
        <Route path={"/alerts"} component={JobAlerts} />
        <Route path={"/profile"} component={Profile} />
        <Route path={"/settings"} component={Settings} />
        <Route path={"/ai-preferences"} component={AIPreferences} />
        <Route path={"/saved"} component={SavedJobs} />
        <Route path={"/billing"} component={Billing} />
        <Route path={"/admin"} component={AdminPanel} />
        <Route path={"/terms"} component={TermsOfService} />
        <Route path={"/404"} component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="dark"
        // switchable
      >
        <LocaleProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </LocaleProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
