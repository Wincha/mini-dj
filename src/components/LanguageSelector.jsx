import { LANGUAGES, useI18n } from "../i18n/context";

export default function LanguageSelector() {
  const { lang, setLang, t } = useI18n();

  return (
    <select
      value={lang}
      onChange={(e) => setLang(e.target.value)}
      title={t("language")}
      aria-label={t("language")}
      className="bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
    >
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
