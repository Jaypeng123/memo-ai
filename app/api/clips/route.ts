import { auth } from "@clerk/nextjs/server";
import { del } from "@vercel/blob";
import { ensureWorkspaceSchema, sql } from "@/lib/database";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as { id: string; noteId: string; blobUrl: string; duration: number };
  if (!body.id || !body.noteId || !body.blobUrl) return Response.json({ error: "缺少錄音資料" }, { status: 400 });
  await ensureWorkspaceSchema();
  const ownerNote = (await sql()`SELECT id FROM memo_notes WHERE id = ${body.noteId}::uuid AND user_id = ${userId} LIMIT 1`) as unknown as { id: string }[];
  if (!ownerNote.length) return Response.json({ error: "找不到所屬筆記" }, { status: 404 });
  await sql()`INSERT INTO memo_clips (id, user_id, note_id, blob_url, duration)
    VALUES (${body.id}::uuid, ${userId}, ${body.noteId}::uuid, ${body.blobUrl}, ${Math.max(0, Math.floor(body.duration || 0))})
    ON CONFLICT (id) DO NOTHING`;
  return Response.json({ ok: true });
}

export async function PUT(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as { id: string; transcript?: unknown; summary?: string };
  if (!body.id) return Response.json({ error: "缺少錄音片段" }, { status: 400 });
  await ensureWorkspaceSchema();
  await sql()`UPDATE memo_clips SET transcript = ${JSON.stringify(body.transcript || [])}::jsonb,
    summary = ${body.summary || ""}, updated_at = now() WHERE id = ${body.id}::uuid AND user_id = ${userId}`;
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await request.json() as { id?: string };
  if (!id) return Response.json({ error: "缺少錄音片段" }, { status: 400 });
  await ensureWorkspaceSchema();
  const rows = (await sql()`SELECT blob_url FROM memo_clips WHERE id = ${id}::uuid AND user_id = ${userId}`) as unknown as { blob_url: string }[];
  if (rows[0]?.blob_url) await del(rows[0].blob_url, { token: process.env.MEMO_FILES_READ_WRITE_TOKEN });
  await sql()`DELETE FROM memo_clips WHERE id = ${id}::uuid AND user_id = ${userId}`;
  return Response.json({ ok: true });
}
