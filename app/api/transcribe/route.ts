import { auth } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import { ensureWorkspaceSchema, sql } from "@/lib/database";

type Segment = { start?: number; end?: number; speaker?: string; text?: string };

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "轉錄服務尚未設定。" }, { status: 503 });
  let audio: File;
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const { clipId } = (await request.json()) as { clipId?: string };
    if (!clipId) return Response.json({ error: "找不到錄音檔。" }, { status: 400 });
    await ensureWorkspaceSchema();
    const rows = (await sql()`SELECT blob_url FROM memo_clips WHERE id = ${clipId}::uuid AND user_id = ${userId} LIMIT 1`) as unknown as { blob_url?: string }[];
    if (!rows[0]?.blob_url) return Response.json({ error: "錄音尚未完成雲端同步，請稍候或按重試。" }, { status: 409 });
    const stored = await get(rows[0].blob_url, { access: "private", token: process.env.MEMO_FILES_READ_WRITE_TOKEN });
    if (!stored?.stream || !stored.blob.size) return Response.json({ error: "找不到雲端錄音檔。" }, { status: 404 });
    if (stored.blob.size > 25 * 1024 * 1024) return Response.json({ error: "音訊或影片超過轉錄服務 25MB 上限。請先裁切或壓縮後再試。" }, { status: 413 });
    const blob = await new Response(stored.stream).blob();
    audio = new File([blob], stored.blob.pathname.split("/").at(-1) || "recording.webm", { type: stored.blob.contentType || "audio/webm" });
  } else {
    const incoming = await request.formData();
    const incomingAudio = incoming.get("audio");
    if (!(incomingAudio instanceof File)) return Response.json({ error: "找不到錄音檔。" }, { status: 400 });
    if (incomingAudio.size > 25 * 1024 * 1024) return Response.json({ error: "音訊或影片超過轉錄服務 25MB 上限。請先裁切或壓縮後再試。" }, { status: 413 });
    audio = incomingAudio;
  }
  const body = new FormData();
  body.append("file", audio, audio.name || "recording.webm");
  // Do not supply a prose "hint" to the transcription endpoint.  For a very
  // short or silent recording some models can echo that hint, which looks like
  // a fabricated transcript.  Diarized JSON is the source of truth here: no
  // second LLM is allowed to rewrite or invent spoken content afterwards.
  body.append("model", process.env.OPENAI_DIARIZATION_MODEL || "gpt-4o-transcribe-diarize");
  body.append("response_format", "diarized_json");
  body.append("chunking_strategy", "auto");
  let usedDiarization = true;
  let result = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body,
  });
  // Keep the product usable for accounts that do not yet have access to the
  // diarization model. The fallback is still raw ASR (never generative text),
  // but labels it honestly as one speaker rather than pretending diarization.
  if (!result.ok) {
    usedDiarization = false;
    const fallback = new FormData();
    fallback.append("file", audio, audio.name || "recording.webm");
    fallback.append("model", process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-transcribe");
    fallback.append("response_format", "json");
    result = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: fallback,
    });
  }
  if (!result.ok) {
    const detail = await result.text().catch(() => "");
    console.error("OpenAI transcription failed", result.status, detail.slice(0, 500));
    return Response.json({ error: "轉錄失敗，請確認音檔格式與 API 設定。" }, { status: result.status });
  }
  const data = (await result.json()) as { segments?: Segment[]; text?: string };
  const rawTranscript = (data.segments || []).map((s: Segment) => ({
    start: s.start ?? 0, end: s.end ?? 0, speaker: s.speaker || "說話者 1", text: s.text || "",
  }));
  const transcript = (rawTranscript.length
    ? rawTranscript
    : data.text?.trim()
      ? [{ start: 0, end: 0, speaker: usedDiarization ? "說話者" : "說話者 1", text: data.text }]
      : []
  ).filter((segment) => segment.text.trim().length > 0);
  // An empty response is an honest result for silence/very short clips. It is
  // intentionally not replaced with a guessed sentence or with our prompt.
  return Response.json({ text: transcript.map((segment) => segment.text).join("\n"), transcript });
}
