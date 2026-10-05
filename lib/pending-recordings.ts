/**
 * Local-first recording queue.
 *
 * MediaRecorder blobs must never live only in React state: a refresh, a
 * temporary Blob outage, or an API retry must not discard a user's meeting.
 * IndexedDB is deliberately used instead of localStorage because recordings
 * can be large binary files.
 */
export type PendingRecording = {
  id: string;
  noteId: string;
  blob: Blob;
  duration: number;
  createdAt: string;
};

const DB_NAME = "memo-ai-recordings";
const STORE = "pending-recordings";

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("無法開啟本機錄音保存空間"));
  });
}

export async function savePendingRecording(recording: PendingRecording) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(recording);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("本機錄音保存失敗"));
  });
  db.close();
}

export async function pendingRecordings(): Promise<PendingRecording[]> {
  const db = await database();
  const result = await new Promise<PendingRecording[]>((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as PendingRecording[]);
    request.onerror = () => reject(request.error ?? new Error("無法讀取本機錄音"));
  });
  db.close();
  return result;
}

export async function removePendingRecording(id: string) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("無法清除已同步的本機錄音"));
  });
  db.close();
}
