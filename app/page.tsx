"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { UserButton, useUser } from "@clerk/nextjs";
import {
  AudioLines,
  CircleStop,
  Copy,
  FileAudio,
  Folder,
  GripVertical,
  ImagePlus,
  LayoutList,
  ListChecks,
  ListOrdered,
  Mic,
  Pause,
  PanelRight,
  Plus,
  Quote,
  Search,
  Sparkles,
  Table2,
  Trash2,
  Type,
  X,
} from "lucide-react";

type Segment = { start: number; end: number; speaker: string; text: string };
type NoteItem = {
  id: string;
  title: string;
  editedAt: string;
  folderId?: string;
};
type FolderItem = { id: string; name: string };
type Clip = {
  id: string;
  url: string;
  blob: Blob;
  duration: number;
  createdAt: string;
  title: string;
  transcript?: Segment[];
  summary?: string;
};
type PanelTab = "recording" | "transcript" | "summary";
type Tab = "notes" | "transcript" | "summary";
type Menu = "none" | "insert" | "block" | "image";
const fmt = (n: number) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(n % 60)
    .toString()
    .padStart(2, "0")}`;

export default function Home() {
  const editor = useRef<HTMLDivElement>(null),
    selection = useRef<Range | null>(null),
    imageInput = useRef<HTMLInputElement>(null),
    activeBlock = useRef<HTMLElement | null>(null),
    blockLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    context = useRef<AudioContext | null>(null),
    frame = useRef<number | null>(null),
    chunks = useRef<Blob[]>([]),
    images = useRef(new Map<string, File>()),
    secondsRef = useRef(0);
  const [tab, setTab] = useState<Tab>("notes"),
    [title, setTitle] = useState("未命名筆記"),
    [emoji, setEmoji] = useState("📄"),
    [edited, setEdited] = useState(new Date());
  const [notes, setNotes] = useState<NoteItem[]>([
      {
        id: "first-note",
        title: "未命名筆記",
        editedAt: new Date().toISOString(),
      },
    ]),
    [activeNoteId, setActiveNoteId] = useState("first-note");
  const [folders, setFolders] = useState<FolderItem[]>([]),
    [activeFolder, setActiveFolder] = useState<string | "all">("all"),
    [workspaceView, setWorkspaceView] = useState<"note" | "all">("note"),
    [searchQuery, setSearchQuery] = useState("");
  const [recording, setRecording] = useState(false),
    [paused, setPaused] = useState(false),
    [seconds, setSeconds] = useState(0),
    [levels, setLevels] = useState<number[]>(Array(34).fill(6)),
    [audio, setAudio] = useState<{ blob: Blob; url: string } | null>(null),
    [clips, setClips] = useState<Clip[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]),
    [summary, setSummary] = useState(""),
    [menu, setMenu] = useState<Menu>("none"),
    [menuAt, setMenuAt] = useState({ x: 150, y: 180 }),
    [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false),
    [generating, setGenerating] = useState(false),
    [ocr, setOcr] = useState(false),
    [imageImporting, setImageImporting] = useState(false),
    [draggingImage, setDraggingImage] = useState(false),
    [blockControlTop, setBlockControlTop] = useState<number | null>(null),
    [recordingPanel, setRecordingPanel] = useState(false),
    [selectedClipId, setSelectedClipId] = useState<string | null>(null),
    [panelTab, setPanelTab] = useState<PanelTab>("recording"),
    [error, setError] = useState(""),
    [status, setStatus] = useState("可直接寫筆記；需要時再開始錄音。");

  useEffect(() => {
    if (!recording || paused) return;
    const id = setInterval(
      () =>
        setSeconds((v) => {
          secondsRef.current = v + 1;
          return v + 1;
        }),
      1000,
    );
    return () => clearInterval(id);
  }, [recording, paused]);
  useEffect(() => {
    const stored = window.localStorage.getItem("memo-ai-notes");
    if (!stored) return;
    try {
      const saved = JSON.parse(stored) as NoteItem[];
      if (saved.length) {
        setNotes(saved);
        setActiveNoteId(saved[0].id);
        setTitle(saved[0].title);
      }
    } catch {
      /* ignore invalid local data */
    }
  }, []);
  useEffect(() => {
    window.localStorage.setItem("memo-ai-notes", JSON.stringify(notes));
  }, [notes]);
  useEffect(() => {
    const close = () => setMenu("none");
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
    };
  }, []);
  useEffect(() => {
    editor.current
      ?.querySelectorAll<HTMLElement>("figure[data-image-id]")
      .forEach((figure) =>
        figure.classList.toggle(
          "memo-image-selected",
          figure.dataset.imageId === selectedImage,
        ),
      );
  }, [selectedImage, ocr]);
  useEffect(
    () => () => {
      stream.current?.getTracks().forEach((x) => x.stop());
      if (frame.current) cancelAnimationFrame(frame.current);
      void context.current?.close();
      if (audio) URL.revokeObjectURL(audio.url);
    },
    [audio],
  );

  const remember = () => {
    const s = window.getSelection();
    if (s?.rangeCount && editor.current?.contains(s.anchorNode))
      selection.current = s.getRangeAt(0).cloneRange();
  };
  const renameNote = (value: string) => {
    setTitle(value);
    const now = new Date();
    setEdited(now);
    setNotes((current) =>
      current.map((note) =>
        note.id === activeNoteId
          ? {
              ...note,
              title: value || "未命名筆記",
              editedAt: now.toISOString(),
            }
          : note,
      ),
    );
  };
  const newNote = () => {
    const now = new Date();
    const usedTitles = new Set(notes.map((item) => item.title));
    let index = 1;
    while (usedTitles.has(`未命名筆記 ${index}`)) index += 1;
    const note = {
      id: crypto.randomUUID(),
      title: `未命名筆記 ${index}`,
      editedAt: now.toISOString(),
      folderId: activeFolder === "all" ? undefined : activeFolder,
    };
    setNotes((current) => [note, ...current]);
    setActiveNoteId(note.id);
    setTitle(note.title);
    setEdited(now);
    setSegments([]);
    setSummary("");
    setAudio(null);
    setClips([]);
    setSeconds(0);
    setRecordingPanel(false);
    setSelectedClipId(null);
    setWorkspaceView("note");
    if (editor.current) editor.current.innerHTML = "";
    setStatus("可直接寫筆記；需要時再開始錄音。");
  };
  const selectNote = (note: NoteItem) => {
    setActiveNoteId(note.id);
    setTitle(note.title);
    setEdited(new Date(note.editedAt));
    setRecordingPanel(false);
    setSelectedClipId(null);
    setWorkspaceView("note");
  };
  const createFolder = () => {
    const name = window.prompt("資料夾名稱");
    if (!name?.trim()) return;
    setFolders((current) => [
      ...current,
      { id: crypto.randomUUID(), name: name.trim() },
    ]);
  };
  const moveNote = (noteId: string, folderId?: string) => {
    setNotes((current) =>
      current.map((note) => (note.id === noteId ? { ...note, folderId } : note)),
    );
  };
  const deleteNote = (id: string) => {
    if (
      notes.length === 1 ||
      !window.confirm("要刪除這筆筆記嗎？此操作無法復原。")
    )
      return;
    const remaining = notes.filter((note) => note.id !== id);
    setNotes(remaining);
    if (id === activeNoteId) selectNote(remaining[0]);
  };
  const closeAudio = () => {
    if (frame.current) cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((x) => x.stop());
    void context.current?.close();
    context.current = null;
    setLevels(Array(34).fill(6));
  };
  const insert = (html: string) => {
    const s = window.getSelection();
    editor.current?.focus();
    if (selection.current && s) {
      s.removeAllRanges();
      s.addRange(selection.current);
    }
    document.execCommand("insertHTML", false, html);
    setMenu("none");
    setEdited(new Date());
  };
  const insertAfterBlock = (html: string) => {
    const block = activeBlock.current;
    if (!block) return insert(html);
    const range = document.createRange();
    range.setStartAfter(block);
    range.collapse(true);
    selection.current = range;
    insert(html);
  };
  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("已複製到剪貼簿，可貼到筆記任一位置。 ");
    } catch {
      setError("無法存取剪貼簿，請手動選取後複製。 ");
    }
  };
  const table = () =>
    insert(
      "<table><tbody><tr><th>欄位一</th><th>欄位二</th><th>欄位三</th></tr><tr><td>內容</td><td>內容</td><td>內容</td></tr><tr><td>內容</td><td>內容</td><td>內容</td></tr></tbody></table><p><br></p>",
    );
  const showMenu = (kind: Menu, x?: number, y?: number) => {
    remember();
    const r = selection.current?.getBoundingClientRect();
    setMenuAt({ x: x ?? r?.left ?? 160, y: y ?? r?.bottom ?? 230 });
    setMenu(kind);
  };

  const start = async () => {
    setError("");
    try {
      const source = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : undefined;
      const media = new MediaRecorder(
        source,
        mime ? { mimeType: mime } : undefined,
      );
      chunks.current = [];
      media.ondataavailable = ({ data }) => {
        if (data.size) chunks.current.push(data);
      };
      media.onstop = () => {
        const blob = new Blob(chunks.current, {
          type: media.mimeType || "audio/webm",
        });
        const url = URL.createObjectURL(blob);
        setAudio({ blob, url });
        const clip = {
          id: crypto.randomUUID(),
          url,
          blob,
          duration: secondsRef.current,
          createdAt: new Date().toISOString(),
          title: `錄音 ${clips.length + 1}`,
        };
        setClips((current) => [...current, clip]);
        setSelectedClipId(clip.id);
        setPanelTab("recording");
        closeAudio();
        setStatus("錄音片段已儲存。可繼續新增下一段錄音，或產生逐字稿。 ");
      };
      const ac = new AudioContext(),
        analyser = ac.createAnalyser();
      analyser.fftSize = 256;
      ac.createMediaStreamSource(source).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const draw = () => {
        analyser.getByteFrequencyData(data);
        setLevels(
          Array.from({ length: 34 }, (_, i) =>
            Math.max(
              5,
              Math.min(44, data[Math.floor((i * data.length) / 34)] / 5),
            ),
          ),
        );
        frame.current = requestAnimationFrame(draw);
      };
      stream.current = source;
      context.current = ac;
      recorder.current = media;
      media.start(1000);
      void ac.resume();
      draw();
      secondsRef.current = 0;
      setSeconds(0);
      setRecording(true);
      setPaused(false);
      setStatus("錄音中；可切換筆記分頁同步記錄。");
    } catch {
      setError("無法使用麥克風，請在瀏覽器網站權限中允許麥克風。 ");
    }
  };
  const pause = () => {
    const media = recorder.current;
    if (!media) return;
    if (media.state === "recording") {
      media.pause();
      setPaused(true);
    } else {
      media.resume();
      setPaused(false);
    }
  };
  const stop = () => {
    const media = recorder.current;
    if (media && media.state !== "inactive") media.stop();
    setRecording(false);
    setPaused(false);
  };
  const transcribe = async () => {
    const clip = clips.find((item) => item.id === selectedClipId);
    if (!clip) return;
    setTranscribing(true);
    setError("");
    try {
      const body = new FormData();
      body.append(
        "audio",
        new File([clip.blob], "memo-recording.webm", {
          type: clip.blob.type || "audio/webm",
        }),
      );
      body.append("mode", "accurate");
      const res = await fetch("/api/transcribe", { method: "POST", body });
      const data = (await res.json()) as {
        error?: string;
        transcript?: Segment[];
      };
      if (!res.ok) throw new Error(data.error || "轉錄失敗");
      const transcript = data.transcript || [];
      setSegments(transcript);
      setClips((current) =>
        current.map((item) =>
          item.id === clip.id ? { ...item, transcript } : item,
        ),
      );
      setPanelTab("transcript");
      setStatus(
        data.transcript?.length
          ? "逐字稿完成，可繼續新增錄音片段或生成會議總結。"
          : "沒有辨識到語音內容。",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "轉錄失敗。 ");
    } finally {
      setTranscribing(false);
    }
  };
  const summarize = async () => {
    const clip = clips.find((item) => item.id === selectedClipId);
    const source = clip?.transcript || segments;
    if (!source.length) return;
    setGenerating(true);
    setError("");
    try {
      const transcript = source
        .map((x) => `[${fmt(x.start)}] ${x.speaker}：${x.text}`)
        .join("\n");
      const res = await fetch("/api/ai-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      const data = (await res.json()) as {
        error?: string;
        notes?: string;
        empty?: boolean;
      };
      if (!res.ok) throw new Error(data.error || "AI 生成失敗。");
      const nextSummary = data.empty ? "" : data.notes || "";
      setSummary(nextSummary);
      if (clip)
        setClips((current) =>
          current.map((item) =>
            item.id === clip.id ? { ...item, summary: nextSummary } : item,
          ),
        );
      setPanelTab("summary");
      setStatus(
        data.empty
          ? "逐字稿沒有足夠的會議重點可整理。"
          : "AI 已依據逐字稿生成會議總結。 ",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 生成失敗。 ");
    } finally {
      setGenerating(false);
    }
  };

  const addImage = async (file: File, range?: Range | null) => {
    if (!file.type.startsWith("image/") && !/\.hei[cf]$/i.test(file.name))
      return setError("請上傳圖片檔。 ");
    setImageImporting(true);
    try {
      const id = crypto.randomUUID();
      images.current.set(id, file);
      let url = URL.createObjectURL(file);
      if (/\.hei[cf]$/i.test(file.name) || file.type === "image/heic")
        try {
          const body = new FormData();
          body.append("image", file);
          const res = await fetch("/api/image-preview", {
            method: "POST",
            body,
          });
          const data = (await res.json()) as { dataUrl?: string };
          if (data.dataUrl) url = data.dataUrl;
        } catch {
          setStatus("HEIC 圖片無法預覽時，仍可右鍵執行文字辨識。 ");
        }
      const html = `<figure data-image-id="${id}" contenteditable="false" style="margin:16px 0"><img src="${url}" alt="${file.name}" style="display:block;max-width:100%;max-height:680px;border-radius:8px;cursor:context-menu" /><figcaption style="margin-top:6px;color:#999;font-size:12px">${file.name}</figcaption></figure><p><br></p>`;
      if (range) {
        const holder = document.createElement("div");
        holder.innerHTML = html;
        range.deleteContents();
        range.insertNode(holder);
      } else insert(html);
      setEdited(new Date());
    } finally {
      setImageImporting(false);
    }
  };
  const choose = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void addImage(file);
    e.target.value = "";
  };
  const drop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    const file = Array.from(e.dataTransfer.files).find(
      (x) => x.type.startsWith("image/") || /\.hei[cf]$/i.test(x.name),
    );
    if (!file) return;
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range;
    };
    void addImage(
      file,
      doc.caretRangeFromPoint?.(e.clientX, e.clientY) || selection.current,
    );
  };
  const extract = async () => {
    if (!selectedImage) return;
    const file = images.current.get(selectedImage);
    if (!file) return;
    setOcr(true);
    setMenu("none");
    setError("");
    try {
      const loadingFigure = editor.current?.querySelector<HTMLElement>(
        `figure[data-image-id="${selectedImage}"]`,
      );
      loadingFigure?.classList.add("memo-image-ocr-loading");
      const body = new FormData();
      body.append("image", file);
      const res = await fetch("/api/ocr", { method: "POST", body });
      const data = (await res.json()) as { error?: string; text?: string };
      if (!res.ok || !data.text)
        throw new Error(data.error || "圖片文字辨識失敗");
      const figure = editor.current?.querySelector(
        `figure[data-image-id="${selectedImage}"]`,
      );
      if (figure) figure.outerHTML = htmlFromText(data.text);
      setStatus("圖片已轉換為可編輯文字。 ");
      setEdited(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "圖片文字辨識失敗。 ");
    } finally {
      editor.current
        ?.querySelector<HTMLElement>(
          `figure[data-image-id="${selectedImage}"]`,
        )
        ?.classList.remove("memo-image-ocr-loading");
      setOcr(false);
      setSelectedImage(null);
    }
  };

  return (
    <main
      className="flex min-h-screen bg-white text-[#2f2f2f]"
      onDragOver={(e) => e.preventDefault()}
    >
      <Sidebar
        notes={notes}
        activeNoteId={activeNoteId}
        folders={folders}
        activeFolder={activeFolder}
        workspaceView={workspaceView}
        searchQuery={searchQuery}
        onNew={newNote}
        onSelect={selectNote}
        onDelete={deleteNote}
        onCreateFolder={createFolder}
        onMoveNote={moveNote}
        onFolderSelect={setActiveFolder}
        onAllFiles={() => setWorkspaceView("all")}
        onSearch={setSearchQuery}
      />
      <section className="min-w-0 flex-1 overflow-auto">
        <header className="flex h-14 items-center border-b border-[#ebebe6] px-6 text-sm text-[#73736d]">
          所有頁面 <span className="mx-2">/</span> {title}
        </header>
        {workspaceView === "all" ? (
          <AllFiles notes={notes} folders={folders} query={searchQuery} onOpen={selectNote} onMove={moveNote} />
        ) : (
        <div className="mx-auto max-w-4xl px-10 py-9">
          <div className="flex items-center gap-3">
            <input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              className="h-12 w-14 border-0 bg-transparent text-center text-3xl outline-none"
              title="點擊後按 Control + Command + Space 開啟系統 Emoji 選擇器"
            />
            <span className="text-xs text-[#999]">
              點擊圖示後按 ⌃⌘Space 使用系統 Emoji
            </span>
          </div>
          <input
            value={title}
            onChange={(e) => renameNote(e.target.value)}
            className="mt-3 w-full border-0 bg-transparent text-4xl font-bold outline-none"
          />
          <p className="mt-2 text-sm text-[#999]">
            上次編輯：
            {edited.toLocaleString("zh-TW", {
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            · 私人頁面
          </p>
          <AudioComposer
            clipCount={clips.length}
            recording={recording}
            onOpen={() => setRecordingPanel(true)}
          />
          {recordingPanel && (
            <>
            <button aria-label="關閉錄音面板" className="fixed inset-0 z-30 cursor-default bg-black/5" onClick={() => setRecordingPanel(false)} />
            <RecordingPanel
              recording={recording}
              paused={paused}
              audio={audio}
              clips={clips}
              segments={segments}
              seconds={seconds}
              levels={levels}
              transcribing={transcribing}
              status={status}
              onStart={start}
              onPause={pause}
              onStop={stop}
              onTranscribe={transcribe}
              onClose={() => setRecordingPanel(false)}
              selectedClipId={selectedClipId}
              panelTab={panelTab}
              generating={generating}
              onPanelTab={setPanelTab}
              onGenerate={summarize}
              onSelectClip={(clip) => {
                setSelectedClipId(clip.id);
                setSegments(clip.transcript || []);
                setSummary(clip.summary || "");
                setPanelTab("recording");
              }}
              onRenameClip={(clipId, value) => setClips((current) => current.map((clip) => clip.id === clipId ? { ...clip, title: value } : clip))}
              onDeleteClip={(clipId) => {
                setClips((current) => {
                  const removed = current.find((clip) => clip.id === clipId);
                  if (removed) URL.revokeObjectURL(removed.url);
                  return current.filter((clip) => clip.id !== clipId);
                });
                if (selectedClipId === clipId) { setSelectedClipId(null); setSegments([]); setSummary(""); }
              }}
            />
            </>
          )}
          <nav className="hidden mt-7 items-center gap-1 border-b border-[#e9e9e4]">
            <Tab
              active={tab === "notes"}
              label="筆記"
              onClick={() => setTab("notes")}
            />
            <Tab
              active={tab === "transcript"}
              label={`逐字稿${segments.length ? ` (${segments.length})` : ""}`}
              onClick={() => setTab("transcript")}
            />
            <Tab
              active={tab === "summary"}
              label="AI 總結"
              onClick={() => setTab("summary")}
            />
            {tab === "transcript" && (
              <button
                disabled={generating || !segments.length}
                onClick={summarize}
                className="ml-auto mb-2 rounded-md bg-[#715df2] px-3 py-2 text-sm text-white disabled:opacity-40"
              >
                <Sparkles className="mr-1 inline h-4 w-4" />
                {generating ? "生成中…" : "生成會議總結"}
              </button>
            )}
          </nav>
          {tab === "notes" && (
            <section
              className="pt-5"
              onDragEnter={(event) => {
                event.preventDefault();
                setDraggingImage(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDraggingImage(true);
              }}
              onDragLeave={(event) => {
                if (event.currentTarget === event.target)
                  setDraggingImage(false);
              }}
              onDrop={(event) => {
                setDraggingImage(false);
                drop(event);
              }}
            >
              <div
                className="relative pl-14"
                onMouseLeave={() => {
                  blockLeaveTimer.current = setTimeout(
                    () => setBlockControlTop(null),
                    220,
                  );
                }}
                onMouseEnter={() => {
                  if (blockLeaveTimer.current)
                    clearTimeout(blockLeaveTimer.current);
                }}
                onMouseMove={(event) => {
                  const target = (event.target as HTMLElement).closest(
                    "p,h1,h2,h3,blockquote,figure,li,table",
                  );
                  if (!target || !editor.current?.contains(target))
                    return setBlockControlTop(null);
                  activeBlock.current = target as HTMLElement;
                  setBlockControlTop(
                    (target as HTMLElement).getBoundingClientRect().top -
                      (
                        event.currentTarget as HTMLElement
                      ).getBoundingClientRect().top +
                      2,
                  );
                }}
              >
                {draggingImage && (
                  <div
                    className="notion-drop-line"
                    aria-label="圖片將插入此處"
                  />
                )}
                {blockControlTop !== null && (
                  <div
                    style={{ top: blockControlTop }}
                    className="absolute left-1 z-20 flex gap-1"
                  >
                    <button
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); showMenu("insert", rect.right + 8, rect.top); }}
                      className="grid h-7 w-7 place-items-center rounded text-[#888] hover:bg-[#f1f1ed]"
                      title="在此區塊後新增"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    <button
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); showMenu("block", rect.right + 8, rect.top); }}
                      className="grid h-7 w-7 place-items-center rounded text-[#888] hover:bg-[#f1f1ed]"
                      title="區塊操作"
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>
                  </div>
                )}
                <div
                  ref={editor}
                  contentEditable
                  suppressContentEditableWarning
                  onInput={() => {
                    remember();
                    setEdited(new Date());
                  }}
                  onKeyUp={remember}
                  onMouseUp={remember}
                  onKeyDown={(event) => {
                    if (event.key === "/") showMenu("insert");
                    if (event.key === "Escape") setMenu("none");
                    if (event.key === " ") {
                      const node = window.getSelection()?.anchorNode;
                      const line =
                        (node instanceof HTMLElement
                          ? node
                          : node?.parentElement
                        )
                          ?.closest("p,div")
                          ?.textContent?.trim() || "";
                      if (line === "-" || line === "*" || line === "•") {
                        event.preventDefault();
                        document.execCommand("insertUnorderedList");
                      }
                      if (/^1[.)]$/.test(line)) {
                        event.preventDefault();
                        document.execCommand("insertOrderedList");
                      }
                    }
                  }}
                  onContextMenu={(event) => {
                    const figure = (event.target as HTMLElement).closest(
                      "figure[data-image-id]",
                    );
                    if (figure) {
                      event.preventDefault();
                      setSelectedImage(figure.getAttribute("data-image-id"));
                      showMenu("image", event.clientX, event.clientY);
                    }
                  }}
                  onFocus={(event) => {
                    if (!event.currentTarget.innerHTML.trim())
                      event.currentTarget.innerHTML = "<p><br></p>";
                  }}
                  className="memo-editor min-h-[360px] py-5 outline-none"
                  data-placeholder="輸入 / 可叫出區塊選單，或拖曳圖片到此處…"
                />
              </div>
              <input
                ref={imageInput}
                type="file"
                accept="image/*,.heic,.heif"
                className="hidden"
                onChange={choose}
              />
            </section>
          )}
          {tab === "transcript" && (
            <Transcript
              segments={segments}
              onChange={(index, text) => {
                setSegments((current) =>
                  current.map((segment, itemIndex) =>
                    itemIndex === index ? { ...segment, text } : segment,
                  ),
                );
                setEdited(new Date());
              }}
            />
          )}
          {tab === "summary" && (
            <Summary
              value={summary}
              generating={generating}
              onChange={(value) => {
                setSummary(value);
                setEdited(new Date());
              }}
              onGenerate={summarize}
            />
          )}
          {menu !== "none" && (
            <BlockMenu
              kind={menu}
              point={menuAt}
              onInsert={insertAfterBlock}
              onTable={table}
              onImage={() => imageInput.current?.click()}
              onOCR={extract}
            />
          )}
          {imageImporting && (
            <div className="fixed bottom-7 right-7 z-50 rounded-full bg-[#292928] px-4 py-3 text-sm text-white shadow-xl">
              正在匯入圖片…
            </div>
          )}
          {ocr && (
            <div className="fixed bottom-7 right-7 z-50 rounded-full bg-[#292928] px-4 py-3 text-sm text-white shadow-xl">
              AI 正在辨識圖片文字…
            </div>
          )}
          {error && (
            <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
        )}
      </section>
    </main>
  );
}

function AllFiles({ notes, folders, query, onOpen, onMove }: { notes: NoteItem[]; folders: FolderItem[]; query: string; onOpen: (note: NoteItem) => void; onMove: (id: string, folderId?: string) => void }) {
  const normalized = query.trim().toLocaleLowerCase();
  const visible = notes.filter((note) => note.title.toLocaleLowerCase().includes(normalized));
  return <div className="mx-auto max-w-4xl px-10 py-9"><h1 className="text-3xl font-bold">所有檔案</h1><p className="mt-2 text-sm text-[#888]">可搜尋、開啟，或拖曳檔案到左側資料夾。</p><div className="mt-7 grid gap-2">{visible.map((note) => <div key={note.id} draggable onDragStart={(event) => event.dataTransfer.setData("text/memo-note", note.id)} className="flex items-center rounded-lg border border-[#e8e8e3] px-4 py-3 hover:bg-[#fafaf8]"><button onClick={() => onOpen(note)} className="min-w-0 flex-1 text-left"><b className="block truncate">{note.title}</b><span className="text-xs text-[#999]">{folders.find((folder) => folder.id === note.folderId)?.name || "未分類"} · {new Date(note.editedAt).toLocaleDateString("zh-TW")}</span></button><select value={note.folderId || ""} onChange={(event) => onMove(note.id, event.target.value || undefined)} className="rounded border border-[#e3e3dd] bg-white px-2 py-1 text-xs"><option value="">未分類</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></div>)}</div>{!visible.length && <EmptyState title="找不到檔案" description="試著改用其他關鍵字搜尋。" />}</div>;
}
function Sidebar({
  notes,
  activeNoteId,
  folders,
  activeFolder,
  workspaceView,
  searchQuery,
  onNew,
  onSelect,
  onDelete,
  onCreateFolder,
  onMoveNote,
  onFolderSelect,
  onAllFiles,
  onSearch,
}: {
  notes: NoteItem[];
  activeNoteId: string;
  folders: FolderItem[];
  activeFolder: string | "all";
  workspaceView: "note" | "all";
  searchQuery: string;
  onNew: () => void;
  onSelect: (note: NoteItem) => void;
  onDelete: (id: string) => void;
  onCreateFolder: () => void;
  onMoveNote: (id: string, folderId?: string) => void;
  onFolderSelect: (id: string | "all") => void;
  onAllFiles: () => void;
  onSearch: (value: string) => void;
}) {
  const { user } = useUser();
  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-[#e9e9e4] bg-[#fbfbfa] p-3">
      <div className="mb-7 flex items-center gap-2 px-2 pt-1 text-lg font-semibold">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-[#715df2] text-sm text-white">
          m
        </span>
        Memo AI
      </div>
      <button
        onClick={onNew}
        className="mb-3 flex w-full items-center gap-2 rounded-xl bg-[#efefef] px-3 py-2.5 text-sm font-medium text-[#303030] transition hover:bg-[#e3e3e3]"
      >
        <Plus className="h-4 w-4" />
        新增筆記
      </button>
      <button onClick={onAllFiles} className={`flex gap-2 rounded px-2 py-2 text-sm ${workspaceView === "all" ? "bg-[#ece9ff] text-[#604deb]" : "hover:bg-[#efefea]"}`}>
        <LayoutList className="h-4 w-4" />
        所有檔案
      </button>
      <label className="mt-1 flex items-center gap-2 rounded px-2 py-2 text-sm hover:bg-[#efefea]">
        <Search className="h-4 w-4" />
        <input value={searchQuery} onFocus={onAllFiles} onChange={(e) => onSearch(e.target.value)} placeholder="搜尋" className="min-w-0 w-full text-sm outline-none" />
      </label>
      <div className="mt-7 flex items-center justify-between px-2 text-xs text-[#999]"><span>私人資料夾</span><button onClick={onCreateFolder} className="rounded p-1 text-base hover:bg-[#efefea]" aria-label="新增資料夾">+</button></div>
      <div className="mt-2">
        <button onClick={() => onFolderSelect("all")} className={`flex w-full gap-2 rounded px-2 py-1 text-left text-sm ${activeFolder === "all" ? "text-[#604deb]" : "text-[#666]"}`}>
          <Folder className="h-4 w-4" />
          所有筆記
        </button>
        {folders.map((folder) => <button key={folder.id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData("text/memo-note"); if (id) onMoveNote(id, folder.id); }} onClick={() => onFolderSelect(folder.id)} className={`mt-1 flex w-full gap-2 rounded px-2 py-1 text-left text-sm ${activeFolder === folder.id ? "bg-[#ece9ff] text-[#604deb]" : "text-[#666] hover:bg-[#efefea]"}`}><Folder className="h-4 w-4" />{folder.name}</button>)}
        <div className="mt-1 space-y-0.5">
          {notes.filter((note) => activeFolder === "all" || note.folderId === activeFolder).map((note) => (
            <div
              key={note.id}
              draggable
              onDragStart={(event) => event.dataTransfer.setData("text/memo-note", note.id)}
              className={`group flex items-center rounded ${activeNoteId === note.id ? "bg-[#ece9ff] text-[#604deb]" : "text-[#555] hover:bg-[#efefea]"}`}
            >
              <button
                onClick={() => onSelect(note)}
                className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm"
              >
                {note.title || "未命名筆記"}
              </button>
              <button
                aria-label={`刪除 ${note.title}`}
                onClick={() => onDelete(note.id)}
                className="mr-1 hidden rounded p-1 hover:bg-white/70 group-hover:block"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
      <div role="button" tabIndex={0} onClick={() => document.querySelector<HTMLElement>(".cl-userButtonTrigger")?.click()} className="mt-auto flex cursor-pointer items-center gap-2 border-t border-[#e9e9e4] px-2 py-3 text-sm text-[#73736d] hover:bg-[#f1f1ed]">
        <UserButton
          appearance={{ elements: { userButtonAvatarBox: "h-7 w-7" } }}
        />
        <span className="min-w-0 flex-1 truncate">
          {user?.fullName || user?.primaryEmailAddress?.emailAddress || "帳戶"}
        </span>
      </div>
    </aside>
  );
}
function AudioComposer({
  clipCount,
  recording,
  onOpen,
}: {
  clipCount: number;
  recording: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="mt-6 flex w-full items-center gap-3 rounded-xl border border-[#e7e7e1] bg-[#fafaf8] px-4 py-3 text-left shadow-sm transition hover:border-[#cfc8ff] hover:bg-white"
    >
      <span
        className={`grid h-9 w-9 place-items-center rounded-full ${recording ? "bg-red-100 text-red-600" : "bg-[#eeeaff] text-[#705cf2]"}`}
      >
        <Mic className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">
          {recording ? "正在錄音" : "語音記錄"}
        </span>
        <span className="block truncate text-xs text-[#888]">
          {clipCount
            ? `已儲存 ${clipCount} 段錄音，開啟面板管理或轉錄`
            : "點擊開始錄音、轉錄，或管理已錄內容"}
        </span>
      </span>
      <PanelRight className="h-5 w-5 text-[#777]" />
    </button>
  );
}
function RecordingPanel({
  recording,
  paused,
  audio,
  clips,
  segments,
  seconds,
  levels,
  transcribing,
  status,
  onStart,
  onPause,
  onStop,
  onTranscribe,
  onClose,
  selectedClipId,
  panelTab,
  generating,
  onPanelTab,
  onGenerate,
  onSelectClip,
  onRenameClip,
  onDeleteClip,
}: {
  recording: boolean;
  paused: boolean;
  audio: { blob: Blob; url: string } | null;
  clips: Clip[];
  segments: Segment[];
  seconds: number;
  levels: number[];
  transcribing: boolean;
  status: string;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  onTranscribe: () => void;
  onClose: () => void;
  selectedClipId: string | null;
  panelTab: PanelTab;
  generating: boolean;
  onPanelTab: (tab: PanelTab) => void;
  onGenerate: () => void;
  onSelectClip: (clip: Clip) => void;
  onRenameClip: (clipId: string, value: string) => void;
  onDeleteClip: (clipId: string) => void;
}) {
  const selected = clips.find((clip) => clip.id === selectedClipId);
  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[430px] flex-col border-l border-[#e5e5e0] bg-white shadow-2xl">
      <div className="flex items-center gap-2 border-b border-[#eee] px-5 py-4">
        <AudioLines className="h-4 w-4 text-[#715df2]" />
        <b className="text-sm">語音記錄</b>
        <span className="rounded-full bg-[#f3f3ef] px-2 py-1 text-xs">
          {recording
            ? paused
              ? "已暫停"
              : "錄音中"
            : clips.length
              ? `${clips.length} 段已儲存`
              : "尚未開始"}
        </span>
        <span className="ml-auto font-mono">{fmt(seconds)}</span>
        <button
          onClick={onClose}
          className="ml-2 rounded p-1 text-[#777] hover:bg-[#f3f3f0]"
          aria-label="關閉錄音面板"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <p className="text-sm text-[#74746f]">{status}</p>
        {recording && (
          <div className="mt-3 flex h-9 items-center gap-1 rounded bg-[#fafaf8] px-3">
            {levels.map((v, i) => (
              <span
                key={i}
                className="w-1 flex-1 rounded-full bg-[#917fff]"
                style={{ height: `${v}px` }}
              />
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {!recording && (
            <button
              onClick={onStart}
              className="rounded-md bg-[#2f2f2f] px-3 py-2 text-sm text-white"
            >
              <Mic className="mr-1 inline h-4 w-4" />
              {clips.length ? "新增錄音片段" : "開始錄音"}
            </button>
          )}
          {recording && (
            <>
              <button
                onClick={onPause}
                className="rounded-md border px-3 py-2 text-sm"
              >
                <Pause className="mr-1 inline h-4 w-4" />
                {paused ? "繼續" : "暫停"}
              </button>
              <button
                onClick={onStop}
                className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                <CircleStop className="mr-1 inline h-4 w-4" />
                停止並儲存
              </button>
            </>
          )}
          {selected && !recording && (
            <button
              disabled={transcribing}
              onClick={onTranscribe}
              className="rounded-md border border-[#715df2] px-3 py-2 text-sm text-[#604deb]"
            >
              <FileAudio className="mr-1 inline h-4 w-4" />
              {transcribing ? "轉錄中…" : "轉為逐字稿"}
            </button>
          )}
        </div>
        {clips.length > 0 && (
          <div className="mt-3 space-y-2">
            {clips.map((clip, index) => (
              <div
                key={clip.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectClip(clip)}
                className={`flex w-full items-center gap-3 rounded px-3 py-2 text-left text-xs ${selectedClipId === clip.id ? "bg-[#eeeaff] ring-1 ring-[#8a7bff]" : "bg-[#fafaf8]"}`}
              >
                <input value={clip.title} onClick={(event) => event.stopPropagation()} onChange={(event) => onRenameClip(clip.id, event.target.value)} className="w-20 min-w-0 border-0 bg-transparent text-xs font-medium outline-none" aria-label="錄音檔名稱" />
                <span className="whitespace-nowrap text-[#777]">{fmt(clip.duration)}</span>
                <audio controls className="h-7 flex-1" src={clip.url} />
                <button onClick={(event) => { event.stopPropagation(); onDeleteClip(clip.id); }} className="rounded p-1 text-[#888] hover:bg-white hover:text-red-600" aria-label={`刪除 ${clip.title}`}><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        )}
        {selected && <div className="mt-7 border-t border-[#eee] pt-4">
          <div className="flex gap-1 border-b border-[#eee] text-sm"><button onClick={() => onPanelTab("recording")} className={`px-2 py-2 ${panelTab === "recording" ? "border-b-2 border-[#715df2] text-[#604deb]" : "text-[#777]"}`}>錄音</button><button onClick={() => onPanelTab("transcript")} className={`px-2 py-2 ${panelTab === "transcript" ? "border-b-2 border-[#715df2] text-[#604deb]" : "text-[#777]"}`}>逐字稿</button><button onClick={() => onPanelTab("summary")} className={`px-2 py-2 ${panelTab === "summary" ? "border-b-2 border-[#715df2] text-[#604deb]" : "text-[#777]"}`}>AI 總結</button></div>
          {panelTab === "recording" && <p className="mt-4 text-sm text-[#777]">選擇「轉為逐字稿」後，會在這個片段內產生可編輯逐字稿。</p>}
          {panelTab === "transcript" && <div className="mt-4"><button disabled={!selected.transcript?.length || generating} onClick={onGenerate} className="mb-3 rounded-md bg-[#715df2] px-3 py-2 text-sm text-white disabled:opacity-40">{generating ? "生成中…" : "AI 生成會議紀錄"}</button>{selected.transcript?.length ? selected.transcript.map((item, index) => <p key={index} className="mb-2 rounded bg-[#fafaf8] p-3 text-sm leading-6"><b className="mr-2 text-[#715df2]">{fmt(item.start)}</b>{item.text}</p>) : <p className="py-6 text-sm text-[#999]">尚未產生逐字稿。</p>}</div>}
          {panelTab === "summary" && <div className="mt-4"><button disabled={!selected.transcript?.length || generating} onClick={onGenerate} className="mb-3 rounded-md bg-[#715df2] px-3 py-2 text-sm text-white disabled:opacity-40">{generating ? "生成中…" : "AI 生成會議紀錄"}</button>{selected.summary ? <p className="whitespace-pre-wrap text-sm leading-7">{selected.summary}</p> : <p className="py-6 text-sm text-[#999]">尚未產生 AI 會議紀錄。</p>}</div>}
        </div>
        }
      </div>
    </aside>
  );
}
function Tab({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`border-b-2 px-3 py-2 text-sm ${active ? "border-[#715df2] text-[#604deb]" : "border-transparent text-[#777]"} disabled:opacity-40`}
    >
      {label}
    </button>
  );
}
function Toolbar({
  onImage,
  onTable,
  onInsert,
}: {
  onImage: () => void;
  onTable: () => void;
  onInsert: (html: string) => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      <div className="flex rounded-md border border-[#e5e5df] bg-[#fafaf9] p-1">
        {[
          ["H1", "<h1>標題</h1><p><br></p>"],
          ["H2", "<h2>小標題</h2><p><br></p>"],
          ["H3", "<h3>小標題</h3><p><br></p>"],
          ["H4", "<h4>小標題</h4><p><br></p>"],
          ["待辦", "<p>☐ 待辦事項</p>"],
          ["引用", "<blockquote>引用內容</blockquote><p><br></p>"],
        ].map(([label, html]) => (
          <button
            key={label}
            onClick={() => onInsert(html)}
            className="px-2 py-1 text-xs"
          >
            {label}
          </button>
        ))}
        <button onClick={onTable} className="px-2 py-1 text-xs">
          表格
        </button>
      </div>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={onImage}
        className="rounded-md border border-[#e5e5df] px-2.5 py-1.5 text-xs"
      >
        <ImagePlus className="mr-1 inline h-3.5 w-3.5" />
        圖片
      </button>
    </div>
  );
}
function Transcript({
  segments,
  onChange,
}: {
  segments: Segment[];
  onChange: (index: number, text: string) => void;
}) {
  return (
    <section className="py-6">
      <div className="mb-4 flex items-end justify-between">
        <h2 className="text-xl font-semibold">逐字稿</h2>
        <p className="text-xs text-[#999]">
          可直接修改內容；變更後會用於下一次 AI 總結。
        </p>
      </div>
      {segments.length ? (
        <div className="space-y-3">
          {segments.map((item, i) => (
            <article
              key={`${item.start}-${i}`}
              className="flex gap-4 rounded-lg bg-[#fafaf9] p-4"
            >
              <span className="font-mono text-sm text-[#715df2]">
                {fmt(item.start)}
              </span>
              <div className="min-w-0 flex-1">
                <b className="text-sm">{item.speaker}</b>
                <textarea
                  value={item.text}
                  onChange={(event) => onChange(i, event.target.value)}
                  className="mt-1 min-h-16 w-full resize-y bg-transparent leading-7 text-[#555] outline-none"
                  aria-label={`${item.speaker} 的逐字稿`}
                />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="尚未產生逐字稿"
          description="完成一段錄音後，選擇「轉錄最新片段」即可在這裡查看與修正內容。"
        />
      )}
    </section>
  );
}
function Summary({
  value,
  generating,
  onChange,
  onGenerate,
}: {
  value: string;
  generating: boolean;
  onChange: (value: string) => void;
  onGenerate: () => void;
}) {
  return (
    <section className="py-6">
      <div className="mb-4 flex justify-between">
        <h2 className="text-xl font-semibold">會議總結</h2>
        <button
          disabled={generating}
          onClick={onGenerate}
          className="rounded-md bg-[#715df2] px-3 py-2 text-sm text-white"
        >
          <Sparkles className="mr-1 inline h-4 w-4" />
          {generating ? "生成中…" : "重新生成"}
        </button>
      </div>
      {value ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[480px] w-full resize-y border-0 leading-7 outline-none"
        />
      ) : (
        <EmptyState
          title="尚未產生 AI 總結"
          description="完成逐字稿後，AI 會只整理真正出現的重點；若沒有重點，這個頁面會維持空白。"
        />
      )}
    </section>
  );
}
function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="grid min-h-[360px] place-items-center text-center">
      <div>
        <Sparkles className="mx-auto mb-3 h-6 w-6 text-[#a99cff]" />
        <h3 className="font-medium">{title}</h3>
        <p className="mt-2 max-w-sm text-sm leading-6 text-[#888]">
          {description}
        </p>
      </div>
    </div>
  );
}
function BlockMenu({
  kind,
  point,
  onInsert,
  onTable,
  onImage,
  onOCR,
}: {
  kind: Menu;
  point: { x: number; y: number };
  onInsert: (html: string) => void;
  onTable: () => void;
  onImage: () => void;
  onOCR: () => void;
}) {
  const item = (label: string, click: () => void) => (
    <button
      key={label}
      onClick={click}
      className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-[#f4f3ff]"
    >
      {label}
    </button>
  );
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{ left: point.x, top: point.y }}
      className="fixed z-50 w-56 rounded-lg border border-[#deded8] bg-white p-2 shadow-xl"
    >
      {kind === "insert" && (
        <>
          <p className="px-2 text-xs text-[#888]">新增區塊</p>
          {item("文字", () => onInsert("<p>文字</p>"))}
          {item("標題 1", () => onInsert("<h1>標題</h1><p><br></p>"))}
          {item("標題 2", () => onInsert("<h2>標題</h2><p><br></p>"))}
          {item("標題 3", () => onInsert("<h3>標題</h3><p><br></p>"))}
          {item("標題 4", () => onInsert("<h4>標題</h4><p><br></p>"))}
          {item("項目符號清單", () =>
            onInsert("<ul><li>清單項目</li></ul><p><br></p>"),
          )}
          {item("編號清單", () =>
            onInsert("<ol><li>清單項目</li></ol><p><br></p>"),
          )}
          {item("待辦清單", () => onInsert("<p>☐ 待辦事項</p>"))}
          {item("引用", () => onInsert("<blockquote>引用內容</blockquote>"))}
          {item("表格", onTable)}
          {item("圖片", onImage)}
        </>
      )}
      {kind === "block" && (
        <>
          <p className="px-2 text-xs text-[#888]">區塊操作</p>
          {item("轉換為標題", () =>
            document.execCommand("formatBlock", false, "h2"),
          )}
          {item("轉換為標題 3", () =>
            document.execCommand("formatBlock", false, "h3"),
          )}
          {item("轉換為標題 4", () =>
            document.execCommand("formatBlock", false, "h4"),
          )}
          {item("轉換為待辦", () => onInsert("<p>☐ 待辦事項</p>"))}
          {item("複製目前區塊", () => document.execCommand("copy"))}
        </>
      )}
      {kind === "image" && item("✨ AI 轉換為文字", onOCR)}
    </div>
  );
}
function htmlFromText(text: string) {
  const esc = (v: string) =>
    v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const out: string[] = [];
  let list = "";
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = "";
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      close();
      continue;
    }
    const bullet = /^[-•●]\s+(.+)/.exec(line),
      order = /^\d+[.)、]\s+(.+)/.exec(line);
    if (bullet || order) {
      const tag = bullet ? "ul" : "ol";
      if (list !== tag) {
        close();
        list = tag;
        out.push(`<${tag}>`);
      }
      out.push(`<li>${esc((bullet || order)![1])}</li>`);
    } else {
      close();
      if (/^#{1,4}\s/.test(line)) {
        const level = Math.min(4, line.match(/^#+/)![0].length);
        out.push(`<h${level}>${esc(line.replace(/^#+\s*/, ""))}</h${level}>`);
      } else if (line.length < 32 && !/[，。；：,.]/.test(line))
        out.push(`<h2>${esc(line)}</h2>`);
      else out.push(`<p>${esc(line)}</p>`);
    }
  }
  close();
  return out.join("");
}
