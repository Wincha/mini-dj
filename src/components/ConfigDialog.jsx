import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/context";
import {
  clearLog,
  ERRORS,
  formatEntry,
  formatLog,
  logWarn,
  readLog,
} from "../lib/log";
import {
  bandColorIndex,
  buildWavePalette,
  resolveWaveColors,
  WAVE_PRESETS,
} from "../lib/waveColors";
import { PHRASE_SIZES } from "../audio/structure";
import {
  BEND_RANGES,
  DEFAULT_BEND_RANGE,
  DEFAULT_PITCH_RANGE,
  PITCH_RANGES,
} from "../lib/constants";
import {
  END_WARN_MODES,
  LCD_FONTS,
  STRUCTURE_UNITS,
  TITLE_FONTS,
  MARQUEE_SPEEDS,
  resolveStructurePrefs,
} from "../lib/structurePrefs";

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

// Cómo se llama cada modo de pintado de la pantalla del deck
const FONT_LABELS = {
  rounded: "lcdFontRounded",
  lcd: "lcdFontLcd",
  dot: "lcdFontDot",
};

// Pestañas del diálogo. El orden es el del panel de arriba.
const TABS = [
  { id: "audio", labelKey: "tabAudio" },
  { id: "library", labelKey: "tabLibrary" },
  { id: "display", labelKey: "tabDisplay" },
  { id: "safety", labelKey: "tabSafety" },
  { id: "log", labelKey: "tabLog" },
];

// Pestaña activa entre aperturas del diálogo: dura lo que la sesión de la
// página, sin tocar el localStorage de la configuración.
let lastTab = TABS[0].id;

