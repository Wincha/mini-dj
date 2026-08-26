import { useRef } from "react";

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatDuration(s) {
  if (!Number.isFinite(s)) return "";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function TrackList({
  tracks,
  deckTracks,
  onAddTracks,
  onLoadToDeck,
  onRemoveTrack,
}) {
  const inputRef = useRef(null);

  const onFiles = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) onAddTracks(files);
    // permite volver a seleccionar los mismos archivos
    e.target.value = "";
  };

  const deckBadge = (track) => {
    const badges = [];
    if (deckTracks.A?.id === track.id) badges.push("A");
    if (deckTracks.B?.id === track.id) badges.push("B");
    return badges;
  };

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold tracking-tight">Canciones</h2>
        <button
          onClick={() => inputRef.current?.click()}
          className="px-4 py-2 rounded-xl bg-neutral-200 text-neutral-900 text-sm font-semibold hover:bg-white/90"
        >
          + Añadir canciones
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.ogg,.flac"
          multiple
          onChange={onFiles}
          className="hidden"
        />
      </div>

      {tracks.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Añade canciones para cargarlas en los decks A o B.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-800 max-h-64 overflow-y-auto">
          {tracks.map((track) => (
            <li
              key={track.id}
              className="flex flex-wrap items-center gap-2 py-2"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 flex-1 min-w-0">
                {deckBadge(track).map((side) => (
                  <span
                    key={side}
                    className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      side === "A"
                        ? "bg-cyan-500/30 text-cyan-300"
                        : "bg-fuchsia-500/30 text-fuchsia-300"
                    }`}
                  >
                    {side}
                  </span>
                ))}
                <span className="truncate text-sm min-w-24 max-w-full">
                  {track.name}
                </span>
                <span className="shrink-0 text-xs text-neutral-500">
                  {formatSize(track.size)}
                </span>
                {track.duration != null && (
                  <span className="shrink-0 text-xs text-neutral-500">
                    {formatDuration(track.duration)}
                  </span>
                )}
                {track.bpm != null ? (
                  <span className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold">
                    {track.bpm} BPM
                  </span>
                ) : track.analyzeFailed ? (
                  <span className="shrink-0 text-[10px] text-neutral-600">
                    BPM ?
                  </span>
                ) : (
                  <span className="shrink-0 text-[10px] text-neutral-500 animate-pulse">
                    analizando…
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => onLoadToDeck("A", track)}
                  className="px-3 py-1 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-semibold hover:bg-cyan-500/30"
                >
                  → A
                </button>
                <button
                  onClick={() => onLoadToDeck("B", track)}
                  className="px-3 py-1 rounded-lg bg-fuchsia-500/20 border border-fuchsia-500/40 text-fuchsia-300 text-xs font-semibold hover:bg-fuchsia-500/30"
                >
                  → B
                </button>
                <button
                  onClick={() => onRemoveTrack(track.id)}
                  className="px-2 py-1 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-400 text-xs hover:text-red-400 hover:border-red-500/50"
                  title="Quitar de la lista"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
