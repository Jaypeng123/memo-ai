import { auth } from "@clerk/nextjs/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await request.json()) as HandleUploadBody;
    const jsonResponse = await handleUpload({
      body,
      request,
      token: process.env.MEMO_FILES_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname) => ({
        allowedContentTypes: ["image/*", "audio/*", "video/mp4", "video/webm", "video/quicktime", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
        // Uploads go direct to Blob. Files over OpenAI's 25MB single-request
        // limit are split into audio chunks by /api/transcribe.
        maximumSizeInBytes: 250 * 1024 * 1024,
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ userId, pathname }),
      }),
    });
    return Response.json(jsonResponse);
  } catch (error) {
    // Blob's client protocol expects JSON. Always return JSON even if a proxy
    // or malformed request reaches this route, so callers never attempt to
    // parse a plain-text error page as JSON.
    return Response.json({ error: error instanceof Error ? error.message : "上傳設定失敗" }, { status: 400 });
  }
}
