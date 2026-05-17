import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { translations, type Language, type TranslationKey } from "./translations";

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const stored = localStorage.getItem("expag-language");
    if (stored === "pt" || stored === "en") return stored;
    // Detecta idioma do navegador
    return navigator.language.startsWith("pt") ? "pt" : "en";
  });

  useEffect(() => {
    localStorage.setItem("expag-language", language);
    document.documentElement.lang = language === "pt" ? "pt-BR" : "en";
  }, [language]);

  const setLanguage = useCallback((lang: Language) => setLanguageState(lang), []);

  const t = useCallback(
    (key: TranslationKey): string => {
      return translations[language][key] ?? translations.pt[key] ?? key;
    },
    [language],
  );

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n deve ser usado dentro de I18nProvider");
  return ctx;
}
