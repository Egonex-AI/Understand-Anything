import { createContext, useContext, useMemo, type ReactNode } from "react";
import { getLocale, resolvePreferredLocaleKey, type Locale, type LocaleKey } from "../locales";

interface I18nContextValue {
  locale: Locale;
  localeKey: LocaleKey;
  t: Locale;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return ctx;
}

export function I18nProvider({
  language,
  children,
}: {
  language?: string;
  children: ReactNode;
}) {
  const browserLanguage = typeof navigator === "undefined" ? undefined : navigator.language;
  const urlLanguage = typeof window === "undefined"
    ? undefined
    : new URLSearchParams(window.location.search).get("lang") ?? undefined;
  const localeKey = useMemo(
    () => resolvePreferredLocaleKey(urlLanguage, language, browserLanguage),
    [urlLanguage, language, browserLanguage],
  );
  const locale = useMemo(() => getLocale(localeKey), [localeKey]);

  const value = useMemo(
    () => ({
      locale,
      localeKey,
      t: locale,
    }),
    [locale, localeKey]
  );

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}
