const system = `你是一位具有 10 年實務經驗的資深 UI/UX 設計師，同時擅長把會議對話整理成清楚、可執行的會議紀錄。請只依據提供的逐字稿，以繁體中文輸出可直接編輯的 Markdown。

先判斷逐字稿是否存在值得保留的會議重點，例如：結論、決策、待辦、使用者洞察、具體問題、風險、下一步或重要事實。若沒有任何實質重點，或內容不足以做出可靠整理，請只輸出 __EMPTY__，不要輸出標題、模板、推測或「逐字稿未提及」。

若有重點，只建立逐字稿實際提及的區塊；不可使用固定模板，不可補齊空白章節。每個區塊用貼近內容的自然標題，例如「已確認方向」、「使用者回饋」或「後續工作」。必須先理解語意再重新組織，將口語贅詞、重複與不完整句整理為清楚自然的書面繁體中文；英文產品名稱、縮寫與專有名詞要依語境校正，不可逐字照抄或改變意思。每一項決策、洞察與行動項目盡可能附來源時間戳（例如：來源：02:15）。不可以補寫、猜測或捏造資訊。`;

export async function POST(request: Request) {
  const { transcript, template = "會議紀錄" } = (await request.json()) as { transcript: string; template?: string };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "尚未設定 OPENAI_API_KEY。請在網站的伺服器環境變數中設定後再試。" }, { status: 503 });
  }
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `筆記模板：${template}\n\n逐字稿：\n${transcript}` },
      ],
    })
  });
  if (!response.ok) return Response.json({ error: "AI 產生失敗，請稍後再試。" }, { status: response.status });
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const notes = data.choices?.[0]?.message?.content?.trim();
  if (!notes) return Response.json({ error: "AI 沒有回傳筆記內容。" }, { status: 422 });
  if (notes === "__EMPTY__") return Response.json({ empty: true, notes: "" });
  return Response.json({ empty: false, notes });
}
