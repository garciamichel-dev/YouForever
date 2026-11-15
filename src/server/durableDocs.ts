/**
 * V5.3.1 — DURABLE PERSISTENCE HELPERS.
 *
 * Deployment reality (verified in the repository): the server runs as a Google AI Studio app on
 * Cloud Run (`metadata.json`, `firebase-applet-config.json`, `APP_URL` with `ais-dev-`/`ais-pre-`).
 * Cloud Run's filesystem is in-memory and per instance: `data/storage_state.json` disappears on every
 * restart, scale-down or new instance. Cloud Firestore is the ONLY durable store.
 *
 * Therefore a book version (and its quota counters and audit report) is durable only when it was
 * written to Firestore — unless an operator explicitly declares the local disk persistent
 * (`YOUFOREVER_LOCAL_DISK_DURABLE=true`, e.g. a self-hosted server with a persistent volume), which
 * is ignored on Cloud Run (`K_SERVICE` set).
 *
 * Firestore refuses documents above ~1 MiB; the existing guard skipped any write above 800 KB, which
 * silently left large books only in the ephemeral snapshot. Large documents are now split into
 * chunk documents in the SAME collection (so the existing security rules apply unchanged) plus a
 * manifest, and reassembled (with a SHA-256 check) when loaded back.
 */
import crypto from 'node:crypto';

/** Preventive single-document limit (Firestore's hard limit is 1,048,576 bytes). */
export const FIRESTORE_SAFE_DOC_BYTES = 800_000;
/** UTF-8 bytes of JSON carried by each chunk document. */
export const FIRESTORE_CHUNK_PAYLOAD_BYTES = 700_000;

export interface LocalDiskDurability {
  durable: boolean;
  reason: 'cloud_run_ephemeral_filesystem' | 'declared_persistent_volume' | 'not_declared_durable' | 'test_override';
}

export function resolveLocalDiskDurability(env: NodeJS.ProcessEnv = process.env): LocalDiskDurability {
  if (env.K_SERVICE) return { durable: false, reason: 'cloud_run_ephemeral_filesystem' };
  if ((env.YOUFOREVER_LOCAL_DISK_DURABLE || '').trim().toLowerCase() === 'true') {
    return { durable: true, reason: 'declared_persistent_volume' };
  }
  return { durable: false, reason: 'not_declared_durable' };
}

export const chunkDocId = (docId: string, index: number) => `${docId}__part${index}`;

export interface ChunkedDocPlan {
  manifest: Record<string, unknown>;
  chunks: Array<{ id: string; data: Record<string, unknown> }>;
  bytes: number;
}

/** Splits a UTF-8 buffer without cutting a multi-byte character. */
function splitUtf8(buf: Buffer, maxBytes: number): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < buf.length) {
    let end = Math.min(start + maxBytes, buf.length);
    // Move back while `end` points at a continuation byte (10xxxxxx).
    while (end < buf.length && end > start && (buf[end] & 0xc0) === 0x80) end--;
    parts.push(buf.subarray(start, end).toString('utf8'));
    start = end;
  }
  return parts;
}

/**
 * @param carry small fields copied to the manifest and every chunk so the collection's security
 *              rules (e.g. `interviewId is string`) and queries (`where interviewId == …`) still work.
 */
export function planChunkedDoc(
  docId: string,
  json: string,
  carry: Record<string, unknown>,
  maxChunkBytes = FIRESTORE_CHUNK_PAYLOAD_BYTES
): ChunkedDocPlan {
  const buf = Buffer.from(json, 'utf8');
  const parts = splitUtf8(buf, maxChunkBytes);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const chunks = parts.map((payload, i) => ({
    id: chunkDocId(docId, i),
    data: {
      ...carry,
      id: chunkDocId(docId, i),
      _chunkOf: docId,
      _chunkIndex: i,
      _chunkCount: parts.length,
      _sha256: sha256,
      _payload: payload,
    },
  }));
  return {
    manifest: {
      ...carry,
      id: docId,
      _chunked: true,
      _chunkCount: parts.length,
      _bytes: buf.length,
      _sha256: sha256,
      _writtenAt: new Date().toISOString(),
    },
    chunks,
    bytes: buf.length,
  };
}

/**
 * Reassembles chunked documents loaded from a collection. Chunk documents never appear as records.
 * A manifest whose chunks are missing or corrupt is reported in `incomplete` (never half-loaded).
 */
export function reassembleChunkedDocs<T = any>(rawDocs: any[]): { docs: T[]; incomplete: string[] } {
  const chunksByParent = new Map<string, any[]>();
  const docs: T[] = [];
  const manifests: any[] = [];
  for (const raw of rawDocs || []) {
    if (!raw || typeof raw !== 'object') continue;
    if (typeof raw._chunkOf === 'string') {
      const list = chunksByParent.get(raw._chunkOf) || [];
      list.push(raw);
      chunksByParent.set(raw._chunkOf, list);
    } else if (raw._chunked === true) {
      manifests.push(raw);
    } else {
      docs.push(raw as T);
    }
  }
  const incomplete: string[] = [];
  for (const manifest of manifests) {
    const count = Number(manifest._chunkCount) || 0;
    const parts = (chunksByParent.get(manifest.id) || [])
      .filter((c) => c._sha256 === manifest._sha256)
      .sort((a, b) => a._chunkIndex - b._chunkIndex);
    const complete = count > 0 && parts.length === count && parts.every((c, i) => c._chunkIndex === i);
    if (!complete) {
      incomplete.push(manifest.id);
      continue;
    }
    const json = parts.map((c) => String(c._payload || '')).join('');
    const sha = crypto.createHash('sha256').update(Buffer.from(json, 'utf8')).digest('hex');
    if (sha !== manifest._sha256) {
      incomplete.push(manifest.id);
      continue;
    }
    try {
      docs.push(JSON.parse(json) as T);
    } catch {
      incomplete.push(manifest.id);
    }
  }
  return { docs, incomplete };
}
