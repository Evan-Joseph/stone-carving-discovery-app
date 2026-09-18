interface StoredAttachmentRecord {
  id: string;
  dataUrl: string;
  bytes: number;
  createdAt: number;
  updatedAt: number;
}

const IDB_NAME = "stone-chat-attachments";
const IDB_STORE = "attachments";
const IDB_VERSION = 1;
const IDB_KEY_PREFIX = "idb:";
const INLINE_KEY_PREFIX = "ls:";
const INLINE_STORAGE_KEY = "stone-chat-attachments-inline-v1";
const MAX_IDB_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_IDB_ITEMS = 80;
const MAX_INLINE_TOTAL_BYTES = 1_200_000;
const MAX_INLINE_ITEMS = 6;
const STALE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const b64 = dataUrl.slice(comma + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

function buildAttachmentId(): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `asset-${random}`;
}

function normalizeBytes(dataUrl: string, bytes: number): number {
  const parsed = Number(bytes);
  if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  return estimateDataUrlBytes(dataUrl);
}

function canUseIndexedDb(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openIndexedDb(): Promise<IDBDatabase | null> {
  if (!canUseIndexedDb()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = window.indexedDB.open(IDB_NAME, IDB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function idbGetAll(db: IDBDatabase): Promise<StoredAttachmentRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const store = tx.objectStore(IDB_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      const rows = Array.isArray(request.result) ? (request.result as StoredAttachmentRecord[]) : [];
      resolve(rows);
    };
    request.onerror = () => reject(request.error || new Error("idb getAll failed"));
  });
}

function idbPut(db: IDBDatabase, record: StoredAttachmentRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("idb put failed"));
    tx.objectStore(IDB_STORE).put(record);
  });
}

function idbDeleteMany(db: IDBDatabase, ids: string[]): Promise<void> {
  if (!ids.length) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("idb delete failed"));
    const store = tx.objectStore(IDB_STORE);
    for (const id of ids) {
      store.delete(id);
    }
  });
}

function idbGet(db: IDBDatabase, id: string): Promise<StoredAttachmentRecord | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const request = tx.objectStore(IDB_STORE).get(id);
    request.onsuccess = () => {
      const row = request.result as StoredAttachmentRecord | undefined;
      resolve(row || null);
    };
    request.onerror = () => reject(request.error || new Error("idb get failed"));
  });
}

async function touchIndexedRecord(db: IDBDatabase, record: StoredAttachmentRecord): Promise<void> {
  try {
    await idbPut(db, {
      ...record,
      updatedAt: Date.now()
    });
  } catch {
    // ignore touch failure
  }
}

async function pruneIndexedDb(db: IDBDatabase): Promise<void> {
  const rows = await idbGetAll(db);
  if (!rows.length) return;

  const now = Date.now();
  const sorted = rows.slice().sort((a, b) => a.updatedAt - b.updatedAt);
  const toDelete: string[] = [];
  let totalBytes = rows.reduce((sum, row) => sum + Math.max(0, Number(row.bytes) || 0), 0);
  let itemCount = rows.length;

  for (const row of sorted) {
    if (now - row.updatedAt > STALE_TTL_MS) {
      toDelete.push(row.id);
      totalBytes -= Math.max(0, Number(row.bytes) || 0);
      itemCount -= 1;
    }
  }

  for (const row of sorted) {
    if (itemCount <= MAX_IDB_ITEMS && totalBytes <= MAX_IDB_TOTAL_BYTES) break;
    if (toDelete.includes(row.id)) continue;
    toDelete.push(row.id);
    totalBytes -= Math.max(0, Number(row.bytes) || 0);
    itemCount -= 1;
  }

  if (toDelete.length) {
    await idbDeleteMany(db, toDelete);
  }
}

function readInlineRecords(): StoredAttachmentRecord[] {
  const raw = safeString(localStorage.getItem(INLINE_STORAGE_KEY));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StoredAttachmentRecord[];
    return Array.isArray(parsed)
      ? parsed
          .map((item) => ({
            id: safeString(item?.id),
            dataUrl: safeString(item?.dataUrl),
            bytes: Math.max(0, Number(item?.bytes) || 0),
            createdAt: Number(item?.createdAt) || 0,
            updatedAt: Number(item?.updatedAt) || 0
          }))
          .filter((item) => item.id && item.dataUrl)
      : [];
  } catch {
    return [];
  }
}

