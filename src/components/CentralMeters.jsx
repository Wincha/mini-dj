import HorizontalSlider from "./HorizontalSlider";
import VUBar from "./VUBar";

export default function CentralMeters({ engine, master, setMaster }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 shadow-xl flex gap-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Mini DJ Mixer
          </h1>
          <p className="text-sm text-neutral-400">
            by Dj Wincha (Under construction)
          </p>
        </div>
      </header>
      {/* Master volume (horizontal) */}
      <div className="flex flex-col gap-2 ml-6 w-full max-w-md">
        <span className="text-xs text-neutral-400">Master</span>
        <HorizontalSlider
          min={0}
          max={1}
          step={0.01}
          value={master}
          onChange={(e) => setMaster(Number(e.target.value))}
          className="w-full" // si tu componente lo soporta
        />
        <VUBar engine={engine} side="Both" direction="horizontal" />
      </div>
    </div>
  );
}
