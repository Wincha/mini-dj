export default {
  // Cabecera
  subtitle: "por Dj Wincha (en construcción)",
  rec: "● REC",
  recTitle: "Graba el mix master; al parar se descarga como .webm",
  master: "Master",
  configTitle: "Configuración: salidas de audio y análisis",
  masterSync: "MASTER SYNC",
  masterSyncTitle:
    "Master sync: los decks con SYNC siguen este BPM en vez del otro deck",
  masterBpmTitle: "BPM del master sync",
  bpm: "BPM",
  language: "Idioma",

  // Beat match
  beatMatch: "Beat match",
  beatMatchTitle:
    "Con el SYNC puesto, alinea las marcas rojas de beats con nudge / arrastrando la onda",
  deckNoTrack: "Deck {side} — sin pista",

  // Deck
  deck: "Deck {side}",
  keyboardBadge: "TECLADO",
  keyboardBadgeTitle: "Deck activo: recibe los atajos de teclado",
  noFile: "Sin Archivo",
  loadFile: "📂 Cargar archivo",
  cue: "CUE",
  cueTitle:
    "Punto CUE: se fija al posicionar la pista en pausa; Stop vuelve aquí",
  bpmNone: "BPM --",
  bpmDisplayTitle:
    "Haz click al ritmo (TAP): reancla la rejilla de beats y recalcula el BPM",
  analyzingTrack: "⏳ Analizando pista…",
  detectingBpm: "⏳ Detectando BPM…",
  follow: "🔁 Seguir",
  followTitle: "Volver a seguir la reproducción",
  play: "▶︎ Play",
  pause: "❚❚ Pausa",
  stop: "■ Stop",
  stopTitle: "Para y vuelve al punto CUE",
  sync: "SYNC",
  syncTitle:
    "Activa sync continuo: este deck seguirá el BPM del otro deck o del master",
  syncActiveTitle:
    "Sync fijado: sigue el BPM de {source} (el pitch se ajusta solo)",
  keyLock: "🔒 Key",
  keyLockTitle:
    "Key lock: mantiene el tono al cambiar el tempo (OFF = modo vinilo)",
  rangeTitle: "Rango del fader de pitch",
  pitch: "Pitch",
  bend: "bend",
  bendMinusTitle: "Bend − (más lento mientras mantienes)",
  bendPlusTitle: "Bend + (más rápido mientras mantienes)",
  hotCueSetTitle: "Hot cue {n}: fijar en la posición actual",
  hotCueGoTitle:
    "Hot cue {n}: saltar a {time} · borrar con click derecho o Shift+click",
  jump: "Jump",
  jumpBackTitle: "Salta {n} beats hacia atrás",
  jumpFwdTitle: "Salta {n} beats hacia delante",
  jumpSizeTitle: "Tamaño del salto en beats",
  tap: "TAP",
  tapTitle:
    "Pulsa al ritmo mientras suena: reancla la rejilla de beats en cada tap y con varios taps recalcula el BPM",
  quantizeTitle:
    "Quantize: imanta hot cues, loops y saltos al beat más cercano de la rejilla",
  loop: "Loop",
  loopIn: "IN",
  loopInTitle: "Marca el inicio del loop en la posición actual",
  loopOut: "OUT",
  loopOutTitle: "Marca el final del loop y lo activa",
  loop4Title: "Loop automático de 4 beats desde el beat anterior",
  loop8Title: "Loop automático de 8 beats desde el beat anterior",
  loopToggleTitle: "Activa/desactiva el loop marcado",

  // Mixer
  gain: "Gain",
  high: "High",
  mid: "Mid",
  low: "Low",
  auto: "Auto",
  filter: "Filter",
  filterOff: "OFF",
  kill: "KILL",
  eqTitle: "Banda de EQ: click derecho = kill de la banda · doble click = a cero",
  gainTitle: "Ganancia del canal · click derecho o doble click = a cero",
  filterTitle: "Filtro DJ: arrastra a la izquierda = paso bajo, a la derecha = paso alto · click derecho o doble click = OFF",
  crossfader: "Crossfader",

  // Pre-escucha
  cueBus: "🎧 Cue",
  cueBusTitle:
    "Pre-escucha (pre-fader). Elige la salida de auriculares en Config ⚙",
  pflTitle: "Pre-escuchar deck {side} por los auriculares",
  vol: "Vol",

  // Lista de canciones
  songs: "Canciones",
  search: "Buscar…",
  sortByTitle: "Ordenar por",
  sortAdded: "Añadido",
  sortName: "Nombre",
  sortBpm: "BPM",
  sortDuration: "Duración",
  reverseTitle: "Invertir orden",
  export: "⬇ Exportar",
  exportTitle:
    "Exporta la lista como CSV (nombre, duración, BPM, dónde se pinchó)",
  addSongs: "+ Añadir canciones",
  emptyList: "Añade canciones para cargarlas en los decks A o B.",
  noMatch: 'Ninguna canción coincide con "{query}".',
  pendingAnalysis: "pendiente…",
  bpmUnknown: "BPM ?",
  removeTitle: "Quitar de la lista",
  loadToDeck: "→ {side}",
  badgeCurrentTitle: "Cargada ahora en el deck {side}",
  badgePlayedTitle: "Ya pinchada en el deck {side}",
  csvName: "Nombre",
  csvDuration: "Duración",
  csvBpm: "BPM",
  csvSize: "Tamaño",
  csvPlayedOn: "Pinchada en",

  // Configuración
  configHeading: "⚙ Configuración",
  close: "Cerrar",
  audioOutputs: "Salidas de audio",
  requestLabels: "🔓 Pedir permiso para ver los nombres de los dispositivos",
  masterMix: "Master (mix)",
  defaultOutput: "Salida por defecto",
  preListenOut: "Pre-escucha (🎧 Cue)",
  deckExternal: "Deck {side} (mezcla externa)",
  internalMix: "Mezcla interna (por el master)",
  externalNote:
    "Si asignas una salida dedicada a un deck, deja de sonar por el master (modo mesa externa). Por defecto todo va por la misma tarjeta.",
  noMasterSink:
    "Este navegador no permite cambiar la salida del master (AudioContext.setSinkId).",
  noSinkSupport:
    "Este navegador no soporta elegir dispositivo de salida (setSinkId).",
  outputDevice: "Salida {n}",
  analysisHeading: "Análisis de canciones de la lista",
  analysisAuto: "Automático (en segundo plano, despacio)",
  analysisDeck: "Solo al cargarlas en un deck",

  // Pie
  shortcuts:
    "Teclado (deck activo: Q=A, P=B o click en el deck) — Espacio: play/pausa · C: cue/stop · 1-3: hot cues · I/O: loop in/out · L: loop on/off · ←/→: nudge",
};
