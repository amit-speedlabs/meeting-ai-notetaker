'use client';

/**
 * Durable upload queue backed by IndexedDB. Segments are written to disk before upload so a network
 * outage, API failure or tab crash does not lose them. Retries with exponential backoff.
 */
export type QueueItem = { meetingId: string; seq: number; blob: Blob; startMs: number; durationMs: number; silent: boolean; mime: string; attempts: number };
export type AudioLinkStatus = 'CONNECTED' | 'BUFFERING' | 'DISCONNECTED';
export type QueueState = { pending: number; status: AudioLinkStatus; lastError: string | null; uploaded: number; persistent: boolean };

const DB = 'meeting-ai-notetaker';
const STORE = 'segments';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: ['meetingId', 'seq'] });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function idbAll(meetingId?: string): Promise<QueueItem[]> {
  const db = await openDb();
  const all = (await reqP(db.transaction(STORE).objectStore(STORE).getAll())) as QueueItem[];
  return meetingId ? all.filter((i) => i.meetingId === meetingId) : all;
}

export async function metaGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDb();
    return (await reqP(db.transaction('meta').objectStore('meta').get(key))) as T | undefined;
  } catch {
    return undefined;
  }
}
export async function metaSet(key: string, value: unknown) {
  try {
    const db = await openDb();
    const tx = db.transaction('meta', 'readwrite');
    if (value === undefined) tx.objectStore('meta').delete(key);
    else tx.objectStore('meta').put(value, key);
  } catch {
    /* ignore */
  }
}

export async function discardQueued(meetingId: string) {
  const db = await openDb();
  const items = await idbAll(meetingId);
  const tx = db.transaction(STORE, 'readwrite');
  for (const i of items) tx.objectStore(STORE).delete([i.meetingId, i.seq]);
}

export class UploadQueue {
  private memory: QueueItem[] = []; // fallback if IndexedDB is unavailable
  private persistent = true;
  private busy = false;
  private backoff = 1000;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  state: QueueState = { pending: 0, status: 'CONNECTED', lastError: null, uploaded: 0, persistent: true };

  constructor(
    private meetingId: string,
    private upload: (item: QueueItem) => Promise<Response>,
    private onChange: (s: QueueState) => void,
    private onUploaded?: (item: QueueItem, body: any) => void,
  ) {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.kick);
      window.addEventListener('offline', this.update);
    }
  }

  dispose() {
    window.removeEventListener('online', this.kick);
    window.removeEventListener('offline', this.update);
    if (this.timer) clearTimeout(this.timer);
  }

  async add(item: Omit<QueueItem, 'attempts' | 'meetingId'>) {
    const full: QueueItem = { ...item, meetingId: this.meetingId, attempts: 0 };
    try {
      const db = await openDb();
      await new Promise<void>((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(full);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    } catch {
      this.persistent = false;
      this.memory.push(full);
    }
    this.kick();
  }

  private async items(): Promise<QueueItem[]> {
    if (!this.persistent) return this.memory;
    try {
      return (await idbAll(this.meetingId)).sort((a, b) => a.seq - b.seq);
    } catch {
      this.persistent = false;
      return this.memory;
    }
  }

  private async remove(item: QueueItem) {
    if (!this.persistent) {
      this.memory = this.memory.filter((i) => i.seq !== item.seq);
      return;
    }
    const db = await openDb();
    await reqP(db.transaction(STORE, 'readwrite').objectStore(STORE).delete([item.meetingId, item.seq]));
  }

  kick = () => {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    void this.drain();
  };

  private update = async () => {
    const pending = (await this.items()).length;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const status: AudioLinkStatus = offline || this.failures >= 3 ? 'DISCONNECTED' : pending > 0 ? 'BUFFERING' : 'CONNECTED';
    this.state = { ...this.state, pending, status, persistent: this.persistent };
    this.onChange(this.state);
  };

  private async drain() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (;;) {
        const list = await this.items();
        await this.update();
        if (!list.length) break;
        if (navigator.onLine === false) break;
        const item = list[0];
        let res: Response | null = null;
        try {
          res = await this.upload(item);
        } catch (e: any) {
          this.state.lastError = 'Network unavailable — audio is being buffered locally';
        }
        if (res && res.ok) {
          const body = await res.json().catch(() => ({}));
          await this.remove(item);
          this.failures = 0;
          this.backoff = 1000;
          this.state.uploaded++;
          this.state.lastError = null;
          this.onUploaded?.(item, body);
          continue;
        }
        if (res && res.status >= 400 && res.status < 500 && ![408, 425, 429].includes(res.status)) {
          // Permanent rejection (e.g. meeting already completed): drop the segment, surface the reason.
          const body = await res.json().catch(() => ({}));
          this.state.lastError = `Segment ${item.seq} rejected: ${body.error || res.status}`;
          await this.remove(item);
          continue;
        }
        if (res) {
          const body = await res.json().catch(() => ({}));
          this.state.lastError = body.error || `Server error ${res.status} — retrying`;
        }
        this.failures++;
        await this.update();
        this.timer = setTimeout(this.kick, this.backoff);
        this.backoff = Math.min(this.backoff * 2, 30000);
        break;
      }
    } finally {
      this.busy = false;
      await this.update();
    }
  }

  /** Resolves when the queue is empty or the timeout elapses; returns remaining count. */
  async flush(timeoutMs: number): Promise<number> {
    const until = Date.now() + timeoutMs;
    this.kick();
    for (;;) {
      const n = (await this.items()).length;
      if (!n || Date.now() > until) return n;
      await new Promise((r) => setTimeout(r, 500));
      if (!this.busy && !this.timer) this.kick();
    }
  }
}
