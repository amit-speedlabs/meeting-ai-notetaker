import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import { q, one } from './db';
import { config } from './config';

/** Storage abstraction for audio segments: local disk, or Postgres for serverless hosts. Swap for S3 etc. later. */
export interface AudioStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  deletePrefix(prefix: string): Promise<void>;
}

class LocalAudioStore implements AudioStore {
  constructor(private root: string) {}
  private p(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root))) throw new Error('bad key');
    return full;
  }
  async put(key: string, data: Buffer) {
    const f = this.p(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, data);
  }
  async get(key: string) {
    try {
      return await fs.readFile(this.p(key));
    } catch {
      return null;
    }
  }
  async deletePrefix(prefix: string) {
    await fs.rm(this.p(prefix), { recursive: true, force: true });
  }
}

/** Keeps audio in the audio_blobs table. Fine for personal use; mind the free database size limit. */
class PostgresAudioStore implements AudioStore {
  async put(key: string, data: Buffer) {
    await q('insert into audio_blobs (key, data) values ($1, $2) on conflict (key) do update set data = excluded.data', [key, data]);
  }
  async get(key: string) {
    const r = await one<{ data: Buffer }>('select data from audio_blobs where key = $1', [key]);
    return r?.data ?? null;
  }
  async deletePrefix(prefix: string) {
    const like = prefix.replace(/[\\%_]/g, (c) => '\\' + c) + '/%';
    await q('delete from audio_blobs where key like $1', [like]);
  }
}

export const audioStore: AudioStore =
  config.audioStore === 'postgres' ? new PostgresAudioStore() : new LocalAudioStore(config.audioDir);

