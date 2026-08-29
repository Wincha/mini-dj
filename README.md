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
- Manual beat‑grid editing, both axes: `« ‹ › »` shift the grid anchor (10 ms / 1 ms) when the grid is out of phase with the hits, and `−− − + ++` stretch or squeeze the spacing between beats (±0.1 / ±0.01 BPM) pivoting on the anchor, for a grid that starts square and drifts. `÷2` / `×2` fix a tempo detected at half or double, and `⟳` re‑runs the detection *around* the BPM and anchor you set by hand instead of from scratch. All of it changes the track's **base BPM**, never the pitch, and every change propagates at once to waveform markers, quantize, auto 4/8‑beat loops, beat jump, the beat‑match panel and the BPM feeding SYNC.
- Waveform: zoom (buttons or mouse wheel), follow mode, manual scroll, click‑to‑seek, beat markers, cue/hot‑cue/loop overlays. Vinyl‑style dragging: while paused, push the wave to position the track under the playhead; while playing, dragging nudges the tempo like a pitch bend.
- Analysis feedback over the waveform ("Analizando pista…", "Detectando BPM…").

### Mixing
- Mixer with **dipless crossfader** (each deck at full gain on its own half; only the opposite side attenuates), deck volume faders and VU meters per deck and mix bus.
- Mixing-desk style faders (`Fader` component, reused everywhere): rectangular head with a centre line, lit travelled section over a darker rail, optional scale ticks, fill from the start or from the centre (pitch, crossfader), a `native` variant, and right‑click to snap back to the default position — all configurable per instance.
- Per‑deck EQ (gain/high/mid/low) with band **kills** (right‑click a knob; double‑click resets), plus auto‑gain (on by default): the whole track is analyzed once on load and a single static gain is applied — no pumping during playback — referenced to the loud part of the song and capped so peaks never pass −1 dBFS.
- DJ **filter** knob per deck: one control sweeping LPF (left) ↔ HPF (right), off at center.
- Continuous **SYNC** per deck: while engaged the deck keeps following its tempo source — the other deck's effective BPM or the adjustable **Master Sync** BPM — and the button shows which (SYNC·A/B or SYNC·MST). Pitch range auto‑expands as needed.
- Beat‑match panel: both decks' waveforms and beat markers around the playhead to line them up visually.
- Headphone pre‑listen (PFL) per deck with its own volume.
- Safety limiter before the output so summing decks never clips; master level stays where you put it (no dynamic auto-leveling).
- Session recording: record the master mix and download it as `.webm`.

### Library
- Track list (crate): add multiple songs, load them to Deck A/B with one click, badges showing what's loaded where and (in gray) where each song was already played.
- Persists in IndexedDB across reloads (including a hand‑adjusted beat grid, which the background analysis never overwrites); BPM/duration analyzed slowly in the background (idle time, one at a time) or only on deck load (configurable).
- Search box, sorting by name/BPM/duration, and CSV export.

### Extras
- Keyboard shortcuts on the active deck (click a deck or Q/P to switch): Space play/pause, C cue/stop, 1‑3 hot cues, I/O loop in/out, L loop toggle, ←/→ nudge.
- Config dialog (⚙): pick the sound card/output for the master mix, the headphone cue, and optionally a dedicated output per deck (external‑mixer mode); choose the track‑analysis mode.
- **11 languages** (Spanish, English, Catalan, Galician, Basque, French, Italian, Portuguese, Chinese, Japanese, Korean), auto‑detected from the browser with English as fallback and a selector under the title; the choice is remembered.
- Responsive layout down to phone widths (decks stack, mixer moves below); Dark Reader–friendly. Controls reserve stable widths so translated or changing labels never shift the layout.

## Quick start
1) Install deps: `npm install` (Node 22+; CI builds on Node 24).  
2) Run dev server: `npm run dev` then open the shown local URL.  
3) Load audio files into Deck A/B and start mixing.

## Scripts
### Web
- `npm run dev` – start Vite dev server with HMR.
- `npm run build` – production build.
- `npm run preview` – preview the production build locally.
- `npm run lint` – run ESLint.

### Tests
- `npm test` – run the whole suite once (Vitest).
- `npm run test:watch` – watch mode while developing.
- `npm run test:coverage` – suite plus a coverage report (`coverage/index.html`).

