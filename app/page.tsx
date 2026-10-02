"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { ChevronDown, CircleStop, Code2, FileAudio, Folder, GripVertical, ImagePlus, LayoutList, ListChecks, ListOrdered, Mic, Pause, Plus, Quote, Search, Sparkles, Table2, Type } from "lucide-react";

type Segment = { start: number; end: number; speaker: string; text: string };
type AudioAsset = { blob: Blob; url: string };
type ImageAsset = { file: File; url: string; name: string };
type ImageMenu = { x: number; y: number } | null;
type Mode = "home" | "page";

const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
const transcriptText = (items: Segment[]) => items.map((item) => `[${formatTime(item.start)}] ${item.speaker}：${item.text}`).join("\n");

export default function Home() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<Mode>("home");
  const [title, setTitle] = useState("未命名頁面");
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(Array(34).fill(5));
  const [audio, setAudio] = useState<AudioAsset | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [image, setImage] = useState<ImageAsset | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [imageMenu, setImageMenu] = useState<ImageMenu>(null);

  useEffect(() => {
    if (!recording || paused) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording, paused]);

  useEffect(() => () => {
    if (audio) URL.revokeObjectURL(audio.url);
    if (image) URL.revokeObjectURL(image.url);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void audioContextRef.current?.close();
  }, [audio, image]);

  const stopMeter = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    setLevels(Array(34).fill(5));
  };

  const startMeter = (stream: MediaStream) => {
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      analyser.getByteFrequencyData(data);
      setLevels(Array.from({ length: 34 }, (_, index) => Math.max(5, Math.min(42, Math.round(data[Math.floor(index * data.length / 34)] / 5)))));
      animationRef.current = requestAnimationFrame(draw);
    };
    audioContextRef.current = context;
    void context.resume();
    draw();
  };

  const beginPage = (nextTitle = "未命名頁面") => { setTitle(nextTitle); setMode("page"); setStatus(""); setError(""); };
  const insertHtml = (html: string) => {
    editorRef.current?.focus();
    document.execCommand("insertHTML", false, html);
    setSlashOpen(false);
  };
  const insertTable = () => insertHtml('<table><tbody><tr><th>欄位一</th><th>欄位二</th><th>欄位三</th></tr><tr><td>內容</td><td>內容</td><td>內容</td></tr><tr><td>內容</td><td>內容</td><td>內容</td></tr></tbody></table><p><br></p>');

  const startRecording = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : undefined;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = ({ data }) => { if (data.size) chunksRef.current.push(data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setAudio((current) => { if (current) URL.revokeObjectURL(current.url); return { blob, url: URL.createObjectURL(blob) }; });
        stopMeter(); setStatus("錄音已儲存。你可以立即繼續寫筆記，或轉成逐字稿。");
      };
      streamRef.current = stream; recorderRef.current = recorder; startMeter(stream); recorder.start(1000);
      setSeconds(0); setSegments([]); setRecording(true); setPaused(false); setStatus("正在錄音；筆記畫布仍可同步編輯。");
    } catch { setError("無法使用麥克風。請在瀏覽器網站權限中允許麥克風後重試。"); }
  };

  const togglePause = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") { recorder.pause(); setPaused(true); }
    if (recorder.state === "paused") { recorder.resume(); setPaused(false); }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
    setRecording(false); setPaused(false);
  };

  const transcribe = async () => {
    if (!audio) return;
    setTranscribing(true); setError(""); setStatus("正在轉錄你的錄音…");
    try {
      const form = new FormData();
      form.append("audio", new File([audio.blob], "memo-recording.webm", { type: audio.blob.type || "audio/webm" }));
      const response = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await response.json() as { error?: string; transcript?: Segment[] };
      if (!response.ok) throw new Error(data.error || "轉錄失敗");
      setSegments(data.transcript || []); setStatus(data.transcript?.length ? "逐字稿完成。可以依錄音內容生成會議紀錄。" : "沒有辨識到可用語音內容。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "轉錄失敗。"); }
    finally { setTranscribing(false); }
  };

  const generateNotes = async () => {
    if (!segments.length) { setError("請先用實際錄音產生逐字稿，再生成會議紀錄。"); return; }
    setGenerating(true); setError("");
    try {
      const response = await fetch("/api/ai-notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: transcriptText(segments) }) });
      const data = await response.json() as { error?: string; notes?: string };
      if (!response.ok) throw new Error(data.error || "AI 產生失敗");
      if (editorRef.current) editorRef.current.innerText = data.notes || "";
      setStatus("AI 已根據你的逐字稿建立會議紀錄，你可以繼續編修。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "AI 產生失敗。"); }
    finally { setGenerating(false); }
  };

  const selectImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    const isHeic = file.type === "image/heic" || file.type === "image/heif" || /\.hei[cf]$/i.test(file.name);
    let previewUrl = URL.createObjectURL(file);
    if (isHeic) {
      try {
        const form = new FormData(); form.append("image", file);
        const response = await fetch("/api/image-preview", { method: "POST", body: form });
        const data = await response.json() as { dataUrl?: string };
        if (!response.ok || !data.dataUrl) throw new Error();
        URL.revokeObjectURL(previewUrl); previewUrl = data.dataUrl;
      } catch { setStatus("此 HEIC 圖片目前無法在瀏覽器完整預覽，但仍可在圖片上按右鍵進行文字辨識。"); }
    }
    setImage((current) => { if (current) URL.revokeObjectURL(current.url); return { file, url: previewUrl, name: file.name }; });
    event.target.value = "";
  };

  const extractImageText = async () => {
    if (!image) return;
    setOcrLoading(true); setError("");
    try {
      const form = new FormData(); form.append("image", image.file);
      const response = await fetch("/api/ocr", { method: "POST", body: form });
      const data = await response.json() as { error?: string; text?: string };
      if (!response.ok) throw new Error(data.error || "辨識失敗");
      insertHtml(`<p>${(data.text || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "<br>")}</p>`);
      setStatus("圖片文字已插入畫布，可直接編輯。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "圖片文字辨識失敗。"); }
    finally { setOcrLoading(false); }
  };

  const dragImage = (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData("text/plain", "memo-image");
    event.dataTransfer.effectAllowed = "move";
  };

  if (mode === "home") return <main className="flex min-h-screen bg-white text-[#2f2f2f]">
    <Sidebar onNew={() => beginPage()} />
    <section className="flex min-w-0 flex-1 items-center justify-center p-8"><div className="max-w-xl text-center"><div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-[#f0edff] text-[#715df2]"><LayoutList /></div><h1 className="text-3xl font-semibold">你的工作區是空白的</h1><p className="mt-3 leading-7 text-[#777771]">從一頁筆記開始、錄下會議，或將圖片轉成可編輯的文字。所有內容都會在同一張白色畫布中完成。</p><div className="mt-8 flex flex-wrap justify-center gap-3"><button onClick={() => beginPage("未命名筆記")} className="rounded-md bg-[#2f2f2f] px-4 py-2.5 text-sm font-medium text-white"><Plus className="mr-1 inline h-4 w-4" />建立空白筆記</button><button onClick={() => beginPage("未命名會議")} className="rounded-md border border-[#deded8] px-4 py-2.5 text-sm font-medium"><Mic className="mr-1 inline h-4 w-4" />建立錄音頁</button></div></div></section>
  </main>;

  return <main className="flex min-h-screen bg-white text-[#2f2f2f]"><Sidebar onNew={() => beginPage()} />
    <section className="min-w-0 flex-1 overflow-auto"><header className="flex h-14 items-center border-b border-[#ebebe6] px-6 text-sm text-[#73736d]"><button onClick={() => setMode("home")} className="hover:text-[#2f2f2f]">所有筆記</button><span className="mx-2">/</span><span>{title}</span></header>
      <div className="mx-auto max-w-4xl px-7 py-9 md:px-14"><input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full border-0 bg-transparent text-4xl font-bold outline-none placeholder:text-[#b4b4ae]" placeholder="未命名頁面" />
        <p className="mt-2 text-sm text-[#999991]">今天 · 私人頁面</p>
        <section className="mt-7 rounded-lg border border-[#e8e8e3] bg-white">
          <div className="flex min-h-12 flex-wrap items-center gap-3 border-b border-[#eeeeea] px-4 py-2"><div className="flex items-center gap-2 text-sm font-medium"><Mic className="h-4 w-4 text-[#715df2]" />錄音</div><span className="rounded-full bg-[#f3f3ef] px-2 py-1 text-xs text-[#777770]">{recording ? (paused ? "已暫停" : "錄音中") : audio ? "已儲存" : "可選擇啟用"}</span><span className="ml-auto font-mono text-sm">{formatTime(seconds)}</span></div>
          <div className="px-4 py-3"><div className="flex h-9 items-center gap-1 overflow-hidden rounded bg-[#fafaf8] px-3">{levels.map((level, index) => <span key={index} className="w-1 flex-1 rounded-full bg-[#917fff] transition-[height] duration-75" style={{ height: `${level}px`, opacity: recording ? 1 : .28 }} />)}</div>
          <div className="mt-3 flex flex-wrap items-center gap-2">{!recording ? <button onClick={startRecording} className="rounded-md bg-[#2f2f2f] px-3 py-2 text-sm text-white"><Mic className="mr-1 inline h-4 w-4" />開始錄音</button> : <><button onClick={togglePause} className="rounded-md border border-[#deded8] px-3 py-2 text-sm"><Pause className="mr-1 inline h-4 w-4" />{paused ? "繼續" : "暫停"}</button><button onClick={stopRecording} className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"><CircleStop className="mr-1 inline h-4 w-4" />停止</button></>}{audio && !recording && <button disabled={transcribing} onClick={transcribe} className="rounded-md border border-[#715df2] px-3 py-2 text-sm text-[#604deb] disabled:opacity-50"><FileAudio className="mr-1 inline h-4 w-4" />{transcribing ? "轉錄中…" : "產生逐字稿"}</button>}<span className="text-xs text-[#85857e]">{status}</span></div>{audio && <audio className="mt-3 h-9 w-full" controls src={audio.url} />}</div>
        </section>

        <section className="mt-6"><div className="mb-2 flex flex-wrap items-center gap-2"><div className="flex rounded-md border border-[#e5e5df] bg-[#fafaf9] p-1"><ToolbarButton label="H1" onClick={() => insertHtml("<h1>標題</h1><p><br></p>")} /><ToolbarButton label="H2" onClick={() => insertHtml("<h2>小標題</h2><p><br></p>")} /><ToolbarButton label="H3" onClick={() => insertHtml("<h3>小節標題</h3><p><br></p>")} /><ToolbarButton label="• 清單" onClick={() => document.execCommand("insertUnorderedList")} /><ToolbarButton label="1. 清單" onClick={() => document.execCommand("insertOrderedList")} /><ToolbarButton label="✓ 待辦" onClick={() => insertHtml('<p>☐ 待辦事項</p>')} /><ToolbarButton label="引用" onClick={() => insertHtml("<blockquote>引用內容</blockquote><p><br></p>")} /><ToolbarButton label="表格" onClick={insertTable} icon={<Table2 className="h-3.5 w-3.5" />} /></div><button onClick={() => imageInputRef.current?.click()} className="inline-flex items-center gap-1 rounded-md border border-[#e5e5df] px-2.5 py-1.5 text-xs hover:bg-[#fafafa]"><ImagePlus className="h-3.5 w-3.5" />圖片</button><button disabled={!segments.length || generating} onClick={generateNotes} className="ml-auto inline-flex items-center gap-1 rounded-md bg-[#715df2] px-3 py-2 text-sm font-medium text-white disabled:opacity-40"><Sparkles className="h-4 w-4" />{generating ? "整理中…" : "AI 整理筆記"}</button></div>
          <div className="group relative rounded-lg border border-[#e4e4de] bg-white"><div className="absolute -left-11 top-4 hidden items-center gap-1 group-hover:flex"><button title="新增區塊" onClick={() => setSlashOpen(true)} className="grid h-7 w-7 place-items-center rounded text-[#8b8b84] hover:bg-[#f1f1ed]"><Plus className="h-4 w-4" /></button><button title="拖曳區塊" draggable className="grid h-7 w-7 cursor-grab place-items-center rounded text-[#8b8b84] hover:bg-[#f1f1ed]"><GripVertical className="h-4 w-4" /></button></div><div ref={editorRef} contentEditable suppressContentEditableWarning onInput={(event) => setSlashOpen((event.currentTarget.textContent || "").endsWith("/"))} onKeyDown={(event) => { if (event.key === "/") setSlashOpen(true); if (event.key === "Escape") setSlashOpen(false); }} className="memo-editor min-h-[350px] p-5 outline-none" data-placeholder="輸入 / 可叫出區塊選單，或直接開始撰寫…" />{slashOpen && <div className="absolute left-5 top-14 z-10 w-60 rounded-lg border border-[#ddd] bg-white p-2 shadow-xl"><p className="px-2 pb-1 text-xs text-[#888]">插入區塊</p><MenuButton icon={<Type />} label="文字" onClick={() => insertHtml("<p>文字</p>")} /><MenuButton icon={<Type />} label="標題 1" onClick={() => insertHtml("<h1>標題</h1><p><br></p>")} /><MenuButton icon={<ListChecks />} label="待辦清單" onClick={() => insertHtml("<p>☐ 待辦事項</p>")} /><MenuButton icon={<ListOrdered />} label="編號清單" onClick={() => document.execCommand("insertOrderedList")} /><MenuButton icon={<Quote />} label="引用" onClick={() => insertHtml("<blockquote>引用內容</blockquote><p><br></p>")} /><MenuButton icon={<Code2 />} label="程式碼" onClick={() => insertHtml("<pre><code>輸入程式碼</code></pre><p><br></p>")} /><MenuButton icon={<Table2 />} label="表格" onClick={insertTable} /><MenuButton icon={<ImagePlus />} label="圖片" onClick={() => { setSlashOpen(false); imageInputRef.current?.click(); }} /></div>}</div>
          <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={selectImage} />
          {image && <div draggable onDragStart={dragImage} className="group relative mt-4 rounded-lg border border-[#e5e5df] bg-white p-2"><div className="absolute -left-11 top-3 hidden items-center gap-1 group-hover:flex"><button title="新增區塊" onClick={() => setSlashOpen(true)} className="grid h-7 w-7 place-items-center rounded text-[#8b8b84] hover:bg-[#f1f1ed]"><Plus className="h-4 w-4" /></button><span title="拖曳圖片區塊" className="grid h-7 w-7 cursor-grab place-items-center rounded text-[#8b8b84] hover:bg-[#f1f1ed]"><GripVertical className="h-4 w-4" /></span></div><img onContextMenu={(event) => { event.preventDefault(); setImageMenu({ x: event.clientX, y: event.clientY }); }} src={image.url} alt={image.name} className="max-h-[680px] w-full cursor-context-menu rounded object-contain" />{imageMenu && <div style={{ left: imageMenu.x, top: imageMenu.y }} className="fixed z-50 w-52 rounded-lg border border-[#deded8] bg-white p-1.5 shadow-xl"><button disabled={ocrLoading} onClick={() => { setImageMenu(null); void extractImageText(); }} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-[#f4f3ff] disabled:opacity-50"><Sparkles className="h-4 w-4 text-[#715df2]" />{ocrLoading ? "AI 轉換中…" : "AI 轉換為文字"}</button><button onClick={() => setImageMenu(null)} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-[#f4f3ff]">關閉選單</button></div>}</div>}
          {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        </section>
        {segments.length > 0 && <section className="mt-8 border-t border-[#e9e9e4] pt-6"><h2 className="mb-3 text-lg font-semibold">逐字稿</h2><div className="space-y-2">{segments.map((segment, index) => <div key={`${segment.start}-${index}`} className="rounded-md border border-[#eeeeea] p-3 text-sm"><span className="mr-3 font-mono text-[#715df2]">{formatTime(segment.start)}</span><b>{segment.speaker}</b><p className="mt-1 pl-12 leading-6 text-[#575751]">{segment.text}</p></div>)}</div></section>}
      </div>
    </section>
  </main>;
}

function Sidebar({ onNew }: { onNew: () => void }) { return <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-[#e9e9e4] bg-[#fbfbfa] p-3"><div className="mb-7 flex items-center gap-2 px-2 pt-1 text-lg font-semibold"><span className="grid h-7 w-7 place-items-center rounded-md bg-[#715df2] text-sm text-white">m</span> Memo AI</div><button onClick={onNew} className="mb-3 flex items-center gap-2 rounded-md bg-[#715df2] px-3 py-2.5 text-sm font-medium text-white"><Plus className="h-4 w-4" />新增頁面</button><nav className="space-y-1 text-sm"><button className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-[#f0f0ed]"><LayoutList className="h-4 w-4" />所有頁面</button><button className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-[#f0f0ed]"><Search className="h-4 w-4" />搜尋</button></nav><div className="mt-7"><div className="mb-2 flex items-center justify-between px-2 text-xs font-medium text-[#999991]">私人資料夾 <Plus className="h-3.5 w-3.5" /></div><button className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-[#f0f0ed]"><Folder className="h-4 w-4 text-[#a59472]" />所有筆記</button></div><div className="mt-auto border-t border-[#e9e9e4] px-2 py-3 text-sm text-[#73736d]">Jay Lin <ChevronDown className="float-right mt-1 h-3.5 w-3.5" /></div></aside>; }
function ToolbarButton({ label, onClick, icon }: { label: string; onClick: () => void; icon?: React.ReactNode }) { return <button onClick={onClick} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-white">{icon}{label}</button>; }
function MenuButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) { return <button onClick={onClick} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-[#f4f3ff]">{icon}{label}</button>; }
