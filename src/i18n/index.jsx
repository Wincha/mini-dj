import { useCallback, useEffect, useMemo, useState } from "react";
import {
  I18nContext,
  STORAGE_KEY,
  SUPPORTED,
  detectLanguage,
  translate,
} from "./context";

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(detectLanguage);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((code) => {
    if (!SUPPORTED.has(code)) return;
    setLangState(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // almacenamiento no disponible
    }
  }, []);

  const value = useMemo(
    () => ({
      lang,
      setLang,
      t: (key, params) => translate(lang, key, params),
    }),
    [lang, setLang]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
