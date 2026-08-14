import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { Activity, Rocket, ArrowRight, Search, FileText, Send, Globe, Menu, X, ChevronDown, ShieldCheck } from "lucide-react";
import { useLocation } from "wouter";
import { useRef, useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { getLandingCopy, type LandingCopyKey } from "@/lib/landingCopy";

const OPERATING_STEPS = [
  ["1", "versionedEvidence", "versionedEvidenceDetail"],
  ["2", "sourceAwareDiscovery", "sourceAwareDiscoveryDetail"],
  ["3", "reviewGatedExecution", "reviewGatedExecutionDetail"],
] as const satisfies ReadonlyArray<readonly [string, LandingCopyKey, LandingCopyKey]>;

const FAQ_ITEMS = [
  ["faqApplicationsQuestion", "faqApplicationsAnswer"],
  ["faqSecurityQuestion", "faqSecurityAnswer"],
  ["faqAutomationQuestion", "faqAutomationAnswer"],
  ["faqVolumeQuestion", "faqVolumeAnswer"],
  ["faqPlatformsQuestion", "faqPlatformsAnswer"],
  ["faqReviewQuestion", "faqReviewAnswer"],
] as const satisfies ReadonlyArray<readonly [LandingCopyKey, LandingCopyKey]>;

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();
  const { locale, setLocale, t } = useLocale();
  const lp = (key: LandingCopyKey) => getLandingCopy(locale, key);
  const featuresRef = useRef<HTMLElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  

  const handleGetStarted = () => {
    if (isAuthenticated) {
      setLocation("/dashboard");
    } else {
      window.location.href = getLoginUrl();
    }
  };

  const scrollToFeatures = () => {
    featuresRef.current?.scrollIntoView({ behavior: "smooth" });
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900">
      {/* Header */}
      <header className="border-b border-slate-800/50 backdrop-blur-sm bg-slate-950/50 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setLocation("/")}>
            <Activity className="h-8 w-8 text-cyan-400" />
            <div className="flex flex-col">
              <span className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                Hire.AI
              </span>
              <span className="text-xs text-slate-500 -mt-1">{lp("tagline")}</span>
            </div>
          </div>
          
          {/* Desktop Navigation */}
          <div className="hidden md:flex gap-4 items-center">
            <div className="flex rounded-md border border-slate-700 p-0.5" role="group" aria-label={t("language")}>
              {(["en", "nl"] as const).map((language) => (
                <button
                  key={language}
                  type="button"
                  className={`min-w-10 rounded px-2 py-1 text-xs font-medium ${locale === language ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-white"}`}
                  aria-pressed={locale === language}
                  onClick={() => setLocale(language)}
                >
                  {language.toUpperCase()}
                </button>
              ))}
            </div>
            {isAuthenticated ? (
              <Button
                variant="outline"
                className="border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10"
                onClick={() => setLocation("/dashboard")}
              >
                {t("dashboard")}
              </Button>
            ) : (
              <Button
                variant="outline"
                className="border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10"
                onClick={() => window.location.href = getLoginUrl()}
              >
                {t("signIn")}
              </Button>
            )}
          </div>
          
          {/* Mobile Menu Button */}
          <button
            className="md:hidden p-2 text-slate-300 hover:text-white"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={t("toggleNavigation")}
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
        
        {/* Mobile Navigation Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-800/50 bg-slate-950/95 backdrop-blur-sm">
            <div className="container mx-auto px-4 py-4 flex flex-col gap-2">
              <div className="flex rounded-md border border-slate-700 p-0.5" role="group" aria-label={t("language")}>
                {(["en", "nl"] as const).map((language) => (
                  <button
                    key={language}
                    type="button"
                    className={`flex-1 rounded px-3 py-2 text-sm font-medium ${locale === language ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400"}`}
                    aria-pressed={locale === language}
                    onClick={() => setLocale(language)}
                  >
                    {language.toUpperCase()}
                  </button>
                ))}
              </div>
              {isAuthenticated ? (
                <Button
                  className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white w-full mt-2"
                  onClick={() => {
                    setLocation("/dashboard");
                    setMobileMenuOpen(false);
                  }}
                >
                  {t("dashboard")}
                </Button>
              ) : (
                <Button
                  className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white w-full mt-2"
                  onClick={() => {
                    window.location.href = getLoginUrl();
                  }}
                >
                  {t("signIn")}
                </Button>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <h1 className="text-4xl lg:text-5xl font-bold leading-tight">
              <span className="bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 bg-clip-text text-transparent">
                {lp("heroTitle")}
              </span>
            </h1>
            <p className="text-xl text-slate-300 leading-relaxed">
              {lp("heroDescription")}
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Button
                size="lg"
                className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white px-8 text-lg"
                onClick={handleGetStarted}
              >
                {lp(isAuthenticated ? "goToDashboard" : "buildWorkspace")}
                <Rocket className="ml-2 h-5 w-5" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
                onClick={scrollToFeatures}
              >
                {lp("seeHowItWorks")}
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </div>
            
            <div className="flex items-center gap-3 pt-4 text-sm text-slate-300">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
              <span>{lp("approvalBoundary")}</span>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-purple-500/20 rounded-3xl blur-xl" />
            <div className="relative bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-8 shadow-2xl">
              <div className="space-y-6">
                <div>
                  <p className="text-sm font-medium text-cyan-300">{lp("operatingModel")}</p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">{lp("operatingModelTitle")}</h2>
                </div>
                <div className="space-y-4">
                  {OPERATING_STEPS.map(([step, title, detail]) => (
                    <div key={step} className="flex gap-4 border-t border-slate-700/60 pt-4 first:border-t-0 first:pt-0">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-500/15 text-sm font-semibold text-cyan-300">{step}</span>
                      <div>
                        <p className="font-medium text-white">{lp(title)}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-400">{lp(detail)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>



      {/* Operating principles */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-white mb-4">{lp("accountableTitle")}</h2>
          <p className="text-xl text-slate-400">{lp("accountableDescription")}</p>
        </div>
        
        <div className="grid md:grid-cols-3 gap-8">
          <div className="border-t border-slate-700/60 pt-6">
            <p className="text-lg font-semibold text-white">{lp("evidenceBeforeAction")}</p>
            <p className="mt-3 leading-7 text-slate-400">{lp("evidenceBeforeActionDetail")}</p>
          </div>
          
          <div className="border-t border-slate-700/60 pt-6">
            <p className="text-lg font-semibold text-white">{lp("externalControl")}</p>
            <p className="mt-3 leading-7 text-slate-400">{lp("externalControlDetail")}</p>
          </div>
          
          <div className="border-t border-slate-700/60 pt-6">
            <p className="text-lg font-semibold text-white">{lp("oneRecord")}</p>
            <p className="mt-3 leading-7 text-slate-400">{lp("oneRecordDetail")}</p>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="container mx-auto px-4 py-20" ref={featuresRef}>
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-white mb-4">{lp("howItWorks")}</h2>
          <p className="text-xl text-slate-400">{lp("howItWorksDescription")}</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="relative">
            <div className="absolute -top-4 -left-4 w-12 h-12 rounded-full bg-cyan-500 flex items-center justify-center text-white font-bold text-xl">1</div>
            <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800/50 rounded-xl p-8 pt-12 h-full">
              <div className="h-16 w-16 rounded-2xl bg-cyan-500/10 flex items-center justify-center mb-6">
                <FileText className="h-8 w-8 text-cyan-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">{lp("importEvidence")}</h3>
              <p className="text-slate-400">
                {lp("importEvidenceDetail")}
              </p>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -top-4 -left-4 w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold text-xl">2</div>
            <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800/50 rounded-xl p-8 pt-12 h-full">
              <div className="h-16 w-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-6">
                <Search className="h-8 w-8 text-blue-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">{lp("scanSources")}</h3>
              <p className="text-slate-400">
                {lp("scanSourcesDetail")}
              </p>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -top-4 -left-4 w-12 h-12 rounded-full bg-purple-500 flex items-center justify-center text-white font-bold text-xl">3</div>
            <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800/50 rounded-xl p-8 pt-12 h-full">
              <div className="h-16 w-16 rounded-2xl bg-purple-500/10 flex items-center justify-center mb-6">
                <Send className="h-8 w-8 text-purple-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">{lp("reviewWork")}</h3>
              <p className="text-slate-400">
                {lp("reviewWorkDetail")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-white mb-4">{lp("faqTitle")}</h2>
          <p className="text-xl text-slate-400 max-w-2xl mx-auto">
            {lp("faqDescription")}
          </p>
        </div>
        
        <div className="max-w-3xl mx-auto space-y-4">
          {FAQ_ITEMS.map(([question, answer]) => (
            <details 
              key={question}
              className="group bg-slate-900/50 backdrop-blur-sm border border-slate-800/50 rounded-xl overflow-hidden"
            >
              <summary className="flex items-center justify-between p-6 cursor-pointer list-none">
                <span className="text-lg font-medium text-white pr-4">{lp(question)}</span>
                <ChevronDown className="h-5 w-5 text-slate-400 transition-transform group-open:rotate-180 flex-shrink-0" />
              </summary>
              <div className="px-6 pb-6 text-slate-400 leading-relaxed">
                {lp(answer)}
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center space-y-6">
          <h2 className="text-4xl lg:text-5xl font-bold text-white">
            {lp("ctaTitle")}
          </h2>
          <p className="text-xl text-slate-400 max-w-2xl mx-auto">
            {lp("ctaDescription")}
          </p>
          <Button
            size="lg"
            className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white px-12 py-6 text-lg"
            onClick={handleGetStarted}
          >
            {lp(isAuthenticated ? "goToDashboard" : "buildWorkspace")}
            <Rocket className="ml-2 h-5 w-5" />
          </Button>
          <p className="text-sm text-slate-500">{lp("ctaHint")}</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/50 mt-20">
        <div className="container mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <Activity className="h-6 w-6 text-cyan-400" />
              <div>
                <span className="text-lg font-semibold text-slate-300">Hire.AI</span>
                <span className="text-slate-500 text-sm ml-2">{lp("tagline")}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <Globe className="h-4 w-4" />
              <span>{lp("mission")}</span>
            </div>
            <div className="flex items-center gap-4 text-sm text-slate-500">
              <span>{lp("copyright")}</span>
              <a
                href="/terms"
                className="text-slate-400 hover:text-cyan-400 transition-colors hover:underline underline-offset-4"
              >
                {lp("terms")}
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
