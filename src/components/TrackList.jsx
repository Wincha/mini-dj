import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/context";
import {
  camelotSortIndex,
  harmonicRelation,
  keyLabel,
} from "../lib/camelot";

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

// Nombre a mostrar: título de las etiquetas si lo hay, si no el archivo
function displayTitle(track) {
  return track.title || track.name;
}

// Miniatura de carátula: un solo object URL por pista, reciclado mientras la
// pista siga en la lista. Guardar el Blob y crear la URL aquí evita tener que
// meter URLs en el estado (que habría que revocar en cada render).
function useArtworkUrls(tracks, enabled) {
  const urlsRef = useRef(new Map());

  useEffect(() => {
    if (!enabled) return;
    const alive = new Set(tracks.map((t) => t.id));
    for (const [id, url] of urlsRef.current) {
      if (!alive.has(id)) {
        URL.revokeObjectURL(url);
        urlsRef.current.delete(id);
      }
    }
  }, [tracks, enabled]);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  return (track) => {
    if (!track.artwork) return null;
    let url = urlsRef.current.get(track.id);
    if (!url) {
      url = URL.createObjectURL(track.artwork);
      urlsRef.current.set(track.id, url);
    }
    return url;
  };
}

function TrackList({
  tracks,
  deckTracks,
  onAddTracks,
  onLoadToDeck,
  onRemoveTrack,
  referenceKey,
  showArtwork,
  onToggleArtwork,
  showKey,
  playing,
  lockLoadWhilePlaying,
}) {
  const { t } = useI18n();
  const inputRef = useRef(null);
  const artworkUrl = useArtworkUrls(tracks, showArtwork);

  // Búsqueda y ordenación
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("added");
  const [sortDir, setSortDir] = useState(1);
  // Con la columna de tonalidad oculta, ordenar por ella no tendría sentido
  const activeSort = showKey || sortBy !== "key" ? sortBy : "added";

  const visibleTracks = useMemo(() => {
    let list = tracks;
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((tr) =>
        [tr.name, tr.title, tr.artist, tr.album].some((v) =>
          v ? v.toLowerCase().includes(q) : false
        )
      );
    }
    if (activeSort !== "added") {
      list = [...list].sort((a, b) => {
        let r = 0;
        if (activeSort === "name")
          r = displayTitle(a).localeCompare(displayTitle(b));
        else if (activeSort === "bpm") r = (a.bpm ?? 1e9) - (b.bpm ?? 1e9);
        else if (activeSort === "duration")
          r = (a.duration ?? 1e9) - (b.duration ?? 1e9);
        else if (activeSort === "key")
          r =
            camelotSortIndex(a.musicalKey?.pitchClass, a.musicalKey?.mode) -
            camelotSortIndex(b.musicalKey?.pitchClass, b.musicalKey?.mode);
        return r * sortDir;
      });
    } else if (sortDir === -1) {
      list = [...list].reverse();
    }
    return list;
  }, [tracks, query, activeSort, sortDir]);

  const onFiles = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) onAddTracks(files);
    // permite volver a seleccionar los mismos archivos
    e.target.value = "";
  };

  // Con el bloqueo puesto, un deck que está sonando no admite otra pista:
  // su botón sale deshabilitado en TODAS las filas, con el motivo en el
  // tooltip. Nada de botones que parecen pulsables y no hacen nada.
  const deckBlocked = {
    A: Boolean(lockLoadWhilePlaying && playing?.A),
    B: Boolean(lockLoadWhilePlaying && playing?.B),
  };

  const loadBtnClass = {
    A: "bg-cyan-500/20 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30",
    B: "bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-300 hover:bg-fuchsia-500/30",
  };

  // Badge por deck: color si está cargada ahora, gris si ya se pinchó antes
  const badgeState = (track, side) => {
    if (deckTracks[side]?.id === track.id) return "current";
    if (track.playedOn?.[side]) return "played";
    return null;
  };

  const exportList = () => {
    const header = [
      t("csvName"),
      t("csvArtist"),
      t("csvDuration"),
      t("csvBpm"),
      t("csvKey"),
      t("csvSize"),
      t("csvPlayedOn"),
    ].join(";");
    const rows = tracks.map((tr) => {
      const played = ["A", "B"].filter((s) => tr.playedOn?.[s]).join("+");
      return [
        displayTitle(tr),
        tr.artist ?? "",
        formatDuration(tr.duration),
        tr.bpm != null ? tr.bpm.toFixed(2) : "",
        keyLabel(tr.musicalKey?.pitchClass, tr.musicalKey?.mode) ?? "",
        formatSize(tr.size),
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

  // Estilo del badge de tonalidad según su relación con la pista que suena
  const keyBadge = (track) => {
    const own = track.musicalKey;
    if (!own) {
      return {
        className: "text-neutral-600",
        title: t("keyUnknownTitle"),
      };
    }
    const relation = referenceKey ? harmonicRelation(own, referenceKey) : null;
    if (relation === "same") {
      return {
        className:
          "bg-violet-500/35 text-violet-100 ring-1 ring-violet-400/60",
        title: t("keySameTitle"),
      };
    }
    if (relation === "compatible") {
      return {
        className: "bg-violet-500/20 text-violet-300",
        title: t("keyCompatibleTitle"),
      };
    }
    return {
      className: referenceKey
        ? "bg-neutral-800/60 text-neutral-500"
        : "bg-neutral-800 text-neutral-300",
      title: referenceKey ? t("keyClashTitle") : t("keyTitle"),
    };
  };

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold tracking-tight">{t("songs")}</h2>
        {tracks.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search")}
              className="w-40 bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-500"
            />
            <select
              value={activeSort}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1.5 text-sm text-neutral-300"
              title={t("sortByTitle")}
            >
              <option value="added">{t("sortAdded")}</option>
              <option value="name">{t("sortName")}</option>
              <option value="bpm">{t("sortBpm")}</option>
              {showKey && <option value="key">{t("sortKey")}</option>}
              <option value="duration">{t("sortDuration")}</option>
            </select>
            <button
              onClick={() => setSortDir((d) => -d)}
              className="px-2 py-1.5 rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-300 hover:bg-neutral-700"
              title={t("reverseTitle")}
            >
              {sortDir === 1 ? "↑" : "↓"}
            </button>
            {/* Mismo ajuste que en Config ⚙: quitar las miniaturas para
                ganar sitio en pantalla */}
            <label
              className="flex items-center gap-1.5 text-xs text-neutral-400 cursor-pointer select-none whitespace-nowrap"
              title={t("showArtworkTitle")}
            >
              <input
                type="checkbox"
                checked={showArtwork}
                onChange={(e) => onToggleArtwork(e.target.checked)}
                className="accent-emerald-500"
              />
              {t("showArtwork")}
            </label>
          </div>
        )}
        <div className="flex items-center gap-2">
          {tracks.length > 0 && (
            <button
              onClick={exportList}
              className="px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-neutral-300 text-sm hover:bg-neutral-700"
              title={t("exportTitle")}
            >
              {t("export")}
            </button>
          )}
          <button
            onClick={() => inputRef.current?.click()}
            className="px-4 py-2 rounded-xl bg-neutral-200 text-neutral-900 text-sm font-semibold hover:bg-white/90"
          >
            {t("addSongs")}
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
          {t("emptyList")}
        </p>
      ) : visibleTracks.length === 0 ? (
        <p className="text-sm text-neutral-500">
          {t("noMatch", { query })}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-800 max-h-64 overflow-y-auto">
          {visibleTracks.map((track) => {
            const art = showArtwork ? artworkUrl(track) : null;
            const badge = showKey ? keyBadge(track) : null;
            return (
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
                            ? t("badgeCurrentTitle", { side })
                            : t("badgePlayedTitle", { side })
                        }
                      >
                        {side}
                      </span>
                    );
                  })}
                </div>
                {/* Carátula: hueco fijo de 32 px. Sin carátula se pinta un
                    marcador discreto, así las filas nunca se descuadran. */}
                {showArtwork &&
                  (art ? (
                    <img
                      src={art}
                      alt=""
                      loading="lazy"
                      className="w-8 h-8 shrink-0 rounded object-cover border border-neutral-700"
                    />
                  ) : (
                    <div
                      className="w-8 h-8 shrink-0 rounded border border-neutral-800 bg-neutral-800/50 grid place-items-center text-neutral-600 text-xs"
                      title={t("noArtworkTitle")}
                      aria-hidden
                    >
                      ♪
                    </div>
                  ))}
                {/* Título + artista: dos líneas siempre, aunque no haya
                    artista, para que todas las filas midan lo mismo */}
                <div className="flex-1 min-w-24 grid">
                  <span className="truncate text-sm leading-tight">
                    {displayTitle(track)}
                  </span>
                  <span className="truncate text-[11px] leading-tight text-neutral-500">
                    {track.artist || " "}
                  </span>
                </div>
                {/* Columnas alineadas */}
                <span className="w-16 text-right text-xs text-neutral-500 tabular-nums shrink-0 hidden sm:block">
                  {formatSize(track.size)}
                </span>
                <span className="w-12 text-right text-xs text-neutral-500 tabular-nums shrink-0">
                  {formatDuration(track.duration)}
                </span>
                {showKey && (
                  <span className="w-20 shrink-0 text-center">
                    <span
                      className={`inline-block w-full px-1.5 py-0.5 rounded text-[10px] font-semibold truncate ${badge.className}`}
                      title={badge.title}
                    >
                      {keyLabel(
                        track.musicalKey?.pitchClass,
                        track.musicalKey?.mode
                      ) || t("keyNone")}
                    </span>
                  </span>
                )}
                <span className="w-24 shrink-0 text-center">
                  {track.bpm != null ? (
                    <span className="inline-block w-full px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold tabular-nums truncate">
                      {track.bpm.toFixed(1)} {t("bpm")}
                    </span>
                  ) : track.analyzeFailed ? (
                    <span className="text-[10px] text-neutral-600">{t("bpmUnknown")}</span>
                  ) : (
                    <span className="text-[10px] text-neutral-500 animate-pulse">
                      {t("pendingAnalysis")}
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {["A", "B"].map((side) => {
                    const blocked = deckBlocked[side];
                    return (
                      // El title va en el envoltorio: un <button disabled> no
                      // dispara eventos de ratón y el navegador no le enseña
                      // el tooltip
                      <span
                        key={side}
                        className="inline-flex"
                        title={
                          blocked
                            ? t("loadLockedTitle", { side })
                            : t("loadToDeckTitle", { side })
                        }
                      >
                        <button
                          onClick={() => onLoadToDeck(side, track)}
                          disabled={blocked}
                          aria-disabled={blocked}
                          className={`px-3 py-1 rounded-lg border text-xs font-semibold whitespace-nowrap ${
                            blocked
                              ? "bg-neutral-800/60 border-neutral-700 text-neutral-600 opacity-60 cursor-not-allowed"
                              : loadBtnClass[side]
                          }`}
                        >
                          {t("loadToDeck", { side })}
                        </button>
                      </span>
                    );
                  })}
                  <button
                    onClick={() => onRemoveTrack(track.id)}
                    className="px-2 py-1 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-400 text-xs hover:text-red-400 hover:border-red-500/50"
                    title={t("removeTitle")}
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Leyenda: solo aparece cuando hay una pista sonando con tonalidad */}
      {showKey && referenceKey && (
        <p className="mt-2 text-[10px] text-neutral-500">
          {t("keyLegend", {
            key: keyLabel(referenceKey.pitchClass, referenceKey.mode),
          })}
        </p>
      )}
    </div>
  );
}

export default memo(TrackList);
