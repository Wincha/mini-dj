import { useState, useEffect } from "react";
import HorizontalSlider from "./HorizontalSlider";
import Knob from "./Knob";

export default function Mixer({ engine, eq, setEq }) {
  const [cross, setCross] = useState(0.5);

  useEffect(() => {
    engine.setCrossfader(cross);
  }, [engine, cross]);
  return (
    <div
      className={`items-center justify-between rounded-2xl border border-neutral-400 bg-neutral-900/70 p-5 shadow-xl relative overflow-hidden`}
    >
      <div className="flex flex-colum items-center justify-between">
        <div className="grid grid-rows-4 gap-4">
          <Knob
            label="Gain"
            min={-24}
            max={+12}
            step={0.5}
            value={eq.eqA.gain}
            onChange={(e) =>
              setEq("A", { ...eq.eqA, gain: Number(e.target.value) })
            }
          />
          <Knob
            label="High"
            min={-12}
            max={+12}
            step={0.5}
            value={eq.eqA.high}
            onChange={(e) =>
              setEq("A", { ...eq.eqA, high: Number(e.target.value) })
            }
          />
          <Knob
            label="Mid"
            min={-12}
            max={+12}
            step={0.5}
            value={eq.eqA.mid}
            onChange={(e) =>
              setEq("A", { ...eq.eqA, mid: Number(e.target.value) })
            }
          />
          <Knob
            label="Low"
            min={-12}
            max={+12}
            step={0.5}
            value={eq.eqA.low}
            onChange={(e) =>
              setEq("A", { ...eq.eqA, low: Number(e.target.value) })
            }
          />
        </div>
        <div className="grid grid-rows-4 gap-4">
          <Knob
            label="Gain"
            min={-24}
            max={+12}
            step={0.5}
            value={eq.eqB.gain}
            onChange={(e) =>
              setEq("B", { ...eq.eqB, gain: Number(e.target.value) })
            }
          />
          <Knob
            label="High"
            min={-12}
            max={+12}
            step={0.5}
            value={eq.eqB.high}
            onChange={(e) =>
              setEq("B", { ...eq.eqB, high: Number(e.target.value) })
            }
          />
          <Knob
            label="Mid"
            min={-12}
            max={+12}
            step={0.5}
            value={eq.eqB.mid}
            onChange={(e) =>
              setEq("B", { ...eq.eqB, mid: Number(e.target.value) })
            }
          />
          <Knob
            label="Low"
            min={-12}
            max={+12}
            step={0.5}
            value={eq.eqB.low}
            onChange={(e) =>
              setEq("B", { ...eq.eqB, low: Number(e.target.value) })
            }
          />
        </div>
      </div>
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 shadow-xl w-[auto]">
        <div className="flex items-center justify-between text-xs text-neutral-400 mb-2">
          <span>A</span>
          <span>Crossfader</span>
          <span>B</span>
        </div>
        <HorizontalSlider
          min={0}
          max={1}
          step={0.001}
          value={cross}
          onChange={(e) => setCross(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
