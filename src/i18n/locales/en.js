export default {
  // Header
  subtitle: "by Dj Wincha (under construction)",
  rec: "● REC",
  recTitle: "Records the master mix; downloads as .webm when you stop",
  master: "Master",
  configTitle: "Settings: audio outputs and analysis",
  masterSync: "MASTER SYNC",
  masterSyncTitle:
    "Master sync: decks with SYNC follow this BPM instead of the other deck",
  masterBpmTitle: "Master sync BPM",
  bpm: "BPM",
  language: "Language",

  // Beat match
  beatMatch: "Beat match",
  beatMatchTitle:
    "With SYNC on, line up the red beat marks using nudge / dragging the waveform",
  deckNoTrack: "Deck {side} — no track",

  // Deck
  deck: "Deck {side}",
  keyboardBadge: "KEYBOARD",
  keyboardBadgeTitle: "Active deck: receives the keyboard shortcuts",
  noFile: "No file",
  loadFile: "📂 Load file",
  cue: "CUE",
  cueTitle:
    "CUE point: set by positioning the track while paused; Stop returns here",
  bpmNone: "BPM --",
  bpmDisplayTitle:
    "Click on the beat (TAP): re-anchors the beat grid and recomputes the BPM",
  analyzingTrack: "⏳ Analyzing track…",
  detectingBpm: "⏳ Detecting BPM…",
  follow: "🔁 Follow",
  followTitle: "Follow playback again",
  play: "▶︎ Play",
  pause: "❚❚ Pause",
  stop: "■ Stop",
  stopTitle: "Stops and returns to the CUE point",
  sync: "SYNC",
  syncTitle:
    "Engage continuous sync: this deck will follow the other deck's or the master BPM",
  syncActiveTitle: "Sync locked: following {source}'s BPM (pitch adjusts itself)",
  keyLock: "🔒 Key",
  keyLockTitle:
    "Key lock: keeps the pitch when changing tempo (OFF = vinyl mode)",
  rangeTitle: "Pitch fader range",
  pitch: "Pitch",
  bend: "bend",
  bendMinusTitle: "Bend − (slower while held)",
  bendPlusTitle: "Bend + (faster while held)",
  hotCueSetTitle: "Hot cue {n}: set at the current position",
  hotCueGoTitle:
    "Hot cue {n}: jump to {time} · clear with right-click or Shift+click",
  jump: "Jump",
  jumpBackTitle: "Jump {n} beats backward",
  jumpFwdTitle: "Jump {n} beats forward",
  jumpSizeTitle: "Jump size in beats",
  tap: "TAP",
  tapTitle:
    "Tap on the beat while it plays: each tap re-anchors the beat grid, several taps recompute the BPM",
  quantizeTitle:
    "Quantize: snaps hot cues, loops and jumps to the nearest grid beat",
  loop: "Loop",
  loopIn: "IN",
  loopInTitle: "Sets the loop start at the current position",
  loopOut: "OUT",
  loopOutTitle: "Sets the loop end and activates it",
  loop4Title: "Automatic 4-beat loop from the previous beat",
  loop8Title: "Automatic 8-beat loop from the previous beat",
  loopToggleTitle: "Turns the marked loop on/off",

  // Mixer
  gain: "Gain",
  high: "High",
  mid: "Mid",
  low: "Low",
  auto: "Auto",
  filter: "Filter",
  filterOff: "OFF",
  kill: "KILL",
  eqTitle: "EQ: right-click = band kill · double-click = reset to zero",
  crossfader: "Crossfader",

  // Pre-listen
  cueBus: "🎧 Cue",
  cueBusTitle:
    "Pre-listen (pre-fader). Pick the headphone output in Settings ⚙",
  pflTitle: "Pre-listen deck {side} on the headphones",
  vol: "Vol",

  // Track list
  songs: "Songs",
  search: "Search…",
  sortByTitle: "Sort by",
  sortAdded: "Added",
  sortName: "Name",
  sortBpm: "BPM",
  sortDuration: "Duration",
  reverseTitle: "Reverse order",
  export: "⬇ Export",
  exportTitle: "Exports the list as CSV (name, duration, BPM, where it played)",
  addSongs: "+ Add songs",
  emptyList: "Add songs to load them into deck A or B.",
  noMatch: 'No song matches "{query}".',
  pendingAnalysis: "pending…",
  bpmUnknown: "BPM ?",
  removeTitle: "Remove from the list",
  loadToDeck: "→ {side}",
  badgeCurrentTitle: "Currently loaded in deck {side}",
  badgePlayedTitle: "Already played on deck {side}",
  csvName: "Name",
  csvDuration: "Duration",
  csvBpm: "BPM",
  csvSize: "Size",
  csvPlayedOn: "Played on",

  // Settings
  configHeading: "⚙ Settings",
  close: "Close",
  audioOutputs: "Audio outputs",
  requestLabels: "🔓 Ask for permission to see the device names",
  masterMix: "Master (mix)",
  defaultOutput: "Default output",
  preListenOut: "Pre-listen (🎧 Cue)",
  deckExternal: "Deck {side} (external mixing)",
  internalMix: "Internal mix (through the master)",
  externalNote:
    "If you assign a dedicated output to a deck, it stops playing through the master (external mixer mode). By default everything goes through the same card.",
  noMasterSink:
    "This browser cannot change the master output (AudioContext.setSinkId).",
  noSinkSupport:
    "This browser does not support picking an output device (setSinkId).",
  outputDevice: "Output {n}",
  analysisHeading: "Analysis of songs in the list",
  analysisAuto: "Automatic (in the background, slowly)",
  analysisDeck: "Only when loaded into a deck",

  // Footer
  shortcuts:
    "Keyboard (active deck: Q=A, P=B or click the deck) — Space: play/pause · C: cue/stop · 1-3: hot cues · I/O: loop in/out · L: loop on/off · ←/→: nudge",
};
