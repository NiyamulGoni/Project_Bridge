import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { HttpError } from './errors.js';

/**
 * Where project images live (FR02). Screenshots use a private bucket and short-lived signed URLs;
 * cover images use a public bucket because every tier, Guests included, sees the card thumbnail.
 */
export interface MediaStorage {
  upload(path: string, data: Buffer, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  signedUrl(path: string): Promise<string | null>;
  /** Permanent URL of an object in a public bucket. */
  publicUrl(path: string): string;
}

function notConfigured(): never {
  throw new HttpError(
    503,
    'STORAGE_UNAVAILABLE',
    'Image uploads are not configured on this server. Your project can be submitted without images.',
  );
}

class SupabaseStorage implements MediaStorage {
  private client: SupabaseClient | undefined;

  constructor(private bucketName: string) {}

  private bucket() {
    if (!config.media.supabaseUrl || !config.media.supabaseServiceKey) notConfigured();
    this.client ??= createClient(config.media.supabaseUrl, config.media.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return this.client.storage.from(this.bucketName);
  }

  async upload(path: string, data: Buffer, contentType: string) {
    const { error } = await this.bucket().upload(path, data, { contentType, upsert: false });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
  }

  async remove(paths: string[]) {
    if (paths.length === 0) return;
    const { error } = await this.bucket().remove(paths);
    if (error) throw new Error(`Storage delete failed: ${error.message}`);
  }

  async signedUrl(path: string) {
    if (!config.media.supabaseUrl || !config.media.supabaseServiceKey) return null;
    const { data, error } = await this.bucket().createSignedUrl(path, config.media.signedUrlTtlSeconds);
    if (error) {
      console.error(`[storage] Could not sign ${path}: ${error.message}`);
      return null;
    }
    // Accepted exception to "never return storage paths": Supabase's URL includes the object path. The
    // path is a project id and a random UUID, and it is useless without the short-lived token.
    return data.signedUrl;
  }

  publicUrl(path: string) {
    return this.bucket().getPublicUrl(path).data.publicUrl;
  }
}

/** In-memory bucket used by the automated tests. */
export class MemoryStorage implements MediaStorage {
  objects = new Map<string, { data: Buffer; contentType: string }>();
  async upload(path: string, data: Buffer, contentType: string) {
    this.objects.set(path, { data, contentType });
  }
  async remove(paths: string[]) {
    for (const p of paths) this.objects.delete(p);
  }
  async signedUrl(path: string) {
    return this.objects.has(path) ? `memory://${path}?signed=1` : null;
  }
  publicUrl(path: string) {
    return `memory://${path}`;
  }
}

const inMemory = config.media.driver === 'memory';
let current: MediaStorage = inMemory ? new MemoryStorage() : new SupabaseStorage(config.media.bucket);
let covers: MediaStorage = inMemory ? new MemoryStorage() : new SupabaseStorage(config.media.coverBucket);

export function getStorage(): MediaStorage {
  return current;
}

export function setStorage(storage: MediaStorage): void {
  current = storage;
}

export function getCoverStorage(): MediaStorage {
  return covers;
}

export function setCoverStorage(storage: MediaStorage): void {
  covers = storage;
}
