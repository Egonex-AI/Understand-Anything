import { createContext, useContext, useMemo, type ReactNode } from "react";
import { getLocale, resolveLocaleKey, type Locale, type LocaleKey } from "../locales";

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
  const localeKey = useMemo(() => resolveLocaleKey(language), [language]);
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