Two projects share one config (`vitest.config.js`):
- **unit** – plain Node, no DOM: audio logic (`beatGrid`, `engine`, `utils`,
  `levelMeter`, `keyDetect`), `src/lib` and the locale dictionaries. The Web
  Audio graph is faked in `tests/helpers/fakeAudio.js`, and test signals are
  generated on the fly in `tests/helpers/signals.js` – no audio fixtures in the
  repo.
- **dom** – jsdom + React Testing Library for the components.

Browser (end-to-end) tests live apart in `vitest.e2e.config.js`:
- `npm run test:e2e` – four user flows (load a track, play, sync two decks,
  settings survive a reload, switching language does not break the layout).
- They drive the **system Chrome** through `puppeteer-core` (no browser is
  downloaded); set `MINI_DJ_CHROME` if it lives somewhere unusual. With no
  Chrome around they skip themselves instead of failing, and `npm test` never
  runs them, so CI cannot go flaky because of them.
- `AudioContext.resume()` never settles without an audio device, so the harness
  replaces it with a resolved promise before the app loads.

### Desktop (Electron)
- `npm run desktop:dev` – Vite dev server + Electron pointed at it (HMR, DevTools open).
- `npm run desktop:preview` – build and run Electron against `dist/`, the exact production code path.
- `npm run desktop:dir` – build an unpacked app in `release/` (no installer).
- `npm run desktop:build` – build installers for the current platform.
- `npm run dist:win` / `dist:linux` / `dist:mac` – build for one platform.

## Desktop app (Electron)

The desktop build is a thin wrapper around the same web bundle — the audio engine,
the UI and the storage code are unchanged.

Targets: **Windows** NSIS installer + portable `.exe`, **Linux** AppImage + `.deb`,
**macOS** `.dmg` (x64 and arm64). Configuration lives in `electron-builder.yml`;
output goes to `release/`.

How it is wired:
- `electron/main.cjs` – main process. `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`. In development it loads the Vite dev server; in production it serves
  `dist/` over a custom `app://` scheme registered as *standard* and *secure* (not `file://`,
  which is an opaque origin and makes IndexedDB/localStorage unreliable and breaks secure-context
  APIs like `getUserMedia` and `setSinkId`). A CSP is sent as a response header on that scheme.
- `electron/preload.cjs` – minimal bridge; exposes only `window.miniDJDesktop`
  (`isDesktop`, `platform`, versions, and the update state / install call). No Node API
  reaches the page.
- `electron/updater.cjs` – auto-update; see below.
- Media permission is granted in the session. Without it `enumerateDevices()` returns
  outputs with empty labels and the ⚙ Config device pickers come up blank.
- `backgroundThrottling` is disabled so waveforms and background analysis keep running
  when the window loses focus.
- Downloads (the recorded `.webm`, the tracklist CSV) open the native save dialog,
  defaulting to the system Downloads folder.
- Track library (IndexedDB) and settings/language (localStorage) persist between launches.

### Releases
Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds on Windows, Linux and
macOS runners and uploads the binaries to a **draft** GitHub release. Review it and publish
manually. No secrets are needed beyond the default `GITHUB_TOKEN`.

```
npm version patch   # or minor / major
git push --follow-tags
```

### Error log
Failures are typed: each one carries a code naming the area it broke in
(`AUDIO-SINK-CUE`, `TRACK-LOAD`, `ANALYSIS-BEATS`, `LIB-DB-SAVE`, `UPDATE-CHECK`…),
the context of the moment and the original error. Messages are always in English and
never translated — the UI speaks eleven languages, the log cannot, or the same
failure would read eleven different ways and be impossible to search or compare.

The catalogue lives in `src/lib/log.js` (renderer) and `electron/logger.cjs` (main
process); both write the same line format. The page keeps the last 200 entries in
`localStorage` and shows them under ⚙ Settings › Log, where they can be downloaded,
copied or cleared. The desktop app also appends everything — including the lines the
page forwards over IPC — to a single file:

```
Windows   %APPDATA%\mini-dj\mini-dj.log
Linux     ~/.config/mini-dj/mini-dj.log
macOS     ~/Library/Application Support/mini-dj/mini-dj.log
```

The folder is `mini-dj`, not `Mini DJ`: `app.getName()` reads the `name` field of the
packaged `package.json`, while `productName` only lives in `electron-builder.yml` and
governs the executable and installer names. **Do not "fix" this.** Renaming it moves
the whole `userData` directory, orphaning the IndexedDB track library, the settings
and the chosen language — the app would come back empty.

