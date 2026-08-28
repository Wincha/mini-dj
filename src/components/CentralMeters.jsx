import { useRef, useState } from "react";
import HorizontalSlider from "./HorizontalSlider";
import VUBar from "./VUBar";
import BeatMatchPanel from "./BeatMatchPanel";
import LanguageSelector from "./LanguageSelector";
import { useI18n } from "../i18n/context";

function formatRecTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function CentralMeters({
  engine,
  master,
  setMaster,
  analysis,
  audioElsRef,
  masterSyncOn,
  onToggleMasterSync,
  masterBpm,
  setMasterBpm,
  onOpenConfig,
}) {
  const { t } = useI18n();
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  const recSupported =
    typeof MediaRecorder !== "undefined" && !!engine?.getRecordStream;

  const startRecording = async () => {
    await engine.resume();
    const stream = engine.getRecordStream();
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    const rec = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data?.size) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      a.href = url;
      a.download = `mix-${stamp}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    };
    rec.start(1000);
    recorderRef.current = rec;
    setRecording(true);
    setRecSeconds(0);
    timerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    clearInterval(timerRef.current);
    timerRef.current = null;
    setRecording(false);
  };

  const toggleRecording = () => {
    if (recording) stopRecording();
    else startRecording().catch((err) => console.error("Recording failed", err));
  };

  return (
    <div className="flex flex-wrap items-center rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 shadow-xl gap-4 sm:gap-6">
      {/* Título + REC */}
      <header className="shrink-0 self-start flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Mini DJ Mixer
          </h1>
          {recSupported && (
            <button
              onClick={toggleRecording}
              className={`px-3 py-1.5 rounded-xl text-sm font-semibold border grid place-items-center tabular-nums ${
                recording
                  ? "bg-red-500 text-white border-red-400 animate-pulse"
                  : "bg-neutral-800 text-neutral-200 border-neutral-700"
              }`}
              title={t("recTitle")}
            >
              <span className="col-start-1 row-start-1 invisible h-0" aria-hidden>
                {t("rec")}
              </span>
              <span className="col-start-1 row-start-1 invisible h-0" aria-hidden>
                ■ 00:00
              </span>
              <span className="col-start-1 row-start-1 whitespace-nowrap">
                {recording ? `■ ${formatRecTime(recSeconds)}` : t("rec")}
              </span>
            </button>
          )}
        </div>
        <p className="text-sm text-neutral-400">{t("subtitle")}</p>
        <div className="mt-1">
          <LanguageSelector />
        </div>
      </header>

      {/* Beat match centrado y bien visible */}
      <div className="flex-1 min-w-64">
        <BeatMatchPanel analysis={analysis} audioElsRef={audioElsRef} />
      </div>

      {/* Master compacto + Master Sync + Config */}
      <div className="flex flex-col gap-2 w-full sm:w-64 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-400">{t("master")}</span>
          <button
            onClick={onOpenConfig}
            className="px-2 py-0.5 rounded-lg bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 hover:bg-neutral-700"
            title={t("configTitle")}
          >
            ⚙
          </button>
        </div>
        <HorizontalSlider
          min={0}
          max={1}
          step={0.01}
          value={master}
          onChange={(e) => setMaster(Number(e.target.value))}
          className="w-full"
        />
        <VUBar engine={engine} side="Both" direction="horizontal" />
        {/* Master Sync */}
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleMasterSync}
            className={`px-2 py-1 rounded-lg text-xs font-semibold border text-center whitespace-nowrap ${
              masterSyncOn
                ? "bg-emerald-500 text-black border-emerald-400"
                : "bg-neutral-800 text-neutral-300 border-neutral-700"
            }`}
            title={t("masterSyncTitle")}
          >
            {t("masterSync")}
          </button>
          <div
            className={`flex items-center gap-1 ${
              masterSyncOn ? "" : "opacity-40 pointer-events-none"
            }`}
          >
            <button
              onClick={() => setMasterBpm(Math.max(40, masterBpm - 1))}
              className="w-6 h-6 rounded bg-neutral-800 border border-neutral-700 text-neutral-300 text-xs"
            >
              −
            </button>
            <input
              type="number"
              min={40}
              max={220}
              value={masterBpm}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setMasterBpm(Math.min(220, Math.max(40, v)));
              }}
              className="w-14 bg-neutral-800 border border-neutral-700 rounded px-1 py-0.5 text-center text-xs text-neutral-200"
              title={t("masterBpmTitle")}
            />
            <button
              onClick={() => setMasterBpm(Math.min(220, masterBpm + 1))}
              className="w-6 h-6 rounded bg-neutral-800 border border-neutral-700 text-neutral-300 text-xs"
            >
              +
            </button>
            <span className="text-[10px] text-neutral-500">{t("bpm")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
