import { useEffect, useRef, useState } from "react";
import HorizontalSlider from "./HorizontalSlider";

// PFL / pre-escucha: envía el deck (pre-fader, post-EQ) a una salida aparte.
// Solo tiene sentido con dos dispositivos (p.ej. altavoces + auriculares USB):
// el mix master sigue saliendo por la salida por defecto.
export default function HeadphoneCue({ engine }) {
  const [pfl, setPfl] = useState({ A: false, B: false });
  const [hpVol, setHpVol] = useState(1);
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState("");
  const audioRef = useRef(null);

  const sinkSupported =
    typeof HTMLMediaElement !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype;

  useEffect(() => {
    if (!sinkSupported || !navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    const refresh = () =>
      navigator.mediaDevices
        .enumerateDevices()
        .then((all) => {
          if (cancelled) return;
          setDevices(all.filter((d) => d.kind === "audiooutput"));
        })
        .catch(() => {});
    refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
    };
  }, [sinkSupported]);

  const ensureCueAudio = () => {
    const el = audioRef.current;
    if (!el) return;
    if (!el.srcObject) el.srcObject = engine.getCueStream();
    // play() aquí siempre ocurre dentro de un gesto del usuario (click)
    el.play().catch(() => {});
  };

  const togglePfl = (side) => {
    const next = !pfl[side];
    engine.setDeckCue(side, next);
    setPfl((prev) => ({ ...prev, [side]: next }));
    if (next) ensureCueAudio();
  };

  const onDeviceChange = async (e) => {
    const id = e.target.value;
    setDeviceId(id);
    const el = audioRef.current;
    if (!el || !sinkSupported) return;
    try {
      await el.setSinkId(id);
      ensureCueAudio();
    } catch (err) {
      console.error("setSinkId failed", err);
    }
  };

  const onHpVol = (v) => {
    setHpVol(v);
    engine.setCueVolume(v);
  };

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-3 shadow-xl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span
          className="text-xs text-neutral-400"
          title="Pre-escucha (pre-fader): elige una salida distinta (auriculares) para escuchar el deck sin sacarlo al master"
        >
          🎧 Cue
        </span>
        <div className="flex items-center gap-1">
          {["A", "B"].map((side) => (
            <button
              key={side}
              onClick={() => togglePfl(side)}
              className={`px-2 py-1 rounded-lg text-xs font-semibold border ${
                pfl[side]
                  ? "bg-amber-400 text-black border-amber-300"
                  : "bg-neutral-800 text-neutral-300 border-neutral-700"
              }`}
              title={`Pre-escuchar deck ${side} por los auriculares`}
            >
              PFL {side}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] text-neutral-500 shrink-0">Vol</span>
        <HorizontalSlider
          min={0}
          max={1}
          step={0.01}
          value={hpVol}
          onChange={(e) => onHpVol(Number(e.target.value))}
        />
      </div>
      {sinkSupported ? (
        <select
          value={deviceId}
          onChange={onDeviceChange}
          className="mt-2 w-full bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-xs text-neutral-300"
          title="Dispositivo de salida para la pre-escucha"
        >
          <option value="">Salida por defecto</option>
          {devices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `Salida ${i + 1}`}
            </option>
          ))}
        </select>
      ) : (
        <p className="mt-2 text-[10px] text-neutral-500">
          Tu navegador no permite elegir dispositivo de salida (setSinkId).
        </p>
      )}
      <audio ref={audioRef} className="hidden" />
    </div>
  );
}
