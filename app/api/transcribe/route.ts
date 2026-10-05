import { auth } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { ensureWorkspaceSchema, sql } from "@/lib/database";

type Segment = { start?: number; end?: number; speaker?: string; text?: string };
type OutputSegment = { start: number; end: number; speaker: string; text: string };
const execFileAsync = promisify(execFile);
const SINGLE_REQUEST_LIMIT = 25 * 1024 * 1024;
const CHUNK_SECONDS = 600;

// Long media needs time for audio extraction and sequential transcription.
export const maxDuration = 300;

async function transcribeFile(file: File, apiKey: string): Promise<OutputSegment[]> {
  const body = new FormData();
  body.append("file", file, file.name || "recording.mp3");
  body.append("model", process.env.OPENAI_DIARIZATION_MODEL || "gpt-4o-transcribe-diarize");
  body.append("response_format", "diarized_json");
  body.append("chunking_strategy", "auto");
  let diarized = true;
  let response = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body });
  if (!response.ok) {
    diarized = false;
    const fallback = new FormData();
    fallback.append("file", file, file.name || "recording.mp3");
    fallback.append("model", process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-transcribe");
    fallback.append("response_format", "json");
    response = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: fallback });
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("OpenAI transcription failed", response.status, detail.slice(0, 500));
    throw new Error("轉錄服務暫時無法處理此檔案，請確認檔案包含可辨識的音軌。");
  }
  const data = (await response.json()) as { segments?: Segment[]; text?: string };
  const segments = (data.segments || []).map((segment) => ({ start: segment.start ?? 0, end: segment.end ?? 0, speaker: segment.speaker || "說話者 1", text: segment.text || "" }));
  return (segments.length ? segments : data.text?.trim() ? [{ start: 0, end: 0, speaker: diarized ? "說話者" : "說話者 1", text: data.text }] : []).filter((segment) => segment.text.trim().length > 0);
}

async function splitAndTranscribe(inputPath: string, originalName: string, apiKey: string): Promise<OutputSegment[]> {
  if (!ffmpegPath) throw new Error("大型媒體處理服務暫時不可用，請稍後再試。");
  const workdir = await mkdtemp(join(tmpdir(), "memo-transcribe-"));
  const listPath = join(workdir, "segments.csv");
  const outputPattern = join(workdir, "part-%03d.mp3");
  try {
    await execFileAsync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-i", inputPath, "-map", "0:a:0", "-vn", "-c:a", "libmp3lame", "-b:a", "64k", "-f", "segment", "-segment_time", String(CHUNK_SECONDS), "-reset_timestamps", "1", "-segment_list", listPath, "-segment_list_type", "csv", outputPattern], { maxBuffer: 1024 * 1024 });
    const rows = (await readFile(listPath, "utf8")).trim().split("\n").filter(Boolean).map((line) => {
      const [filename, start = "0"] = line.split(",");
      return { filename: filename.replaceAll('"', ""), start: Number(start) };
    });
    if (!rows.length) throw new Error("找不到可轉錄的音軌。");
    const combined: OutputSegment[] = [];
    for (const row of rows) {
      const bytes = await readFile(join(workdir, basename(row.filename)));
      const chunk = new File([bytes], `${originalName.replace(/\.[^.]+$/, "")}-${Math.round(row.start)}.mp3`, { type: "audio/mpeg" });
      const transcript = await transcribeFile(chunk, apiKey);
      combined.push(...transcript.map((segment) => ({ ...segment, start: segment.start + row.start, end: segment.end + row.start })));
    }
    return combined;
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "轉錄服務尚未設定。" }, { status: 503 });
  try {
    const { clipId } = (await request.json()) as { clipId?: string };
    if (!clipId) return Response.json({ error: "找不到錄音檔。" }, { status: 400 });
    await ensureWorkspaceSchema();
    const rows = (await sql()`SELECT blob_url FROM memo_clips WHERE id = ${clipId}::uuid AND user_id = ${userId} LIMIT 1`) as unknown as { blob_url?: string }[];
    if (!rows[0]?.blob_url) return Response.json({ error: "錄音尚未完成雲端同步，請按「重試」後再轉為逐字稿。" }, { status: 409 });
    const stored = await get(rows[0].blob_url, { access: "private", token: process.env.MEMO_FILES_READ_WRITE_TOKEN });
    if (!stored?.stream || !stored.blob.size) return Response.json({ error: "找不到雲端錄音檔。" }, { status: 404 });
    const name = stored.blob.pathname.split("/").at(-1) || "recording.webm";
    let transcript: OutputSegment[];
    if (stored.blob.size <= SINGLE_REQUEST_LIMIT) {
      const audioBlob = await new Response(stored.stream).blob();
      transcript = await transcribeFile(new File([audioBlob], name, { type: stored.blob.contentType || "audio/webm" }), apiKey);
    } else {
      const workdir = await mkdtemp(join(tmpdir(), "memo-source-"));
      const inputPath = join(workdir, basename(name));
      try {
        await pipeline(Readable.fromWeb(stored.stream as never), createWriteStream(inputPath));
        transcript = await splitAndTranscribe(inputPath, name, apiKey);
      } finally {
        await rm(workdir, { recursive: true, force: true });
      }
    }
    return Response.json({ text: transcript.map((segment) => segment.text).join("\n"), transcript });
  } catch (error) {
    console.error("Transcription request failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "轉錄失敗，請稍後重試。" }, { status: 500 });
  }
}
