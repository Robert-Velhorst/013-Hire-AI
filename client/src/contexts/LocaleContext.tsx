import { useAuth } from "@/_core/hooks/useAuth";
import { DEFAULT_LOCALE, resolveSupportedLocale, type SupportedLocale } from "@shared/localization";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "hire-ai-locale";

const translations = {
  en: {
    loading: "Loading Hire.AI...", dashboard: "Dashboard", findJobs: "Find Jobs",
    applications: "Applications", reviewQueue: "Review Queue", savedJobs: "Saved Jobs",
    alerts: "Alerts", profile: "Profile", aiPreferences: "AI Preferences", menu: "Menu",
    team: "Team",
    toggleNavigation: "Toggle navigation", signInTitle: "Sign in to continue",
    signInDescription: "Access to this dashboard requires authentication. Continue to launch the login flow.",
    signIn: "Sign in", signOut: "Sign out", language: "Language",
    languageDescription: "Choose the language used for Hire.AI navigation and account controls.",
    languageSaved: "Language saved", languageSaveFailed: "Unable to save the language preference",
  },
  nl: {
    loading: "Hire.AI laden...", dashboard: "Overzicht", findJobs: "Vacatures zoeken",
    applications: "Sollicitaties", reviewQueue: "Beoordelingswachtrij", savedJobs: "Opgeslagen vacatures",
    alerts: "Meldingen", profile: "Profiel", aiPreferences: "AI-voorkeuren", menu: "Menu",
    team: "Team",
    toggleNavigation: "Navigatie in- of uitklappen", signInTitle: "Log in om door te gaan",
    signInDescription: "Voor dit overzicht moet je ingelogd zijn. Ga verder om het inlogproces te starten.",
    signIn: "Inloggen", signOut: "Uitloggen", language: "Taal",
    languageDescription: "Kies de taal voor de navigatie en accountbediening van Hire.AI.",
    languageSaved: "Taal opgeslagen", languageSaveFailed: "De taalvoorkeur kon niet worden opgeslagen",
  },
} as const;

export type TranslationKey = keyof typeof translations.en;

type LocaleContextValue = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (key: TranslationKey) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function initialLocale() {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    return resolveSupportedLocale(localStorage.getItem(STORAGE_KEY) || navigator.language);
  } catch {
    return resolveSupportedLocale(navigator.language);
  }
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [locale, setLocale] = useState<SupportedLocale>(initialLocale);

  useEffect(() => {
    if (user?.locale) setLocale(resolveSupportedLocale(user.locale));
  }, [user?.locale]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // The account-backed preference remains authoritative when browser storage is unavailable.
    }
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale,
    t: (key) => translations[locale][key],
  }), [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used within LocaleProvider");
  return value;
}
