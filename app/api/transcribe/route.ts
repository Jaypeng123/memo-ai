type Segment = { start?: number; end?: number; speaker?: string; text?: string };

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "轉錄服務尚未設定。" }, { status: 503 });
  const incoming = await request.formData();
  const audio = incoming.get("audio");
  if (!(audio instanceof File)) return Response.json({ error: "找不到錄音檔。" }, { status: 400 });
  const body = new FormData();
  body.append("file", audio, audio.name || "recording.webm");
  body.append("model", process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-transcribe-diarize");
  body.append("response_format", "diarized_json");
  body.append("chunking_strategy", "auto");
  const result = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body,
  });
  if (!result.ok) return Response.json({ error: "轉錄失敗，請確認音檔格式與 API 設定。" }, { status: result.status });
  const data = (await result.json()) as { segments?: Segment[]; text?: string };
  const transcript = (data.segments || []).map((s: Segment) => ({
    start: s.start ?? 0, end: s.end ?? 0, speaker: s.speaker || "說話者 1", text: s.text || "",
  }));
  return Response.json({ text: data.text || "", transcript });
}
