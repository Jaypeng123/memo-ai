type Segment = { start?: number; end?: number; speaker?: string; text?: string };

async function improveTranscript(segments: Required<Segment>[], apiKey: string) {
  if (!segments.length) return segments;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "你是專業逐字稿校對員。請校正繁體中文、英文、專有名詞、斷句與標點，使語意通暢；絕不可增加、刪除或臆測錄音沒有說過的內容。保留每段的 start、end、speaker，且不要合併或改變說話者。輸出 JSON：{\"segments\":[{\"start\":number,\"end\":number,\"speaker\":string,\"text\":string}]}。" },
        { role: "user", content: JSON.stringify({ segments }) },
      ],
    }),
  });
  if (!response.ok) return segments;
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  try {
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}") as { segments?: Required<Segment>[] };
    return Array.isArray(parsed.segments) && parsed.segments.length === segments.length ? parsed.segments : segments;
  } catch { return segments; }
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "轉錄服務尚未設定。" }, { status: 503 });
  const incoming = await request.formData();
  const audio = incoming.get("audio");
  const mode = incoming.get("mode") === "diarize" ? "diarize" : "accurate";
  const vocabulary = typeof incoming.get("vocabulary") === "string" ? String(incoming.get("vocabulary")).slice(0, 1200) : "";
  if (!(audio instanceof File)) return Response.json({ error: "找不到錄音檔。" }, { status: 400 });
  const body = new FormData();
  body.append("file", audio, audio.name || "recording.webm");
  body.append("model", mode === "diarize" ? (process.env.OPENAI_DIARIZATION_MODEL || "gpt-4o-transcribe-diarize") : (process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-transcribe"));
  if (mode === "diarize") {
    body.append("response_format", "diarized_json");
    body.append("chunking_strategy", "auto");
  } else {
    body.append("response_format", "json");
    body.append("language", "zh");
    body.append("prompt", `這是一段台灣繁體中文為主、可能夾雜英文縮寫與產品名稱的錄音。請保留英文專有名詞與縮寫，正確斷句。${vocabulary ? `本次已知詞彙：${vocabulary}` : ""}`);
  }
  const result = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body,
  });
  if (!result.ok) return Response.json({ error: "轉錄失敗，請確認音檔格式與 API 設定。" }, { status: result.status });
  const data = (await result.json()) as { segments?: Segment[]; text?: string };
  const rawTranscript = (data.segments || []).map((s: Segment) => ({
    start: s.start ?? 0, end: s.end ?? 0, speaker: s.speaker || "說話者 1", text: s.text || "",
  }));
  const fallback = data.text ? [{ start: 0, end: 0, speaker: "說話者", text: data.text }] : [];
  const transcript = await improveTranscript(rawTranscript.length ? rawTranscript : fallback, apiKey);
  return Response.json({ text: transcript.map((segment) => segment.text).join("\n") || data.text || "", transcript });
}
