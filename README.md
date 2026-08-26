# Mini DJ

Mini two‑deck DJ experiment built with React, Vite and Tailwind. Load local audio files, see beat‑aware waveforms, and mix with EQ, pitch, crossfader and auto‑gain helpers—all in the browser via the Web Audio API.

## Features
- Two independent decks with file input, transport (play/pause/stop), elapsed/remaining toggle, and smooth seeking on the waveform.
- Waveform rendering with zoom, follow mode, manual scroll, click‑to‑seek, and beat markers from automatic BPM detection; manual tap BPM on the display.
- Pitch fader with selectable range (±8/16/50%), momentary pitch bend buttons, and live BPM readout that reflects tempo changes.
- Per‑deck EQ block (gain/high/mid/low) plus optional auto‑gain that normalizes loudness to a target level per track.
- Mixer with equal‑power crossfader, deck volume faders, and VU meters for each deck and the mix bus.
- Master output trim with gentle AGC (auto level) to prevent clipping while keeping the mix loud.
- One‑click SYNC per deck: matches the effective BPM of the other deck by adjusting pitch (auto‑expands the pitch range if needed).
- CUE points: positioning the track while paused sets the cue; Stop returns to it. Auto‑cue lands on the first sound / first detected beat, with an orange marker on the waveform.
- Vinyl‑style waveform dragging: while paused, push the wave to position the track under the playhead; while playing, dragging nudges the tempo like a pitch bend.
- Analysis feedback: the waveform area shows "Analizando pista…" and "Detectando BPM…" while a track is being processed.
- Key lock per deck (`preservesPitch`): keep the musical key while changing tempo; off = vinyl mode.
- 3 hot cues per deck (right‑click clears) and loops: manual IN/OUT plus auto 4/8‑beat loops snapped to the beat grid, drawn on the waveform.
- Keyboard shortcuts on the active deck (click a deck or Q/P to switch): Space play/pause, C cue/stop, 1‑3 hot cues, I/O loop in/out, L loop toggle, ←/→ nudge.
- Beat‑match panel: both decks' waveforms and beat markers around the playhead to line them up visually.
- Headphone pre‑listen (PFL) per deck with output device selection (`setSinkId`) and its own volume.
- Session recording: record the master mix and download it as `.webm`.
- The track list persists in IndexedDB and analyzes BPM/duration of each song in the background.
- Track list (crate): add multiple songs, load them to Deck A/B with one click, with badges showing what's loaded where.
- Responsive layout: works down to phone widths (decks stack, mixer moves below).

## Quick start
1) Install deps: `npm install` (Node 18+ recommended).  
2) Run dev server: `npm run dev` then open the shown local URL.  
3) Load audio files into Deck A/B and start mixing.

## Scripts
- `npm run dev` – start Vite dev server with HMR.
- `npm run build` – production build.
- `npm run preview` – preview the production build locally.
- `npm run lint` – run ESLint.

## How to use
- Load a track on each deck via the file picker; the waveform and auto‑gain analysis run locally (no upload).
- Click the waveform to seek; use zoom/follow/scroll controls to navigate. Beat markers appear after BPM detection finishes.
- Tap the BPM display to set BPM manually if auto detection misses; the live BPM reflects pitch changes.
- Adjust pitch with the vertical fader; use ± buttons for momentary bend. Change the range from the dropdown.
- Shape tone with Gain/High/Mid/Low knobs per deck; enable `Auto` to apply the suggested loudness trim.
- Balance levels with deck volume faders and the equal‑power crossfader; watch VU meters. Master slider controls overall output; AGC is enabled by default.

## Project layout
- `src/MiniDJPlayer.jsx` – top-level layout and shared state.
- `src/audio/engine.js` – Web Audio graph (decks, EQ, crossfader, AGC, analysers).
- `src/audio/utils.js` – loudness analysis and beat detection helper.
- `src/components/*` – UI components for decks, mixer, meters, sliders, knobs, and waveform.

## Notes / limitations
- Browser-only; uses `AudioContext` and `createObjectURL`, so tracks stay local.
- Auto BPM detection can be slow on very long files; tap BPM is available as a fallback.
- PFL is only useful with a second audio output (e.g. USB headphones): pick it in the 🎧 Cue selector; the master keeps playing on the default output.
