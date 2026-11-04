import type { ProjectMedia } from '@prisma/client';
import { getStorage } from '../../lib/storage.js';

/** Accepted screenshot types, checked against the file's own signature, not just the declared type. */
const SIGNATURES: Record<string, { ext: string; matches: (b: Buffer) => boolean }> = {
  'image/png': { ext: 'png', matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', matches: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
};

export const ACCEPTED_IMAGE_TYPES = Object.keys(SIGNATURES);

/** Returns the file extension for a genuine PNG/JPEG/WebP, or null. */
export function imageExtension(mimeType: string, data: Buffer): string | null {
  const sig = SIGNATURES[mimeType];
  return sig && sig.matches(data) ? sig.ext : null;
}

/** Short-lived signed URLs for a private bucket; unsignable files are skipped. */
export async function signScreenshots(media: ProjectMedia[]): Promise<Array<{ id: string; url: string }>> {
  const storage = getStorage();
  const sorted = [...media].sort((a, b) => a.position - b.position);
  const signed = await Promise.all(sorted.map(async (m) => ({ id: m.id, url: await storage.signedUrl(m.storagePath) })));
  return signed.filter((s): s is { id: string; url: string } => s.url !== null);
}
