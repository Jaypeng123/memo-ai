const system = `你是 Memo AI 的會議紀錄助手。請依據逐字稿產生繁體中文、可直接編輯的會議紀錄。輸出必須使用 Markdown，包含：摘要、重點、決策、行動項目（負責人／截止日／來源時間戳）、待釐清問題、下一步。不要捏造逐字稿沒有提到的事實；所有決策與行動項目請附來源時間戳。`;

export async function POST(request: Request) {
  const { transcript, template = "會議紀錄" } = await request.json();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "尚未設定 OPENAI_API_KEY。請在網站的伺服器環境變數中設定後再試。" }, { status: 503 });
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-6-astra",
      instructions: system,
      input: `筆記模板：${template}\n\n逐字稿：\n${transcript}`
    })
  });
  if (!response.ok) return Response.json({ error: "AI 產生失敗，請稍後再試。" }, { status: response.status });
  const data = await response.json();
  return Response.json({ notes: data.output_text ?? "AI 沒有回傳筆記內容。" });
}