// Diálogo de configuración, repartido en pestañas: salidas de audio,
// biblioteca y análisis, visualización y seguridad. Todo se guarda en el
// mismo objeto `config` (localStorage "mini-dj-config") y lo aplica
// MiniDJPlayer.
export default function ConfigDialog({ open, onClose, config, onConfigChange }) {
  const { t } = useI18n();
  const [devices, setDevices] = useState([]);
  const [labelsAllowed, setLabelsAllowed] = useState(false);
  const [tab, setTab] = useState(lastTab);
  // El registro se relee al entrar en su pestaña: así refleja lo que haya
  // pasado mientras el diálogo estaba abierto
  const [entries, setEntries] = useState([]);
  const [logFile, setLogFile] = useState("");

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

  useEffect(() => {
    lastTab = tab;
  }, [tab]);

  useEffect(() => {
    if (!open || tab !== "log") return;
    setEntries(readLog());
    window.miniDJDesktop?.logPath?.().then(setLogFile).catch(() => {});
  }, [open, tab]);

  // El registro se descarga tal cual, en orden cronológico: es un log.
  // En la app de escritorio esto abre el diálogo nativo de guardado.
  const downloadLog = () => {
    const blob = new Blob([formatLog()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mini-dj-log-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const copyLog = () => {
    navigator.clipboard
      ?.writeText(formatLog())
      .catch((err) => logWarn(ERRORS.UI_CLIPBOARD, err));
  };

  // Los nombres de los dispositivos requieren permiso de audio
  const requestLabels = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      refreshDevices();
    } catch (err) {
      // Que el usuario diga que no es una respuesta válida, no un fallo
      logWarn(ERRORS.CONFIG_DEVICE_PERMISSION, err);
    }
  };

  if (!open) return null;

  const set = (key, value) => onConfigChange({ ...config, [key]: value });

  // Colores efectivos: el preset elegido, o los del modo personalizado
  const waveColors = resolveWaveColors(config);
  // Ajustes de estructura y fin de pista, ya saneados: el diálogo enseña lo
  // mismo que aplica el deck
  const structure = resolveStructurePrefs(config);

  // Selector pequeño de un ajuste numérico (umbrales, segundos, %)
  const numberSelect = (key, label, options, value) => (
    <label className="flex items-center justify-between gap-2 text-xs text-neutral-400">
      {label}
      <select
        value={value}
        onChange={(e) => set(key, Number(e.target.value))}
        className="w-24 shrink-0 bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-sm text-neutral-200 tabular-nums"
      >
        {options.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );

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

  // Bloques de ajustes, uno por pestaña. Todos van dentro del mismo panel de
  // alto fijo, así que cambiar de pestaña no mueve ni redimensiona el diálogo.
  const panels = {
    audio: (
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
          <p className="text-[10px] text-neutral-500">{t("noMasterSink")}</p>
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
            <p className="text-[10px] text-neutral-500">{t("externalNote")}</p>
          </>
        ) : (
          <p className="text-[10px] text-neutral-500">{t("noSinkSupport")}</p>
        )}

        {/* Pitch: antes vivía en cada deck; se subió aquí para dejarle sitio a
            las cajas de herramientas. Vale para los dos decks. */}
        <h3 className="mt-2 text-sm font-semibold text-neutral-300">
          {t("pitchHeading")}
        </h3>
        <label className="flex items-center justify-between gap-2 text-xs text-neutral-400">
          {t("rangeTitle")}
          <select
            value={
              PITCH_RANGES.includes(Number(config.pitchRange))
                ? Number(config.pitchRange)
                : DEFAULT_PITCH_RANGE
            }
            onChange={(e) => set("pitchRange", Number(e.target.value))}
            className="w-24 shrink-0 bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-sm text-neutral-200 tabular-nums"
          >
            {PITCH_RANGES.map((n) => (
              <option key={n} value={n}>
                ±{n} %
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-2 text-xs text-neutral-400">
          {t("bendRangeLabel")}
          <select
            value={
              BEND_RANGES.includes(Number(config.bendRange))
                ? Number(config.bendRange)
                : DEFAULT_BEND_RANGE
            }
            onChange={(e) => set("bendRange", Number(e.target.value))}
            className="w-24 shrink-0 bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-sm text-neutral-200 tabular-nums"
          >
            {BEND_RANGES.map((n) => (
              <option key={n} value={n}>
                ±{n} %
              </option>
            ))}
          </select>
        </label>
        <p className="text-[10px] text-neutral-500">{t("pitchNote")}</p>
      </div>
    ),

    library: (
      <div className="grid gap-4">
        {/* Análisis del tracklist */}
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold text-neutral-300">
            {t("analysisHeading")}
          </h3>
          {[
            { value: "auto", label: t("analysisAuto") },
            { value: "deck", label: t("analysisDeck") },
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
      </div>
    ),

    display: (
      <div className="grid gap-4">
        {/* Modo de visualización de los VU */}
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold text-neutral-300">
            {t("vuHeading")}
          </h3>
          {[
            { value: "continuous", label: t("vuModeContinuous") },
            { value: "led", label: t("vuModeLed") },
          ].map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer"
            >
              <input
                type="radio"
                name="vuMode"
                checked={(config.vuMode || "led") === opt.value}
                onChange={() => set("vuMode", opt.value)}
                className="accent-emerald-500"
              />
              {opt.label}
            </label>
          ))}
          <p className="text-[10px] text-neutral-500">{t("vuNote")}</p>
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

        {/* Indicador de estructura de la onda */}
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold text-neutral-300">
            {t("structureHeading")}
          </h3>
          <label className="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer">
            <input
              type="checkbox"
              checked={structure.show}
              onChange={(e) => set("showStructure", e.target.checked)}
              className="accent-emerald-500"
            />
            {t("showStructure")}
          </label>
          <p className="text-[10px] text-neutral-500">{t("structureNote")}</p>
          {numberSelect(
            "phraseSize",
            t("phraseSizeLabel"),
            PHRASE_SIZES,
            structure.phraseSize
          )}
          <label className="flex items-center justify-between gap-2 text-xs text-neutral-400">
            {t("structureUnitLabel")}
            <select
              value={structure.unit}
              onChange={(e) => set("structureUnit", e.target.value)}
              className="w-24 shrink-0 bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-sm text-neutral-200"
            >
              {STRUCTURE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {t(u === "bars" ? "unitBars" : "unitKicks")}
                </option>
              ))}
            </select>
          </label>
          {numberSelect(
            "structureWarnAmber",
            t("warnAmberLabel"),
            [8, 16, 32, 64],
            structure.warnAmber
          )}
          {numberSelect(
            "structureWarnRed",
            t("warnRedLabel"),
            [1, 2, 4, 8, 16],
            structure.warnRed
          )}
        </div>

        {/* Marquesina del nombre de la pista en la pantalla del deck */}
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold text-neutral-300">
            {t("lcdHeading")}
          </h3>
          <label className="flex items-center justify-between gap-2 text-xs text-neutral-400">
            {t("marqueeSpeedLabel")}
            <select
              value={structure.marqueeSpeed}
              onChange={(e) => set("marqueeSpeed", Number(e.target.value))}
              className="w-32 shrink-0 bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-sm text-neutral-200"
            >
              {MARQUEE_SPEEDS.map((v) => (
                <option key={v} value={v}>
                  {t(
                    v === 0
                      ? "marqueeOff"
                      : v <= 15
                      ? "marqueeSlow"
                      : v <= 30
                      ? "marqueeNormal"
                      : "marqueeFast"
                  )}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[10px] text-neutral-500">{t("marqueeNote")}</p>
          {/* Mismo orden que en la pantalla del deck: primero el título,
              luego las cifras */}
          <label className="flex items-center justify-between gap-2 text-xs text-neutral-400">
            {t("titleFontLabel")}
            <select
              value={structure.titleFont}
              onChange={(e) => set("titleFont", e.target.value)}
              className="w-32 shrink-0 bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-sm text-neutral-200"
            >
              {TITLE_FONTS.map((f) => (
                <option key={f} value={f}>
                  {t(FONT_LABELS[f])}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-neutral-400">
            {t("lcdFontLabel")}
            <select
              value={structure.lcdFont}
              onChange={(e) => set("lcdFont", e.target.value)}
              className="w-32 shrink-0 bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-sm text-neutral-200"
            >
              {LCD_FONTS.map((f) => (
                <option key={f} value={f}>
                  {t(FONT_LABELS[f])}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[10px] text-neutral-500">{t("lcdFontNote")}</p>
        </div>
      </div>
    ),

    log: (
      <div className="grid gap-2">
        <h3 className="text-sm font-semibold text-neutral-300">
          {t("logHeading")}
        </h3>
        <p className="text-[10px] text-neutral-500">{t("logNote")}</p>
        {logFile && (
          <p className="text-[10px] text-neutral-500 break-all">
            {t("logFile", { path: logFile })}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-400 tabular-nums">
            {t("logCount", { n: entries.length })}
          </span>
          <button
            onClick={downloadLog}
            disabled={!entries.length}
            className="px-2 py-1 rounded-lg bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-40"
          >
            {t("logDownload")}
          </button>
          <button
            onClick={copyLog}
            disabled={!entries.length}
            className="px-2 py-1 rounded-lg bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-40"
          >
            {t("logCopy")}
          </button>
          <button
            onClick={() => {
              clearLog();
              setEntries([]);
            }}
            disabled={!entries.length}
            className="px-2 py-1 rounded-lg bg-neutral-800 border border-neutral-700 text-xs text-neutral-400 hover:text-red-400 hover:border-red-500/50 disabled:opacity-40"
          >
            {t("logClear")}
          </button>
        </div>
        {/* Vista previa, lo último arriba. Alto fijo: la pestaña mide igual
            con cero entradas que con doscientas. */}
        <pre className="h-52 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-[9px] leading-snug text-neutral-400 whitespace-pre-wrap break-all">
          {entries.length
            ? entries.slice().reverse().map(formatEntry).join("\n")
            : t("logEmpty")}
        </pre>
      </div>
    ),

    safety: (
      <div className="grid gap-2">
        <h3 className="text-sm font-semibold text-neutral-300">
          {t("safetyHeading")}
        </h3>
        <label className="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer">
          <input
            type="checkbox"
            checked={config.lockLoadWhilePlaying !== false}
            onChange={(e) => set("lockLoadWhilePlaying", e.target.checked)}
            className="accent-emerald-500"
          />
          {t("lockLoadWhilePlaying")}
        </label>
        <p className="text-[10px] text-neutral-500">
          {t("lockLoadWhilePlayingNote")}
        </p>

        <h3 className="mt-2 text-sm font-semibold text-neutral-300">
          {t("endWarnHeading")}
        </h3>
        <label className="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer">
          <input
            type="checkbox"
            checked={structure.endWarn.enabled}
            onChange={(e) => set("endWarnOn", e.target.checked)}
            className="accent-emerald-500"
          />
          {t("endWarnOn")}
        </label>
        <p className="text-[10px] text-neutral-500">{t("endWarnNote")}</p>
        <label className="flex items-center justify-between gap-2 text-xs text-neutral-400">
          {t("endWarnModeLabel")}
          <select
            value={structure.endWarn.mode}
            onChange={(e) => set("endWarnMode", e.target.value)}
            className="w-32 shrink-0 bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-sm text-neutral-200"
          >
            {END_WARN_MODES.map((m) => (
              <option key={m} value={m}>
                {t(m === "percent" ? "endWarnModePercent" : "endWarnModeSeconds")}
              </option>
            ))}
          </select>
        </label>
        {structure.endWarn.mode === "percent"
          ? numberSelect(
              "endWarnPercent",
              t("endWarnValuePercent"),
              [2, 5, 10, 15, 20],
              structure.endWarn.percent
            )
          : numberSelect(
              "endWarnSeconds",
              t("endWarnValueSeconds"),
              [10, 15, 20, 30, 45, 60, 90],
              structure.endWarn.seconds
            )}
      </div>
    ),
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl flex flex-col gap-3 max-h-[90vh]"
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

        {/* Pestañas temáticas */}
        <div
          role="tablist"
          className="flex gap-1 border-b border-neutral-800 overflow-x-auto"
        >
          {TABS.map((tb) => (
            <button
              key={tb.id}
              role="tab"
              aria-selected={tab === tb.id}
              onClick={() => setTab(tb.id)}
              className={`px-3 py-1.5 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px ${
                tab === tb.id
                  ? "border-emerald-400 text-neutral-100"
                  : "border-transparent text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {t(tb.labelKey)}
            </button>
          ))}
        </div>

        {/* Alto fijo: el diálogo mide lo mismo en todas las pestañas */}
        <div className="h-[min(24rem,58vh)] overflow-y-auto pr-1">
          {panels[tab] || panels.audio}
        </div>
      </div>
    </div>
  );
}
