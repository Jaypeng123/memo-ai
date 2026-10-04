import { auth } from "@clerk/nextjs/server";
import { ensureWorkspaceSchema, sql } from "@/lib/database";

type FolderInput = { id: string; name: string };
type NoteInput = {
  id: string;
  title: string;
  emoji?: string;
  folderId?: string;
  contentHtml?: string;
  editedAt?: string;
};

export const runtime = "nodejs";

async function user() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  await ensureWorkspaceSchema();
  return userId;
}

export async function GET() {
  try {
    const userId = await user();
    const db = sql();
    const [folders, notes, clips] = await Promise.all([
      db`SELECT id, name FROM memo_folders WHERE user_id = ${userId} ORDER BY created_at ASC`,
      db`SELECT id, title, emoji, folder_id AS "folderId", content_html AS "contentHtml", updated_at AS "editedAt"
         FROM memo_notes WHERE user_id = ${userId} ORDER BY updated_at DESC`,
      db`SELECT id, note_id AS "noteId", duration, transcript, summary, created_at AS "createdAt"
         FROM memo_clips WHERE user_id = ${userId} ORDER BY created_at ASC`,
    ]);
    return Response.json({ folders, notes, clips });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "載入失敗" }, { status: 401 });
  }
}

/** Snapshot persistence keeps client interactions fast while every row remains scoped to the Clerk user. */
export async function PUT(request: Request) {
  try {
    const userId = await user();
    const body = (await request.json()) as { folders?: FolderInput[]; notes?: NoteInput[] };
    const folders = body.folders ?? [];
    const notes = body.notes ?? [];
    const db = sql();
    // Delete children before folders, then restore the complete client snapshot.
    // Each query is scoped to the authenticated Clerk user.
    await db`DELETE FROM memo_notes WHERE user_id = ${userId}`;
    await db`DELETE FROM memo_folders WHERE user_id = ${userId}`;
    for (const folder of folders) {
      await db`INSERT INTO memo_folders (id, user_id, name) VALUES (${folder.id}::uuid, ${userId}, ${folder.name})`;
    }
    for (const note of notes) {
      await db`INSERT INTO memo_notes (id, user_id, folder_id, title, emoji, content_html, updated_at)
        VALUES (${note.id}::uuid, ${userId}, ${note.folderId || null}::uuid, ${note.title || "未命名筆記"}, ${note.emoji || "📄"}, ${note.contentHtml || ""}, ${note.editedAt || new Date().toISOString()}::timestamptz)`;
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "儲存失敗" }, { status: 401 });
  }
}
