import { auth } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import { ensureWorkspaceSchema, sql } from "@/lib/database";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  await ensureWorkspaceSchema();
  const rows = (await sql()`SELECT blob_url FROM memo_clips WHERE id = ${id}::uuid AND user_id = ${userId} LIMIT 1`) as unknown as { blob_url?: string }[];
  const clip = rows[0] as { blob_url?: string } | undefined;
  if (!clip?.blob_url) return new Response("Not found", { status: 404 });
  const file = await get(clip.blob_url, { access: "private", token: process.env.MEMO_FILES_READ_WRITE_TOKEN });
  if (!file?.stream) return new Response("Not found", { status: 404 });
  return new Response(file.stream, { headers: { "Content-Type": file.blob.contentType || "audio/webm", "Cache-Control": "private, max-age=60" } });
}
