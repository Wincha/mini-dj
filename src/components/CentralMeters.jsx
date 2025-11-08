import { useEffect, useState } from "react";
import VerticalSlider from "./VerticalSlider";

export default function CentralMeters({ engine, master, setMaster }) {
//   const [a, setA] = useState(0),
//     [b, setB] = useState(0);
  const [cross, setCross] = useState(0.5);

  useEffect(() => {
    engine.setCrossfader(cross);
  }, [engine, cross]);

//   useEffect(() => {
//     let timer;
//     const tick = () => {
//       setA(engine?.getRMS("A") ?? 0);
//       setB(engine?.getRMS("B") ?? 0);
//     };
//     timer = setInterval(tick, 33); // ~30fps
//     return () => clearInterval(timer);
//   }, [engine]);

//   const bar = (lvl) => Math.min(1, lvl * 1.7) * 100;

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 shadow-xl flex flex-row items-end gap-6">
      {/* VU A */}
      {/* <div className="flex flex-col items-center gap-2">
        <span className="text-xs text-neutral-400">A</span>
        <div className="w-4 h-48 bg-neutral-800 rounded relative overflow-hidden">
          <div
            className="absolute bottom-0 left-0 right-0 bg-cyan-400"
            style={{ height: `${bar(a)}%` }}
          />
        </div>
      </div> */}
      <div className="flex-1 flex justify-center">
        {/* Crossfader */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 shadow-xl w-[360px]">
          <div className="flex items-center justify-between text-xs text-neutral-400 mb-2">
            <span>A</span>
            <span>Crossfader</span>
            <span>B</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={cross}
            onChange={(e) => setCross(Number(e.target.value))}
            className="w-full accent-white"
          />
        </div>
      </div>
      {/* Crossfader visual (se gestiona en el contenedor) */}
      <div className="flex-2" />
      {/* VU B */}
      {/* <div className="flex flex-col items-center gap-2">
        <span className="text-xs text-neutral-400">B</span>
        <div className="w-4 h-48 bg-neutral-800 rounded relative overflow-hidden">
          <div
            className="absolute bottom-0 left-0 right-0 bg-fuchsia-400"
            style={{ height: `${bar(b)}%` }}
          />
        </div>
      </div> */}

      {/* Master volume (vertical) */}
      <div className="flex flex-col items-center gap-2 ml-6">
        <span className="text-xs text-neutral-400">Master</span>
        <VerticalSlider
          min={0}
          max={1}
          step={0.01}
          value={master}
          onChange={(e) => setMaster(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
