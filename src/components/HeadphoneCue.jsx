import { memo, useEffect, useRef, useState } from "react";
import Fader from "./Fader";
import { useI18n } from "../i18n/context";
import { ERRORS, logError } from "../lib/log";

// PFL / pre-escucha: envía el deck (pre-fader, post-EQ) a la salida elegida
// en Config (⚙). Solo tiene sentido con dos dispositivos: el master sigue
// saliendo por su propia salida.
function HeadphoneCue({ engine, cueDeviceId }) {
  const { t } = useI18n();
  const [pfl, setPfl] = useState({ A: false, B: false });
  const [hpVol, setHpVol] = useState(1);
  const audioRef = useRef(null);

  const sinkSupported =
    typeof HTMLMediaElement !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype;

  const ensureCueAudio = () => {
    const el = audioRef.current;
    if (!el) return;
    if (!el.srcObject) el.srcObject = engine.getCueStream();
    // play() aquí siempre ocurre dentro de un gesto del usuario (click)
    el.play().catch(() => {});
  };

  // Aplicar el dispositivo elegido en Config
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !sinkSupported) return;
    el.setSinkId(cueDeviceId || "").catch((err) =>
      logError(ERRORS.AUDIO_SINK_CUE, err, { deviceId: cueDeviceId })
    );
  }, [cueDeviceId, sinkSupported]);

  const togglePfl = (side) => {
    const next = !pfl[side];
    engine.setDeckCue(side, next);
    setPfl((prev) => ({ ...prev, [side]: next }));
    if (next) ensureCueAudio();
  };

  const onHpVol = (v) => {
    setHpVol(v);
    engine.setCueVolume(v);
  };

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 px-4 py-2 shadow-xl flex flex-wrap items-center gap-x-4 gap-y-2">
      <span
        className="text-xs text-neutral-400 shrink-0 whitespace-nowrap"
        title={t("cueBusTitle")}
      >
        {t("cueBus")}
      </span>
      <div className="flex items-center gap-1 shrink-0">
        {["A", "B"].map((side) => (
          <button
            key={side}
            onClick={() => togglePfl(side)}
            className={`px-2 py-1 rounded-lg text-xs font-semibold border whitespace-nowrap ${
              pfl[side]
                ? "bg-amber-400 text-black border-amber-300"
                : "bg-neutral-800 text-neutral-300 border-neutral-700"
            }`}
            title={t("pflTitle", { side })}
          >
            PFL {side}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-1 min-w-40">
        <span className="text-[10px] text-neutral-500 shrink-0">{t("vol")}</span>
        <Fader
          min={0}
          max={1}
          step={0.01}
          value={hpVol}
          onChange={(e) => onHpVol(Number(e.target.value))}
          ticks={11}
          thickness={18}
          accent="#fbbf24"
          resetValue={1}
          title={t("cueVolTitle")}
          ariaLabel={t("vol")}
        />
      </div>
      <audio ref={audioRef} className="hidden" />
    </div>
  );
}

export default memo(HeadphoneCue);
