import convert from "heic-convert";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const image = form.get("image");
  if (!(image instanceof File)) return Response.json({ error: "找不到圖片檔。" }, { status: 400 });
  const isHeic = image.type === "image/heic" || image.type === "image/heif" || /\.hei[cf]$/i.test(image.name);
  if (!isHeic) return Response.json({ error: "此格式不需要轉檔。" }, { status: 400 });
  try {
    const jpeg = Buffer.from(await convert({ buffer: Buffer.from(await image.arrayBuffer()), format: "JPEG", quality: 0.9 }));
    return Response.json({ dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}` });
  } catch {
    return Response.json({ error: "無法轉換這張 HEIC 圖片。" }, { status: 422 });
  }
}
