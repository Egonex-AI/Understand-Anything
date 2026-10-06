import en from "./en";
import zh from "./zh";
import zhTW from "./zh-TW";
import ja from "./ja";
import ko from "./ko";
import ru from "./ru";
import vi from "./vi";
import ptBR from "./pt-BR";

export type LocaleKey = "en" | "zh" | "zh-TW" | "ja" | "ko" | "ru" | "vi" | "pt-BR";
export type Locale = typeof en;

export const locales: Record<LocaleKey, Locale> = {
  en,
  zh,
  "zh-TW": zhTW,
  ja,
  ko,
  ru,
  vi,
  "pt-BR": ptBR,
};

export function getLocale(key: LocaleKey): Locale {
  return locales[key] ?? locales.en;
}

export function resolveLocaleKey(lang: string | undefined): LocaleKey {
  if (!lang) return "en";
  const normalized = lang.toLowerCase().replace(/[_\s]/g, "-");
  if (normalized === "zh" || normalized === "chinese" || normalized === "zh-cn") return "zh";
  if (normalized === "zh-tw" || normalized === "traditional-chinese") return "zh-TW";
  if (normalized === "ja" || normalized === "japanese") return "ja";
  if (normalized === "ko" || normalized === "korean") return "ko";
  if (normalized === "ru" || normalized === "russian" || normalized === "ru-ru") return "ru";
  if (normalized === "vi" || normalized === "vietnamese" || normalized === "vi-vn") return "vi";
  if (normalized === "pt" || normalized === "pt-br" || normalized === "portuguese" || normalized === "brazilian-portuguese") return "pt-BR";
  return "en";
}

export { en, zh, zhTW as "zh-TW", ja, ko, ru, vi, ptBR as "pt-BR" };
