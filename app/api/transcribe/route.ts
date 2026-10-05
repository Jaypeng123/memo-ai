import { auth } from "@clerk/nextjs/server";

type Segment = { start?: number; end?: number; speaker?: string; text?: string };

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "轉錄服務尚未設定。" }, { status: 503 });
  const incoming = await request.formData();
  const audio = incoming.get("audio");
  if (!(audio instanceof File)) return Response.json({ error: "找不到錄音檔。" }, { status: 400 });
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
