export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "圖片文字辨識服務尚未設定。請在 Vercel 專案的 Environment Variables 新增 OPENAI_API_KEY，然後重新部署。" }, { status: 503 });
  }

  const form = await request.formData();
  const image = form.get("image");
  if (!(image instanceof File)) return Response.json({ error: "找不到圖片檔。" }, { status: 400 });
  if (!image.type.startsWith("image/")) return Response.json({ error: "請上傳圖片格式的檔案。" }, { status: 400 });

  const bytes = Buffer.from(await image.arrayBuffer());
  const dataUrl = `data:${image.type};base64,${bytes.toString("base64")}`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_OCR_MODEL ?? "gpt-4.1-mini",
      instructions: "你是精準 OCR 助手。只轉寫圖片中可辨識的文字，保留原本段落、清單與表格的閱讀順序。不要摘要、翻譯、補字、猜測或加入任何說明。使用繁體中文輸出（除非原文是其他語言）。",
      input: [{ role: "user", content: [{ type: "input_text", text: "請將這張圖片轉成可編輯的純文字。" }, { type: "input_image", image_url: dataUrl }] }],
    }),
  });

  if (!response.ok) return Response.json({ error: "圖片文字辨識失敗，請確認 OpenAI API 設定與圖片格式。" }, { status: response.status });
  const data = await response.json() as { output_text?: string };
  return Response.json({ text: data.output_text ?? "" });
}
