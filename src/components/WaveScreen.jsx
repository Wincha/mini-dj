import { useRef } from "react";
import WaveformCanvas from "./WaveformCanvas";
import TrackOverview from "./TrackOverview";
import { glassOverlay } from "../lib/glass";

// === La pantalla del deck ===
//
// Una sola caja, con aire de pantalla empotrada (borde hundido, cristal con
// luz arriba y sombra abajo), que contiene las dos vistas de la pista:
//
//   ┌───────────────────────────────────┐
//   │  onda ampliada + sus controles    │  ← zoom, seguir, indicador…
//   │  resumen de la pista entera       │  ← fino, para moverse
//   └───────────────────────────────────┘
//
// El pintado NO se sale de aquí: las dos vistas son lienzos independientes y
// la ventana que se ve ampliada viaja entre ellas por un ref (`windowRef`),
// que se escribe en cada frame sin pasar por el estado de React.

export default function WaveScreen({
  // Datos de la pista, comunes a las dos vistas
  waveData,
  bandIndex,
  palette,
  beats,
  structure,
  duration,
  audioRef,
  // Marcas
  cuePoint,
  hotCues,
  loopIn,
  loopOut,
  loopOn,
  loopRolling,
  endWarnAt,
  // Ventana de la onda ampliada
  zoom,
  scroll,
  follow,
  // Interacción de la onda ampliada
  onSeek,
  onDragSeek,
  onNudge,
  onNudgeEnd,
  onWheelZoom,
  // Interacción del resumen: recibe una fracción 0..1 de la pista
  onOverviewSeek,
  overviewTitle,
  // Lo que va flotando encima de la onda (zoom, seguir, avisos, indicador)
  children,
}) {
  // Ventana visible de la onda grande, en fracción de pista. La escribe la
  // onda y la lee el resumen para dibujar el marco.
  const windowRef = useRef({ from: 0, to: 1 });

  return (
    <div
      // Marco hundido: la caja parece un hueco en la mesa, no una pegatina
      className="rounded-xl border border-neutral-950 bg-neutral-900 p-1.5 shadow-[inset_0_2px_7px_rgba(0,0,0,0.85),0_1px_0_rgba(255,255,255,0.05)]"
    >
      <div className="relative">
        <WaveformCanvas
          waveData={waveData}
          bandIndex={bandIndex}
          palette={palette}
          beats={beats}
          cuePoint={cuePoint}
          hotCues={hotCues}
          loopIn={loopIn}
          loopOut={loopOut}
          loopOn={loopOn}
          loopRolling={loopRolling}
          audioRef={audioRef}
          endWarnAt={endWarnAt}
          windowRef={windowRef}
          zoom={zoom}
          scroll={scroll}
          follow={follow}
          onSeek={onSeek}
          onDragSeek={onDragSeek}
          onNudge={onNudge}
          onNudgeEnd={onNudgeEnd}
          onWheelZoom={onWheelZoom}
        />
        {/* El cristal, el mismo que el de la pantalla y el del medidor
            (src/lib/glass.js). Aquí sin el hueco: la caja de fuera ya lo pone. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-md"
          style={glassOverlay({ well: false })}
        />
        {children}
      </div>
      {/* Resumen de la pista entera, pegado debajo */}
      <div className="mt-1.5">
        <TrackOverview
          waveData={waveData}
          bandIndex={bandIndex}
          palette={palette}
          beats={beats}
          structure={structure}
          duration={duration}
          cuePoint={cuePoint}
          hotCues={hotCues}
          loopIn={loopIn}
          loopOut={loopOut}
          audioRef={audioRef}
          windowRef={windowRef}
          onSeek={onOverviewSeek}
          title={overviewTitle}
        />
      </div>
    </div>
  );
}
