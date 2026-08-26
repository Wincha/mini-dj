import { useRef, useState } from "react";
import HorizontalSlider from "./HorizontalSlider";
import VUBar from "./VUBar";

function formatRecTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function CentralMeters({ engine, master, setMaster }) {
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
    <div className="flex flex-wrap items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 shadow-xl gap-4 sm:gap-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Mini DJ Mixer
          </h1>
          <p className="text-sm text-neutral-400">
            by Dj Wincha (Under construction)
          </p>
        </div>
      </header>
      {/* Grabación de la sesión */}
      {recSupported && (
        <button
          onClick={toggleRecording}
          className={`px-3 py-2 rounded-xl text-sm font-semibold border ${
            recording
              ? "bg-red-500 text-white border-red-400 animate-pulse"
              : "bg-neutral-800 text-neutral-200 border-neutral-700"
          }`}
          title="Graba el mix master; al parar se descarga como .webm"
        >
          {recording ? `■ ${formatRecTime(recSeconds)}` : "● REC"}
        </button>
      )}
      {/* Master volume (horizontal) */}
      <div className="flex flex-col gap-2 w-full max-w-md min-w-48">
        <span className="text-xs text-neutral-400">Master</span>
        <HorizontalSlider
          min={0}
          max={1}
          step={0.01}
          value={master}
          onChange={(e) => setMaster(Number(e.target.value))}
          className="w-full" // si tu componente lo soporta
        />
        <VUBar engine={engine} side="Both" direction="horizontal" />
      </div>
    </div>
  );
}
