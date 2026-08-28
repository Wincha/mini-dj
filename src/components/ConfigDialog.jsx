import { useEffect, useState } from "react";
import { useI18n } from "../i18n/context";

// Diálogo de configuración: salidas de audio (tarjeta/salida por destino)
// y modo de análisis del tracklist. Los cambios se aplican desde MiniDJPlayer.
export default function ConfigDialog({ open, onClose, config, onConfigChange }) {
  const { t } = useI18n();
  const [devices, setDevices] = useState([]);
  const [labelsAllowed, setLabelsAllowed] = useState(false);

  const sinkSupported =
    typeof HTMLMediaElement !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype;
  const ctxSinkSupported =
    typeof AudioContext !== "undefined" &&
    typeof AudioContext.prototype.setSinkId === "function";

  const refreshDevices = () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices
      .enumerateDevices()
      .then((all) => {
        const outs = all.filter((d) => d.kind === "audiooutput");
        setDevices(outs);
        setLabelsAllowed(outs.some((d) => d.label));
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (open) refreshDevices();
  }, [open]);

  // Los nombres de los dispositivos requieren permiso de audio
  const requestLabels = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      refreshDevices();
    } catch (err) {
      console.error("Permiso de audio denegado", err);
    }
  };

  if (!open) return null;

  const set = (key, value) => onConfigChange({ ...config, [key]: value });

  const deviceSelect = (key, label, extraOption) => (
    <label className="flex flex-col gap-1 text-xs text-neutral-400">
      {label}
      <select
        value={config[key] || ""}
        onChange={(e) => set(key, e.target.value)}
        className="bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1.5 text-sm text-neutral-200"
      >
        <option value="">{extraOption}</option>
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || t("outputDevice", { n: i + 1 })}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl grid gap-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("configHeading")}</h2>
          <button
            onClick={onClose}
            className="px-2 py-1 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-300 text-sm hover:bg-neutral-700"
            title={t("close")}
          >
            ✕
          </button>
        </div>

        {/* Salidas de audio */}
        <div className="grid gap-3">
          <h3 className="text-sm font-semibold text-neutral-300">
            {t("audioOutputs")}
          </h3>
          {!labelsAllowed && devices.length > 0 && (
            <button
              onClick={requestLabels}
              className="px-3 py-1.5 rounded-lg bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 hover:bg-neutral-700 text-left"
            >
              {t("requestLabels")}
            </button>
          )}
          {ctxSinkSupported ? (
            deviceSelect("masterOut", t("masterMix"), t("defaultOutput"))
          ) : (
            <p className="text-[10px] text-neutral-500">
              {t("noMasterSink")}
            </p>
          )}
          {sinkSupported ? (
            <>
              {deviceSelect("cueOut", t("preListenOut"), t("defaultOutput"))}
              {deviceSelect(
                "deckAOut",
                t("deckExternal", { side: "A" }),
                t("internalMix")
              )}
              {deviceSelect(
                "deckBOut",
                t("deckExternal", { side: "B" }),
                t("internalMix")
              )}
              <p className="text-[10px] text-neutral-500">
                {t("externalNote")}
              </p>
            </>
          ) : (
            <p className="text-[10px] text-neutral-500">
              {t("noSinkSupport")}
            </p>
          )}
        </div>

        {/* Análisis del tracklist */}
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold text-neutral-300">
            {t("analysisHeading")}
          </h3>
          {[
            {
              value: "auto",
              label: t("analysisAuto"),
            },
            {
              value: "deck",
              label: t("analysisDeck"),
            },
          ].map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer"
            >
              <input
                type="radio"
                name="analysisMode"
                checked={(config.analysisMode || "auto") === opt.value}
                onChange={() => set("analysisMode", opt.value)}
                className="accent-emerald-500"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
