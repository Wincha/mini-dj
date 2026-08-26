# Mini DJ

Two‑deck DJ app built with React, Vite and Tailwind — everything runs locally in the browser via the Web Audio API (no backend, tracks never leave your machine). Beat‑aware waveforms, continuous sync, cues/loops/beat‑jump, a real mixer section with filter and EQ kills, headphone pre‑listen, session recording and a persistent crate.

## Features

### Decks
- Transport (play/pause/stop), elapsed/remaining toggle, smooth seeking, and per‑deck key lock (`preservesPitch`): keep the musical key while changing tempo; off = vinyl mode.
- Pitch fader like a Technics turntable (up = slower, down = faster) with selectable range (±8/16/50%) and momentary pitch‑bend buttons; live BPM readout reflects tempo changes.
- CUE points: positioning the track while paused sets the cue; Stop returns to it. Auto‑cue lands on the first sound / first detected beat (orange marker on the waveform).
- 3 hot cues per deck (right‑click or Shift+click clears) and loops: manual IN/OUT plus auto 4/8‑beat loops snapped to the beat grid, drawn on the waveform.
- Traktor‑style beat jump: selectable size (1–32 beats) with « / » to jump backward or forward.
- Quantize (Q, on by default): hot cues, loop in/out and beat jumps snap to the nearest grid beat.
- Grid TAP: tap the TAP button (or the BPM display) on the beats while the track plays — each tap re‑anchors the beat grid in real time and several taps recompute the BPM. Taps are measured in track time, so pitch doesn't skew the result.
- Waveform: zoom (buttons or mouse wheel), follow mode, manual scroll, click‑to‑seek, beat markers, cue/hot‑cue/loop overlays. Vinyl‑style dragging: while paused, push the wave to position the track under the playhead; while playing, dragging nudges the tempo like a pitch bend.
- Analysis feedback over the waveform ("Analizando pista…", "Detectando BPM…").

### Mixing
- Mixer with **dipless crossfader** (each deck at full gain on its own half; only the opposite side attenuates), deck volume faders and VU meters per deck and mix bus.
- Per‑deck EQ (gain/high/mid/low) with band **kills** (right‑click a knob; double‑click resets), plus optional auto‑gain that normalizes loudness per track.
- DJ **filter** knob per deck: one control sweeping LPF (left) ↔ HPF (right), off at center.
- Continuous **SYNC** per deck: while engaged the deck keeps following its tempo source — the other deck's effective BPM or the adjustable **Master Sync** BPM — and the button shows which (SYNC·A/B or SYNC·MST). Pitch range auto‑expands as needed.
- Beat‑match panel: both decks' waveforms and beat markers around the playhead to line them up visually.
- Headphone pre‑listen (PFL) per deck with its own volume.
- Master output trim with gentle AGC (auto level) to prevent clipping while keeping the mix loud.
- Session recording: record the master mix and download it as `.webm`.

### Library
- Track list (crate): add multiple songs, load them to Deck A/B with one click, badges showing what's loaded where and (in gray) where each song was already played.
- Persists in IndexedDB across reloads; BPM/duration analyzed slowly in the background (idle time, one at a time) or only on deck load (configurable).
- Search box, sorting by name/BPM/duration, and CSV export.

### Extras
- Keyboard shortcuts on the active deck (click a deck or Q/P to switch): Space play/pause, C cue/stop, 1‑3 hot cues, I/O loop in/out, L loop toggle, ←/→ nudge.
- Config dialog (⚙): pick the sound card/output for the master mix, the headphone cue, and optionally a dedicated output per deck (external‑mixer mode); choose the track‑analysis mode.
- Responsive layout down to phone widths (decks stack, mixer moves below); Dark Reader–friendly.

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
- Add songs to the crate (or load files directly on a deck); waveform, loudness and BPM analysis run locally.
- Click the waveform to seek; drag it to position (paused) or nudge (playing); wheel to zoom. Beat markers appear when BPM detection finishes — if the grid is off, tap TAP on the beats to fix it live.
- Engage SYNC to lock a deck to the other one (or enable Master Sync and dial a BPM); use the beat‑match panel to align beats visually.
- Shape the sound with EQ knobs (right‑click = kill), the Filter knob, and balance with faders and the dipless crossfader. `Auto` applies the suggested loudness trim.
- Pre‑listen a deck with PFL (pick the headphone output in ⚙ Config), record your set with ● REC.

## Project layout
- `src/MiniDJPlayer.jsx` – top-level layout, shared state, sync engine, keyboard shortcuts.
- `src/audio/engine.js` – Web Audio graph (decks, EQ, filter, crossfader, cue bus, recording, AGC).
- `src/audio/utils.js` – loudness analysis and BeatDetect (BPM detection, adapted from Arthur Beaulieu's library).
- `src/audio/analyzeTrack.js` – background BPM/duration analysis for the crate.
- `src/lib/` – IndexedDB track store, shared constants.
- `src/components/*` – decks, mixer, meters, track list, config dialog, waveform, sliders, knobs.

## Notes / limitations
- Browser-only; uses `AudioContext` and `createObjectURL`, so tracks stay local.
- Auto BPM detection can miss on unusual material; the grid TAP is the fallback (and fixes the grid anchor too).
- PFL and per‑deck outputs are only useful with more than one audio device (e.g. USB headphones): pick outputs in ⚙ Config; the master keeps playing on its own output.
