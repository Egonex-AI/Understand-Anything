import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { getLocale, resolveLocaleKey, type Locale, type LocaleKey } from "../locales";

interface I18nContextValue {
  locale: Locale;
  localeKey: LocaleKey;
  t: Locale;
  setLanguage: (lang: string) => void;
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
  onLanguageChange,
  children,
}: {
  language?: string;
  onLanguageChange?: (lang: string) => void;
  children: ReactNode;
}) {
  const localeKey = useMemo(() => resolveLocaleKey(language), [language]);
  const locale = useMemo(() => getLocale(localeKey), [localeKey]);

  const setLanguage = useCallback(
    (lang: string) => {
      onLanguageChange?.(lang);
    },
    [onLanguageChange]
  );

  const value = useMemo(
    () => ({
      locale,
      localeKey,
      t: locale,
      setLanguage,
    }),
    [locale, localeKey, setLanguage]
  );

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}