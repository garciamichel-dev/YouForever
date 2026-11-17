/**
 * V5.4.3 — INTEGRITY OF THE PARTICIPANTS' PHOTOGRAPHS (server only).
 *
 * Root causes of the lost photos fixed in V5.4.3 (see storage.ts):
 *
 * 1. Photos whose image was larger than ~750 KB were written to Firestore WITHOUT their image
 *    (`dataUrl: ''`, `storedOnDisk: true`); the bytes lived only in `data/photos/*.bin`. On Cloud
 *    Run that disk is ephemeral, so every restart / new instance erased those images for good.
 * 2. When the server could not find a photo's bytes locally (new instance, record not loaded yet)
 *    it did NOT look in Firestore: it drew a synthetic 480×320 sepia "archival" picture, saved it
 *    as the photo's file AND as the record's `dataUrl`. The next save of that answer (caption edit,
 *    «Guardar y Continuar», the 10-minute autosave) wrote the sepia picture to Firestore over the
 *    participant's real photograph.
 * 3. At every start-up, photos not referenced by the answers held in memory at that moment were
 *    deleted from memory, disk and FIRESTORE, even when the answers simply had not loaded yet
 *    (incremental start, timeout, quota).
 * 4. Editing an answer removed (and deleted from Firestore) any saved photo the browser did not
 *    resend, e.g. a background autosave with a stale photo list.
 *
 * V5.4.4 — Voice notes had causes 1 and 4 as well (recordings above 50,000 characters reached
 * Firestore without their audio); the audio helpers below serve the same fix.
 *
 * This module holds the pure helpers used by the fix: recognising a real image, recognising the
 * old synthetic placeholder (so it is never served or written again) and merging the photo list
 * of an edited answer without ever dropping a saved photo implicitly.
 */
import zlib from 'node:zlib';

/** Width × height of the synthetic sepia placeholder the server used to draw (removed in V5.4.3). */
const PLACEHOLDER_WIDTH = 480;
const PLACEHOLDER_HEIGHT = 320;
/** Outer cream mat colour (first pixel) and inner frame line colour of that placeholder. */
const PLACEHOLDER_MAT_RGB = [246, 240, 228] as const;
const PLACEHOLDER_FRAME_RGB = [146, 112, 72] as const;

export interface DecodedImage {
  buffer: Buffer;
  mimeType: string;
}

/** Decodes a base64 raster `data:image/...` URL (SVG and non-image URLs → null). */
export function decodeImageDataUrl(dataUrl: unknown): DecodedImage | null {
  if (typeof dataUrl !== 'string' || dataUrl.length <= 32 || !dataUrl.startsWith('data:image/')) return null;
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return null;
  const header = dataUrl.slice(5, comma);
  const mimeType = header.split(';')[0]?.trim() || 'image/jpeg';
  if (mimeType.includes('svg') || !header.includes('base64')) return null;
  const buffer = Buffer.from(dataUrl.substring(comma + 1).replace(/\s+/g, ''), 'base64');
  return buffer.length > 0 ? { buffer, mimeType } : null;
}

/**
 * True for the synthetic sepia picture older versions generated in place of a missing photo.
 * Checks the exact PNG layout the generator produced (480×320, 8-bit RGB, one IDAT, unfiltered
 * rows) and its cream mat / frame line pixels, so a participant's real image never matches.
 */
export function isArchivalPlaceholderPng(buffer: Buffer | null | undefined): boolean {
  if (!buffer || buffer.length < 64) return false;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < signature.length; i++) if (buffer[i] !== signature[i]) return false;
  try {
    if (buffer.toString('ascii', 12, 16) !== 'IHDR') return false;
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    const bitDepth = buffer[24];
    const colorType = buffer[25];
    if (width !== PLACEHOLDER_WIDTH || height !== PLACEHOLDER_HEIGHT || bitDepth !== 8 || colorType !== 2) {
      return false;
    }
    // Collect IDAT data.
    const idatParts: Buffer[] = [];
    let offset = 8;
    while (offset + 8 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.toString('ascii', offset + 4, offset + 8);
      if (type === 'IDAT') idatParts.push(buffer.subarray(offset + 8, offset + 8 + length));
      if (type === 'IEND') break;
      offset += 12 + length;
    }
    if (idatParts.length !== 1) return false;
    const raw = zlib.inflateSync(Buffer.concat(idatParts));
    const rowSize = 1 + PLACEHOLDER_WIDTH * 3;
    if (raw.length !== rowSize * PLACEHOLDER_HEIGHT) return false;
    const pixel = (x: number, y: number) => {
      const o = y * rowSize + 1 + x * 3;
      return [raw[o], raw[o + 1], raw[o + 2]];
    };
    const same = (a: number[], b: readonly number[]) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
    return (
      raw[0] === 0 &&
      same(pixel(0, 0), PLACEHOLDER_MAT_RGB) &&
      same(pixel(PLACEHOLDER_WIDTH - 1, PLACEHOLDER_HEIGHT - 1), PLACEHOLDER_MAT_RGB) &&
      same(pixel(100, 18), PLACEHOLDER_FRAME_RGB) &&
      same(pixel(18, 100), PLACEHOLDER_FRAME_RGB)
    );
  } catch {
    return false;
  }
}

/** A participant's real image: a raster data URL that is not the old synthetic placeholder. */
export function isRealPhotoDataUrl(dataUrl: unknown): dataUrl is string {
  const decoded = decodeImageDataUrl(dataUrl);
  return Boolean(decoded && !isArchivalPlaceholderPng(decoded.buffer));
}

/**
 * V5.4.4 — Decodes a base64 voice-note data URL (`data:audio/webm;codecs=opus;base64,...`).
 * Images and empty/non-base64 values → null.
 */
export function decodeAudioDataUrl(dataUrl: unknown): DecodedImage | null {
  if (typeof dataUrl !== 'string' || dataUrl.length <= 32 || !dataUrl.startsWith('data:')) return null;
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return null;
  const header = dataUrl.slice(5, comma);
  if (!header.includes('base64') || header.startsWith('image/')) return null;
  const mimeType = header.replace(/;base64$/, '').trim() || 'audio/webm';
  const buffer = Buffer.from(dataUrl.substring(comma + 1).replace(/\s+/g, ''), 'base64');
  return buffer.length > 0 ? { buffer, mimeType } : null;
}

/** V5.4.4 — A voice note's real recording (a non-empty base64 audio data URL). */
export function isRealAudioDataUrl(dataUrl: unknown): dataUrl is string {
  // Cheap check (recordings can be several MB): base64 data URL with a payload, not an image.
  if (typeof dataUrl !== 'string' || dataUrl.length <= 32 || !dataUrl.startsWith('data:')) return false;
  const comma = dataUrl.indexOf(',');
  if (comma === -1 || comma >= dataUrl.length - 4) return false;
  const header = dataUrl.slice(5, comma);
  return header.includes('base64') && !header.startsWith('image/');
}

/**
 * Photo list of an EDITED answer. Saved photos are removed only through the explicit delete action
 * (`POST /api/participant/photos/:id/delete`), so a photo the request did not mention is kept —
 * a stale or partial list from the browser can never erase a photograph.
 */
export function mergeEditedAnswerPhotos<T extends { id: string }>(params: {
  existing: T[] | undefined;
  resolvedIncoming: T[];
}): T[] {
  const incomingIds = new Set(params.resolvedIncoming.map((p) => p.id));
  const preserved = (params.existing || []).filter((p) => p && p.id && !incomingIds.has(p.id));
  return [...params.resolvedIncoming, ...preserved];
}
