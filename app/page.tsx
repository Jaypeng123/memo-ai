"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CircleStop, FileAudio, Mic, Pause, Play, Sparkles } from "lucide-react";

type Segment = { start: number; end: number; speaker: string; text: string };

const formatTime = (total: number) => {
  const minutes = Math.floor(total / 60).toString().padStart(2, "0");
  const seconds = Math.floor(total % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
};

const toTranscriptText = (segments: Segment[]) =>
  segments.map((segment) => `[${formatTime(segment.start)}] ${segment.speaker}：${segment.text}`).join("\n");

export default function Home() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(Array(44).fill(8));
  const [audio, setAudio] = useState<{ blob: Blob; url: string } | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [notes, setNotes] = useState("");
  const [title, setTitle] = useState("未命名會議");
  const [status, setStatus] = useState("準備好後，按下「開始錄音」。");
  const [error, setError] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!recording || paused) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording, paused]);

  useEffect(() => () => {
    if (audio?.url) URL.revokeObjectURL(audio.url);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    void audioContextRef.current?.close();
  }, [audio?.url]);

  const stopMeter = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    setLevels(Array(44).fill(8));
  };

  const startMeter = (stream: MediaStream) => {
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      analyser.getByteFrequencyData(data);
      const next = Array.from({ length: 44 }, (_, index) => {
        const offset = Math.floor((index / 44) * data.length);
        return Math.max(6, Math.min(58, Math.round(data[offset] / 4)));
      });
      setLevels(next);
      animationRef.current = requestAnimationFrame(draw);
    };
    audioContextRef.current = context;
    void context.resume();
    draw();
  };

  const startRecording = async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError("此瀏覽器不支援錄音。請使用最新版 Chrome、Edge 或 Safari。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : undefined;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setAudio((current) => {
          if (current?.url) URL.revokeObjectURL(current.url);
          return { blob, url: URL.createObjectURL(blob) };
        });
        stopMeter();
        setStatus("錄音已儲存於此工作區。可先手動寫筆記，或將錄音轉為逐字稿。");
      };
      streamRef.current = stream;
      recorderRef.current = recorder;
      startMeter(stream);
      recorder.start(1000);
      setSeconds(0);
      setAudio(null);
      setSegments([]);
      setRecording(true);
      setPaused(false);
      setStatus("正在使用麥克風錄音；你可以同時在下方撰寫會議筆記。");
    } catch {
      setError("無法取得麥克風權限。請在瀏覽器網址列的網站權限中允許麥克風後重試。");
    }
  };

  const togglePause = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") { recorder.pause(); setPaused(true); setStatus("錄音已暫停。"); }
    else if (recorder.state === "paused") { recorder.resume(); setPaused(false); setStatus("已繼續錄音。"); }
  };

  const finishRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    setRecording(false);
    setPaused(false);
  };

  const transcribe = async () => {
    if (!audio) return;
    setTranscribing(true); setError(""); setStatus("正在將你的錄音送往轉錄服務…");
    try {
      const form = new FormData();
      form.append("audio", new File([audio.blob], "memo-recording.webm", { type: audio.blob.type || "audio/webm" }));
      const response = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await response.json() as { error?: string; transcript?: Segment[] };
      if (!response.ok) throw new Error(data.error || "轉錄失敗");
      const realSegments = data.transcript || [];
      setSegments(realSegments);
      setStatus(realSegments.length ? "逐字稿已完成，現在可以依據它生成會議紀錄。" : "未辨識到語音內容，請確認錄音中有清楚的人聲。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "轉錄失敗，請再試一次。"); }
    finally { setTranscribing(false); }
  };

  const generateNotes = async () => {
    if (!segments.length) return;
    setGenerating(true); setError(""); setStatus("AI 正在依據實際逐字稿整理會議紀錄…");
    try {
      const response = await fetch("/api/ai-notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: toTranscriptText(segments) }) });
      const data = await response.json() as { error?: string; notes?: string };
      if (!response.ok) throw new Error(data.error || "產生失敗");
      setNotes(data.notes || "");
      setStatus("AI 會議紀錄已產生；你可以繼續直接編輯。 ");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "產生會議紀錄失敗，請再試一次。"); }
    finally { setGenerating(false); }
  };

  return <main className="min-h-screen bg-[#f7f7f5] text-[#292928]">
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-[#e7e7e2] bg-[#f7f7f5]/95 px-5 backdrop-blur">
      <div className="flex items-center gap-2 font-semibold"><span className="grid h-7 w-7 place-items-center rounded-md bg-[#6f5cff] text-sm text-white">m</span> Memo AI</div>
      <span className="text-sm text-[#75756f]">私人工作區</span>
    </header>
    <section className="mx-auto max-w-4xl px-5 py-12 md:px-10">
      <input aria-label="會議標題" value={title} onChange={(event) => setTitle(event.target.value)} className="w-full border-0 bg-transparent text-4xl font-bold outline-none placeholder:text-[#b7b7b1]" placeholder="未命名會議" />
      <p className="mt-2 text-sm text-[#85857d]">今天 · 本頁中的錄音、筆記與逐字稿皆來自這一次會議。</p>

      <section className="mt-8 overflow-hidden rounded-xl border border-[#e1e1db] bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#ecece7] px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-medium"><Mic className="h-4 w-4 text-[#6f5cff]" /> 即時錄音</div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${recording ? "bg-red-50 text-red-600" : "bg-[#f1f1ed] text-[#77776f]"}`}>{recording ? (paused ? "已暫停" : "錄音中") : audio ? "已儲存" : "尚未錄音"}</span>
          <span className="ml-auto font-mono text-sm text-[#5e5e58]">{formatTime(seconds)}</span>
        </div>
        <div className="px-5 py-6">
          <div className="flex h-16 items-center gap-1 overflow-hidden rounded-lg bg-[#fafaf8] px-4" aria-label="即時音量波形">
            {levels.map((level, index) => <span key={index} className="w-1 flex-1 rounded-full bg-[#8c7cff] transition-[height] duration-75" style={{ height: `${level}px`, opacity: recording ? 1 : 0.35 }} />)}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {!recording ? <button onClick={startRecording} className="inline-flex items-center gap-2 rounded-md bg-[#292928] px-4 py-2.5 text-sm font-medium text-white"><Mic className="h-4 w-4" />開始錄音</button> : <>
              <button onClick={togglePause} className="inline-flex items-center gap-2 rounded-md border border-[#dddcd5] px-4 py-2.5 text-sm font-medium"><Pause className="h-4 w-4" />{paused ? "繼續錄音" : "暫停"}</button>
              <button onClick={finishRecording} className="inline-flex items-center gap-2 rounded-md bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700"><CircleStop className="h-4 w-4" />停止並儲存</button>
            </>}
            {audio && !recording && <button disabled={transcribing} onClick={transcribe} className="inline-flex items-center gap-2 rounded-md border border-[#6f5cff] px-4 py-2.5 text-sm font-medium text-[#5c4ded] disabled:opacity-50"><FileAudio className="h-4 w-4" />{transcribing ? "轉錄中…" : "產生逐字稿"}</button>}
            <span className="text-sm text-[#787871]">{status}</span>
          </div>
          {audio && <audio className="mt-5 w-full" controls src={audio.url}>你的瀏覽器不支援音訊播放。</audio>}
          {error && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        </div>
      </section>

      <section className="mt-10 border-t border-[#e5e5df] pt-8">
        <div className="mb-4 flex flex-wrap items-center gap-3"><h2 className="text-xl font-semibold">會議筆記</h2><span className="text-sm text-[#85857d]">在錄音期間即可同步輸入，停止後也可繼續編輯。</span><button disabled={!segments.length || generating} onClick={generateNotes} className="ml-auto inline-flex items-center gap-2 rounded-md bg-[#6f5cff] px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"><Sparkles className="h-4 w-4" />{generating ? "整理中…" : "一鍵生成會議紀錄"}</button></div>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-[300px] w-full resize-y rounded-lg border border-[#e2e2dc] bg-white p-5 leading-7 outline-none focus:border-[#8c7cff] focus:ring-2 focus:ring-[#e8e5ff]" placeholder="在這裡開始記錄會議內容…" />
      </section>

      {segments.length > 0 && <section className="mt-10 border-t border-[#e5e5df] pt-8"><h2 className="mb-4 text-xl font-semibold">實際逐字稿</h2><div className="space-y-3">{segments.map((segment, index) => <article key={`${segment.start}-${index}`} className="rounded-lg border border-[#e6e6e0] bg-white p-4"><div className="mb-2 flex items-center gap-3 text-sm"><span className="font-mono text-[#6f5cff]">{formatTime(segment.start)}</span><span className="font-medium">{segment.speaker}</span><Check className="ml-auto h-4 w-4 text-[#7c7c75]" /></div><p className="leading-7 text-[#4f4f49]">{segment.text}</p></article>)}</div></section>}
    </section>
  </main>;
}
