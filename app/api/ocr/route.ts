import convert from "heic-convert";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "圖片文字辨識服務尚未設定。請在 Vercel 專案的 Environment Variables 新增 OPENAI_API_KEY，然後重新部署。" }, { status: 503 });
  }

  const form = await request.formData();
  const image = form.get("image");
  if (!(image instanceof File)) return Response.json({ error: "找不到圖片檔。" }, { status: 400 });
  const isHeic = image.type === "image/heic" || image.type === "image/heif" || /\.hei[cf]$/i.test(image.name);
  if (!image.type.startsWith("image/") && !isHeic) return Response.json({ error: "請上傳圖片格式的檔案。" }, { status: 400 });

  let bytes = Buffer.from(await image.arrayBuffer());
  let mimeType = image.type || "image/jpeg";
  if (isHeic) {
    try {
      bytes = Buffer.from(await convert({ buffer: bytes, format: "JPEG", quality: 0.9 }));
      mimeType = "image/jpeg";
    } catch {
      return Response.json({ error: "無法讀取這張 HEIC 圖片。請改用 JPEG 或 PNG 後再試。" }, { status: 422 });
    }
  }
  const dataUrl = `data:${mimeType};base64,${bytes.toString("base64")}`;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_OCR_MODEL ?? "gpt-4.1-mini",
      temperature: 0,
      max_tokens: 4000,
      messages: [
        { role: "system", content: "你是精準 OCR 助手。只轉寫圖片中可辨識的文字，保留原本段落、標題層級、相對文字大小與清單閱讀順序。以 Markdown 表達層級：最大標題用 #、次標題用 ##、依視覺比例最多用到 ####；清單保留 - 或 1.。不要摘要、翻譯、補字、猜測或加入任何說明。使用繁體中文輸出（除非原文是其他語言）。" },
        { role: "user", content: [{ type: "text", text: "請將這張圖片轉成可編輯文字，依圖片中文字的相對大小輸出正確 Markdown 標題層級。" }, { type: "image_url", image_url: { url: dataUrl } }] },
      ],
    }),
  });

  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    return Response.json({ error: failure?.error?.message || "圖片文字辨識失敗，請確認 OpenAI API 設定與圖片格式。" }, { status: response.status });
  }
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) return Response.json({ error: "AI 沒有回傳可辨識文字。請確認圖片清晰後重試。" }, { status: 422 });
  return Response.json({ text });
}
