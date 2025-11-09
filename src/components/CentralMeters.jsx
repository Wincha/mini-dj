import HorizontalSlider from "./HorizontalSlider";

// eslint-disable-next-line no-unused-vars
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
      {/* Master volume (vertical) */}
      <div className="flex flex-col items-center gap-2 ml-6">
        <span className="text-xs text-neutral-400">Master</span>
        <HorizontalSlider
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
