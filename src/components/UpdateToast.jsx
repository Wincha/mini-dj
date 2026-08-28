import { useEffect, useState } from "react";
import { useI18n } from "../i18n/context";

// Aviso de actualización (solo en la app de escritorio).
//
// Va en posición fija, no dentro del layout: aparece y desaparece solo, y así
// no mueve nada de la mesa cuando salta.
//
// Estados que puede mandar el proceso principal: checking · downloading ·
// ready · upToDate · error. Los tres que no piden nada al usuario se quitan
// solos; "ready" se queda, que lleva botones.
const VISIBLE = new Set(["checking", "downloading", "ready", "upToDate", "error"]);

// Cuánto aguanta en pantalla cada estado (0 = hasta que el usuario decida).
// "checking" tiene tope por si la comprobación se queda colgada sin contestar
// ni con error: mejor que se vaya a que se quede el mensaje para siempre.
const AUTO_HIDE_MS = {
  checking: 20000,
  upToDate: 6000,
  error: 8000,
};

export default function UpdateToast() {
  const { t } = useI18n();
  const [state, setState] = useState(null); // {status, version, percent, detail}
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const desktop = window.miniDJDesktop;
    if (typeof desktop?.onUpdate !== "function") return;
    return desktop.onUpdate((next) => {
      setState(next);
      // Cualquier novedad vuelve a mostrar el aviso aunque se ocultara antes
      setDismissed(false);
    });
  }, []);

  const status = state?.status;

  useEffect(() => {
    const ms = AUTO_HIDE_MS[status];
    if (!ms) return;
    const id = setTimeout(() => setDismissed(true), ms);
    return () => clearTimeout(id);
  }, [status, state]);

  if (dismissed || !VISIBLE.has(status)) return null;

  const version = state?.version || "";
  const ready = status === "ready";

  const headline = {
    checking: t("updateChecking"),
    downloading: t("updateDownloading", {
      version,
      percent: state?.percent ?? 0,
    }),
    ready: t("updateReady", { version }),
    upToDate: t("updateUpToDate"),
    error: t("updateError"),
  }[status];

  return (
    <div
      className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border border-neutral-700 bg-neutral-900/95 px-4 py-3 text-xs text-neutral-200 shadow-lg backdrop-blur"
      role="status"
      aria-live="polite"
      // El detalle técnico del fallo no se enseña, pero está a un hover
      title={status === "error" ? state?.detail || undefined : undefined}
    >
      <div
        className={`font-semibold ${
          status === "error"
            ? "text-red-300"
            : status === "checking"
            ? "text-neutral-400"
            : ""
        }`}
      >
        {headline}
      </div>
      {ready && (
        <>
          <p className="mt-1 text-[11px] text-neutral-400">
            {t("updateReadyHint")}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => window.miniDJDesktop?.installUpdate?.()}
              className="rounded-lg bg-emerald-500 px-3 py-1 font-semibold text-black"
            >
              {t("updateInstall")}
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1 text-neutral-300"
            >
              {t("updateLater")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
