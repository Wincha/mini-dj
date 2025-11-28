# Mini DJ

Mini two‑deck DJ experiment built with React, Vite and Tailwind. Load local audio files, see beat‑aware waveforms, and mix with EQ, pitch, crossfader and auto‑gain helpers—all in the browser via the Web Audio API.

## Features
- Two independent decks with file input, transport (play/pause/stop), elapsed/remaining toggle, and smooth seeking on the waveform.
- Waveform rendering with zoom, follow mode, manual scroll, click‑to‑seek, and beat markers from automatic BPM detection; manual tap BPM on the display.
- Pitch fader with selectable range (±8/16/50%), momentary pitch bend buttons, and live BPM readout that reflects tempo changes.
- Per‑deck EQ block (gain/high/mid/low) plus optional auto‑gain that normalizes loudness to a target level per track.
- Mixer with equal‑power crossfader, deck volume faders, and VU meters for each deck and the mix bus.
- Master output trim with gentle AGC (auto level) to prevent clipping while keeping the mix loud.

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
- Key lock/time-stretch UI is stubbed but not implemented.
- Auto BPM detection can be slow on very long files; tap BPM is available as a fallback.
