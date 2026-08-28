import { useEffect, useState } from "react";
import { useI18n } from "../i18n/context";

// Aviso de actualización (solo en la app de escritorio).
//
// Va en posición fija, no dentro del layout: aparece y desaparece solo, y así
// no mueve nada de la mesa cuando salta.
export default function UpdateToast() {
  const { t } = useI18n();
  const [state, setState] = useState(null); // {status, version, percent}
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const desktop = window.miniDJDesktop;
    if (typeof desktop?.onUpdate !== "function") return;
    return desktop.onUpdate((next) => {
      setState(next);
      // Una versión nueva vuelve a mostrar el aviso aunque se ocultara antes
      if (next?.status === "downloading") setDismissed(false);
    });
  }, []);

  const status = state?.status;
  if (dismissed || (status !== "downloading" && status !== "ready")) return null;

  const version = state?.version || "";
  const ready = status === "ready";

  return (
    <div
      className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border border-neutral-700 bg-neutral-900/95 px-4 py-3 text-xs text-neutral-200 shadow-lg backdrop-blur"
      role="status"
      aria-live="polite"
    >
      <div className="font-semibold">
        {ready
          ? t("updateReady", { version })
          : t("updateDownloading", {
              version,
              percent: state?.percent ?? 0,
            })}
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
