import { useRef } from "react";

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatDuration(s) {
  if (!Number.isFinite(s)) return "--:--";
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

  // Badge por deck: color si está cargada ahora, gris si ya se pinchó antes
  const badgeState = (track, side) => {
    if (deckTracks[side]?.id === track.id) return "current";
    if (track.playedOn?.[side]) return "played";
    return null;
  };

  const exportList = () => {
    const header = "Nombre;Duración;BPM;Tamaño;Pinchada en";
    const rows = tracks.map((t) => {
      const played = ["A", "B"].filter((s) => t.playedOn?.[s]).join("+");
      return [
        t.name,
        formatDuration(t.duration),
        t.bpm ?? "",
        formatSize(t.size),
        played,
      ].join(";");
    });
    // BOM para que Excel lo abra con acentos correctos
    const blob = new Blob(["﻿" + [header, ...rows].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tracklist.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const badgeClasses = {
    A: {
      current: "bg-cyan-500/30 text-cyan-300",
      played: "bg-neutral-700/60 text-neutral-400",
    },
    B: {
      current: "bg-fuchsia-500/30 text-fuchsia-300",
      played: "bg-neutral-700/60 text-neutral-400",
    },
  };

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold tracking-tight">Canciones</h2>
        <div className="flex items-center gap-2">
          {tracks.length > 0 && (
            <button
              onClick={exportList}
              className="px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-neutral-300 text-sm hover:bg-neutral-700"
              title="Exporta la lista como CSV (nombre, duración, BPM, dónde se pinchó)"
            >
              ⬇ Exportar
            </button>
          )}
          <button
            onClick={() => inputRef.current?.click()}
            className="px-4 py-2 rounded-xl bg-neutral-200 text-neutral-900 text-sm font-semibold hover:bg-white/90"
          >
            + Añadir canciones
          </button>
        </div>
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
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
            >
              {/* Badges de deck (actual en color, historial en gris) */}
              <div className="flex items-center gap-1 w-12 shrink-0">
                {["A", "B"].map((side) => {
                  const state = badgeState(track, side);
                  if (!state) return null;
                  return (
                    <span
                      key={side}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${badgeClasses[side][state]}`}
                      title={
                        state === "current"
                          ? `Cargada ahora en el deck ${side}`
                          : `Ya pinchada en el deck ${side}`
                      }
                    >
                      {side}
                    </span>
                  );
                })}
              </div>
              <span className="truncate text-sm flex-1 min-w-24">
                {track.name}
              </span>
              {/* Columnas alineadas */}
              <span className="w-16 text-right text-xs text-neutral-500 tabular-nums shrink-0 hidden sm:block">
                {formatSize(track.size)}
              </span>
              <span className="w-12 text-right text-xs text-neutral-500 tabular-nums shrink-0">
                {formatDuration(track.duration)}
              </span>
              <span className="w-20 shrink-0 text-center">
                {track.bpm != null ? (
                  <span className="inline-block w-full px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold tabular-nums">
                    {track.bpm} BPM
                  </span>
                ) : track.analyzeFailed ? (
                  <span className="text-[10px] text-neutral-600">BPM ?</span>
                ) : (
                  <span className="text-[10px] text-neutral-500 animate-pulse">
                    pendiente…
                  </span>
                )}
              </span>
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
