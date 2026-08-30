import { memo, useRef, useState } from "react";
import Fader from "./Fader";
import PadButton, { GLOSS, PRESS, SKIN } from "./PadButton";
import NumberField from "./NumberField";
import VUBar from "./VUBar";
import BeatMatchPanel from "./BeatMatchPanel";
import LanguageSelector from "./LanguageSelector";
import { useI18n } from "../i18n/context";
import { ERRORS, logError } from "../lib/log";

function formatRecTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function CentralMeters({
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
  vuMode,
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
    else startRecording().catch((err) => logError(ERRORS.REC_START, err));
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
              className={`px-3 py-1.5 rounded-xl text-sm font-semibold border grid place-items-center tabular-nums ${GLOSS} ${PRESS} ${
                recording
                  ? "bg-gradient-to-b from-red-400 to-red-600 text-white border-red-400 animate-pulse"
                  : `text-neutral-200 ${SKIN}`
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
        {/* Idioma a la izquierda y versión pegada al borde derecho de la
            cabecera, centradas entre sí */}
        <div className="mt-1 flex items-center justify-between gap-2">
          <LanguageSelector />
          <span
            className="text-[10px] text-neutral-500 tabular-nums whitespace-nowrap"
            title={t("versionTitle")}
          >
            v{__APP_VERSION__}
          </span>
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
            className={`px-2 py-0.5 rounded-lg border text-xs text-neutral-300 ${SKIN} ${GLOSS} ${PRESS}`}
            title={t("configTitle")}
          >
            ⚙
          </button>
        </div>
        <Fader
          min={0}
          max={1}
          step={0.01}
          value={master}
          onChange={(e) => setMaster(Number(e.target.value))}
          ticks={11}
          accent="#34d399"
          resetValue={1}
          title={t("masterVolTitle")}
          ariaLabel={t("master")}
        />
        <VUBar
          engine={engine}
          side="master"
          direction="horizontal"
          mode={vuMode}
          showScale
        />
        {/* Master Sync. Mismos botones que las cajas del deck: es de encender
            y apagar, así que lleva testigo con luz. */}
        <div className="flex items-center gap-2">
          <PadButton
            size="text"
            led
            active={masterSyncOn}
            onClick={onToggleMasterSync}
            className="whitespace-nowrap"
            title={t("masterSyncTitle")}
          >
            {t("masterSync")}
          </PadButton>
          <div
            className={`flex items-center gap-1 ${
              masterSyncOn ? "" : "opacity-40 pointer-events-none"
            }`}
          >
            <PadButton
              size="sm"
              onClick={() => setMasterBpm(Math.max(40, masterBpm - 1))}
              title={t("masterBpmDownTitle")}
            >
              −
            </PadButton>
            {/* El número se ajusta arrastrando o con la rueda: teclearlo a
                mano en mitad de una mezcla es un incordio */}
            <NumberField
              value={masterBpm}
              min={40}
              max={220}
              step={1}
              onChange={setMasterBpm}
              className="w-14 h-7 text-xs"
              title={t("masterBpmTitle")}
              ariaLabel={t("masterBpmTitle")}
            />
            <PadButton
              size="sm"
              onClick={() => setMasterBpm(Math.min(220, masterBpm + 1))}
              title={t("masterBpmUpTitle")}
            >
              +
            </PadButton>
            <span className="text-[10px] text-neutral-500">{t("bpm")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(CentralMeters);
