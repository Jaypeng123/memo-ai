import { neon } from "@neondatabase/serverless";

let client: ReturnType<typeof neon> | null = null;

export function sql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL 尚未設定");
  if (!client) client = neon(connectionString);
  return client;
}

let schemaPromise: Promise<void> | null = null;

/** Creates the small per-user workspace schema on first use. Safe to call repeatedly. */
export function ensureWorkspaceSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = sql();
      await db`CREATE TABLE IF NOT EXISTS memo_folders (
        id uuid PRIMARY KEY,
        user_id text NOT NULL,
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
      await db`CREATE TABLE IF NOT EXISTS memo_notes (
        id uuid PRIMARY KEY,
        user_id text NOT NULL,
        folder_id uuid REFERENCES memo_folders(id) ON DELETE SET NULL,
        title text NOT NULL,
        emoji text NOT NULL DEFAULT '📄',
        content_html text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
      await db`CREATE INDEX IF NOT EXISTS memo_notes_user_updated_idx ON memo_notes (user_id, updated_at DESC)`;
      await db`CREATE INDEX IF NOT EXISTS memo_folders_user_idx ON memo_folders (user_id)`;
      await db`CREATE TABLE IF NOT EXISTS memo_clips (
        id uuid PRIMARY KEY,
        user_id text NOT NULL,
        note_id uuid NOT NULL,
        blob_url text NOT NULL,
        duration integer NOT NULL DEFAULT 0,
        transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
        summary text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
      await db`CREATE INDEX IF NOT EXISTS memo_clips_note_idx ON memo_clips (user_id, note_id, created_at ASC)`;
    })();
  }
  return schemaPromise;
}
