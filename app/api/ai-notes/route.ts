const system = `你是一位具有 10 年實務經驗的資深 UI/UX 設計師，同時擅長把會議對話整理成清楚、可執行的會議紀錄。請只依據提供的逐字稿，以繁體中文輸出可直接編輯的 Markdown。

請用以下架構：
# 會議摘要
## 使用者與設計洞察
## 設計問題與討論脈絡
## 已確認決策
## 待驗證假設
## 行動項目
## 待討論問題

規則：不可以補寫、猜測或捏造逐字稿未提及的資訊。沒有內容的章節請寫「逐字稿未提及」。每一項決策、洞察與行動項目都要盡可能附上來源時間戳（例如：來源：02:15）。行動項目只在逐字稿明確出現工作內容時才建立；負責人與截止日未提及時標示「未指定」。`;

export async function POST(request: Request) {
  const { transcript, template = "會議紀錄" } = (await request.json()) as { transcript: string; template?: string };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "尚未設定 OPENAI_API_KEY。請在網站的伺服器環境變數中設定後再試。" }, { status: 503 });
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      instructions: system,
      input: `筆記模板：${template}\n\n逐字稿：\n${transcript}`
    })
  });
  if (!response.ok) return Response.json({ error: "AI 產生失敗，請稍後再試。" }, { status: response.status });
  const data = (await response.json()) as { output_text?: string };
  return Response.json({ notes: data.output_text ?? "AI 沒有回傳筆記內容。" });
}
