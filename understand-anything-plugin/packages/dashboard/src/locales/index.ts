import en from "./en";
import zh from "./zh";
import zhTW from "./zh-TW";
import ja from "./ja";
import ko from "./ko";
import ru from "./ru";

export type LocaleKey = "en" | "zh" | "zh-TW" | "ja" | "ko" | "ru";
export type Locale = typeof en;

export const locales: Record<LocaleKey, Locale> = {
  en,
  zh,
  "zh-TW": zhTW,
  ja,
  ko,
  ru,
};

export function getLocale(key: LocaleKey): Locale {
  return locales[key] ?? locales.en;
}

export function resolveLocaleKey(lang: string | undefined): LocaleKey {
  if (!lang) return "en";
  const normalized = lang.toLowerCase().replace(/[_\s]/g, "-");
  if (
    normalized === "zh" ||
    normalized === "chinese" ||
    normalized === "zh-cn" ||
    normalized.startsWith("zh-cn-")
  )
    return "zh";
  if (normalized === "zh-tw" || normalized === "traditional-chinese") return "zh-TW";
  if (normalized === "zh-hk" || normalized.startsWith("zh-hk-")) return "zh";
  if (
    normalized === "ja" ||
    normalized === "japanese" ||
    normalized.startsWith("ja-")
  )
    return "ja";
  if (
    normalized === "ko" ||
    normalized === "korean" ||
    normalized.startsWith("ko-")
  )
    return "ko";
  if (normalized === "ru" || normalized === "russian" || normalized === "ru-ru") return "ru";
  if (normalized.startsWith("ru-")) return "ru";
  return "en";
}

export function resolvePreferredLocaleKey(
  urlLanguage: string | undefined,
  configuredLanguage: string | undefined,
  browserLanguage: string | undefined,
): LocaleKey {
  return resolveLocaleKey(urlLanguage ?? configuredLanguage ?? browserLanguage);
}

export { en, zh, zhTW as "zh-TW", ja, ko, ru };