function writeInlineRecords(records: StoredAttachmentRecord[]): void {
  localStorage.setItem(INLINE_STORAGE_KEY, JSON.stringify(records));
}

function pruneInlineRecords(records: StoredAttachmentRecord[]): StoredAttachmentRecord[] {
  const now = Date.now();
  const sorted = records.slice().sort((a, b) => a.updatedAt - b.updatedAt);
  const kept: StoredAttachmentRecord[] = [];
  let total = 0;

  for (const row of sorted) {
    if (now - row.updatedAt > STALE_TTL_MS) continue;
    kept.push(row);
  }

  const recent = kept.sort((a, b) => b.updatedAt - a.updatedAt);
  const finalRows: StoredAttachmentRecord[] = [];

  for (const row of recent) {
    if (finalRows.length >= MAX_INLINE_ITEMS) continue;
    const bytes = Math.max(0, Number(row.bytes) || 0);
    if (total + bytes > MAX_INLINE_TOTAL_BYTES && finalRows.length > 0) continue;
    total += bytes;
    finalRows.push(row);
  }

  return finalRows;
}

function persistInlineFallback(record: StoredAttachmentRecord): string | undefined {
  try {
    const rows = readInlineRecords().filter((item) => item.id !== record.id);
    const merged = pruneInlineRecords([record, ...rows]);
    writeInlineRecords(merged);
    return `${INLINE_KEY_PREFIX}${record.id}`;
  } catch {
    return undefined;
  }
}

export async function persistChatAttachment(input: { dataUrl: string; bytes: number }): Promise<string | undefined> {
  const dataUrl = safeString(input.dataUrl);
  if (!dataUrl) return undefined;

  const record: StoredAttachmentRecord = {
    id: buildAttachmentId(),
    dataUrl,
    bytes: normalizeBytes(dataUrl, input.bytes),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const db = await openIndexedDb();
  if (db) {
    try {
      await idbPut(db, record);
      await pruneIndexedDb(db);
      return `${IDB_KEY_PREFIX}${record.id}`;
    } catch {
      // fallback to localStorage
    }
  }

  return persistInlineFallback(record);
}

export async function restoreChatAttachments(assetIds: string[]): Promise<Record<string, string>> {
  const cleaned = Array.from(new Set(assetIds.map((item) => safeString(item)).filter(Boolean)));
  if (!cleaned.length) return {};

  const result: Record<string, string> = {};
  const idbIds = cleaned
    .filter((item) => item.startsWith(IDB_KEY_PREFIX))
    .map((item) => item.slice(IDB_KEY_PREFIX.length));

  if (idbIds.length) {
    const db = await openIndexedDb();
    if (db) {
      for (const id of idbIds) {
        try {
          const row = await idbGet(db, id);
          if (!row?.dataUrl) continue;
          result[`${IDB_KEY_PREFIX}${id}`] = row.dataUrl;
          void touchIndexedRecord(db, row);
        } catch {
          // ignore single-item restore error
        }
      }
    }
  }

  const inlineIds = cleaned
    .filter((item) => item.startsWith(INLINE_KEY_PREFIX))
    .map((item) => item.slice(INLINE_KEY_PREFIX.length));

  if (inlineIds.length) {
    const rows = readInlineRecords();
    const map = new Map(rows.map((item) => [item.id, item]));
    let touched = false;

    for (const id of inlineIds) {
      const row = map.get(id);
      if (!row?.dataUrl) continue;
      result[`${INLINE_KEY_PREFIX}${id}`] = row.dataUrl;
      row.updatedAt = Date.now();
      touched = true;
    }

    if (touched) {
      try {
        writeInlineRecords(pruneInlineRecords(Array.from(map.values())));
      } catch {
        // ignore local cache write failure
      }
    }
  }

  return result;
}
