import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "@/web/components/locales/en";
import { ptBR } from "@/web/components/locales/pt-BR";

declare module "i18next" {
  interface CustomTypeOptions {
    resources: { translation: typeof ptBR };
  }
}

export const languages = ["pt-BR", "en"] as const;
export type Language = (typeof languages)[number];
const storageKey = "pico-language";

export function savedLanguage(): Language {
  try {
    const stored = localStorage.getItem(storageKey);
    const match = languages.find((language) => language === stored);
    if (match) return match;
  } catch {}
  return "pt-BR";
}

void i18n.use(initReactI18next).init({
  resources: { "pt-BR": { translation: ptBR }, en: { translation: en } },
  lng: savedLanguage(),
  fallbackLng: "pt-BR",
  supportedLngs: languages,
  initAsync: false,
  interpolation: { escapeValue: false },
});

export function currentLanguage(): Language {
  return languages.find((language) => language === i18n.language) ?? "pt-BR";
}

export function setLanguage(language: Language) {
  void i18n.changeLanguage(language);
  try {
    localStorage.setItem(storageKey, language);
  } catch {}
}

export { Trans, useTranslation } from "react-i18next";
export { i18n };
