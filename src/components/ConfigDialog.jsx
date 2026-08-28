import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/context";
import {
  bandColorIndex,
  buildWavePalette,
  resolveWaveColors,
  WAVE_PRESETS,
} from "../lib/waveColors";

// Vista previa de la paleta: una onda de mentira (bombo a negras, cuerpo y
// hats a contratiempo) pintada con el MISMO código que usa el deck, así que
// lo que se ve aquí es exactamente lo que se verá en la onda de verdad.
// Los presets de marca se muestran con su nombre; los demás, traducidos
const PRESET_LABELS = { minidj: "paletteMinidj", mono: "paletteMono" };

function WavePreview({ colors }) {
  const canvasRef = useRef(null);
  const { low, mid, high } = colors;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Se dibuja al doble de resolución: el canvas se estira a lo ancho del
    // diálogo y a 1× se veía borroso
    const SCALE = 2;
    const w = (canvas.width = 264 * SCALE);
    const h = (canvas.height = 40 * SCALE);
    const ctx = canvas.getContext("2d");
    const palette = buildWavePalette({ low, mid, high });

    ctx.fillStyle = "#171717";
    ctx.fillRect(0, 0, w, h);
    const beat = 22 * SCALE;
    for (let x = 0; x < w; x++) {
      const phase = (x % beat) / beat; // un beat cada 22 px lógicos
      const kick = Math.exp(-phase * 9);
      const hats = phase > 0.45 && phase < 0.62 ? 0.85 : 0.12;
      const body = 0.45 + 0.25 * Math.sin(x / (17 * SCALE));
      const hi = hats * (0.55 + 0.45 * Math.sin(x / (5 * SCALE)));
      const amp = Math.min(1, 0.3 + 0.7 * Math.max(kick, body * 0.8, hi * 0.7));
      ctx.fillStyle = palette[bandColorIndex(kick, body, hi)];
      ctx.fillRect(x, (1 - amp) * h * 0.5, 1, amp * h);
    }
  }, [low, mid, high]);

  return <canvas ref={canvasRef} className="w-full h-10 rounded-lg" />;
}

// Diálogo de configuración: salidas de audio (tarjeta/salida por destino),
// modo de análisis del tracklist y opciones de la lista. Los cambios se
// aplican desde MiniDJPlayer.
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

  // Colores efectivos: el preset elegido, o los del modo personalizado
  const waveColors = resolveWaveColors(config);

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

        {/* Lista de canciones */}
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold text-neutral-300">
            {t("listHeading")}
          </h3>
          <label className="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer">
            <input
              type="checkbox"
              checked={config.showArtwork !== false}
              onChange={(e) => set("showArtwork", e.target.checked)}
              className="accent-emerald-500"
            />
            {t("showArtwork")}
          </label>
          <p className="text-[10px] text-neutral-500">{t("showArtworkNote")}</p>
          <label className="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer">
            <input
              type="checkbox"
              checked={config.showKey !== false}
              onChange={(e) => set("showKey", e.target.checked)}
              className="accent-emerald-500"
            />
            {t("showKey")}
          </label>
        </div>

        {/* Colores de la onda */}
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold text-neutral-300">
            {t("wavePaletteHeading")}
          </h3>
          <select
            value={config.wavePreset || WAVE_PRESETS[0].id}
            onChange={(e) => {
              const next = e.target.value;
              if (next === "custom" && !config.waveCustom) {
                onConfigChange({
                  ...config,
                  wavePreset: next,
                  waveCustom: waveColors,
                });
              } else {
                set("wavePreset", next);
              }
            }}
            className="bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1.5 text-sm text-neutral-200"
          >
            {WAVE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.brand || t(PRESET_LABELS[preset.id])}
              </option>
            ))}
            <option value="custom">{t("paletteCustom")}</option>
          </select>

          {config.wavePreset === "custom" && (
            <div className="flex flex-wrap gap-3">
              {[
                ["low", t("bandLow")],
                ["mid", t("bandMid")],
                ["high", t("bandHigh")],
              ].map(([band, label]) => (
                <label
                  key={band}
                  className="flex items-center gap-1.5 text-xs text-neutral-400 cursor-pointer"
                >
                  <input
                    type="color"
                    value={waveColors[band]}
                    onChange={(e) =>
                      set("waveCustom", { ...waveColors, [band]: e.target.value })
                    }
                    className="w-8 h-8 rounded border border-neutral-700 bg-neutral-800 cursor-pointer"
                  />
                  {label}
                </label>
              ))}
            </div>
          )}

          <WavePreview colors={waveColors} />
          <p className="text-[10px] text-neutral-500">{t("wavePaletteNote")}</p>
        </div>
      </div>
    </div>
  );
}