### Auto-update
Enabled on Windows and on the Linux AppImage, via `electron-updater`
(`electron/updater.cjs`). Eight seconds after start-up the app asks GitHub for the
latest **published** release, downloads the installer in the background and shows a
toast offering to restart and install; if you dismiss it, the update is applied when
you close the app. While it works it says so — "Checking for updates…", then either
the download or "You are on the latest version" — and a failed check (no network,
rate limit) is reported rather than swallowed, but never interrupts a set.

Three things worth knowing:
- **A draft release does not exist for the updater.** The public GitHub API does not
  return drafts, so the release has to be published before anyone gets it. The
  workflow still uploads as a draft on purpose, so you review before shipping.
- **The version that checks is the installed one.** Any build older than the one that
  first shipped `electron-updater` will never update itself, however many releases go
  out; it has to be installed by hand once.
- **macOS is excluded** because auto-update requires a signed app, and **the Linux
  `.deb` is excluded** because that is the package manager's job. Both are skipped
  explicitly rather than left to fail at run time.

### Desktop limitations
- **Windows**: the installer and the app are not code-signed. SmartScreen will show
  "Windows protected your PC" on first run; the user has to click *More info → Run anyway*.
  Removing that warning requires a paid code-signing certificate.
- **macOS**: not signed and not notarized (no Apple Developer account). The first launch is
  blocked by Gatekeeper; the user has to right-click the app → *Open* → *Open*. A plain
  double-click will only offer to move it to the Bin. On some macOS versions the app may also
  need `xattr -dr com.apple.quarantine "/Applications/Mini DJ.app"`.
- **Linux**: the AppImage needs FUSE 2 (or `--appimage-extract-and-run`). The `.deb` declares
  the usual Chromium runtime dependencies.
- Only x64 is built for Windows and Linux; macOS gets both x64 and arm64.

## How to use
- Add songs to the crate (or load files directly on a deck); waveform, loudness and BPM analysis run locally.
- Click the waveform to seek; drag it to position (paused) or nudge (playing); wheel to zoom. Beat markers appear when BPM detection finishes — if the grid is off, tap TAP on the beats to fix it live.
- Engage SYNC to lock a deck to the other one (or enable Master Sync and dial a BPM); use the beat‑match panel to align beats visually.
- Shape the sound with EQ knobs (right‑click = kill), the Filter knob, and balance with faders and the dipless crossfader. `Auto` applies the suggested loudness trim.
- Pre‑listen a deck with PFL (pick the headphone output in ⚙ Config), record your set with ● REC.

## Project layout
- `src/MiniDJPlayer.jsx` – top-level layout, shared state, sync engine, keyboard shortcuts.
- `src/audio/engine.js` – Web Audio graph (decks, EQ, filter, crossfader, cue bus, recording, AGC).
- `src/audio/utils.js` – loudness and waveform analysis.
- `src/audio/beatGrid.js` – BPM and beat‑grid detection (own MIT implementation: filter bank → onset envelope → autocorrelation → phase).
- `src/audio/analyzeTrack.js` – background BPM/duration analysis for the crate.
- `src/i18n/` – language provider, detection and the 11 locale dictionaries.
- `src/lib/` – IndexedDB track store, shared constants.
- `src/components/*` – decks, mixer, meters, track list, config dialog, waveform, the reusable `Fader`, knobs.
- `tests/` – `unit/` (pure logic, Node), `dom/` (components, jsdom), `e2e/` (Chrome + puppeteer-core), `helpers/` (Web Audio double, synthetic signals, WAV generator).
- `.github/workflows/ci.yml` – lint, tests and build on every push and PR to main.
- `electron/` – desktop wrapper (main process, preload).
- `scripts/electron-dev.mjs` – starts Vite and launches Electron against the resolved URL.
- `electron-builder.yml` – packaging targets and installer options.
- `build/` – application icons.

## Notes / limitations
- Runs in the browser or as an Electron desktop app; uses `AudioContext` and `createObjectURL`, so tracks stay local either way.
- Auto BPM detection can miss on unusual material; the grid TAP and the manual grid controls (phase / spacing / ÷2 / ×2 / guided re‑analysis) are the fallback.
- PFL and per‑deck outputs are only useful with more than one audio device (e.g. USB headphones): pick outputs in ⚙ Config; the master keeps playing on its own output.

## License
MIT — see [LICENSE](LICENSE). All the audio analysis (loudness, waveform, key and BPM/beat grid) is
first‑party code; no GPL/AGPL library is bundled.
