/**
 * V5.3.1 — SERVER-SIDE ADMINISTRATOR AUTHENTICATION.
 *
 * Before V5.3.1, `getAdminUser` accepted an e-mail sent by the client (query string, `x-admin-user`
 * / `x-admin-email` headers or `Authorization: Bearer <email>`) and only checked that the address
 * was in the admin list. Anyone who knew an administrator's address could act as that administrator.
 *
 * Now identity is proven cryptographically and checked on the server:
 *
 * 1. `Authorization: Bearer <Firebase ID token>`: the token issued by Firebase Authentication when
 *    the administrator signs in with Google (the existing login). The server verifies its RS256
 *    signature against Google's published `securetoken` certificates and checks `aud` (project id),
 *    `iss`, `exp`, `iat`, `auth_time`, `sub` and `email_verified`. Only then is the e-mail compared
 *    with the server-side admin list.
 * 2. An HttpOnly admin session cookie, issued by `POST /api/auth/admin-session` ONLY in exchange for
 *    a verified ID token and signed with HMAC-SHA256. It exists for requests the browser makes
 *    without custom headers (download links, iframes, `window.open`). To prevent cross-site request
 *    forgery it is accepted ONLY for safe methods (GET / HEAD); every state-changing request needs
 *    the ID token itself.
 *
 * E-mails received in query strings, headers or bodies are ignored as proof of identity.
 * No paid or AI provider is involved; the only network call is the public certificate download.
 */
import crypto from 'node:crypto';
import firebaseConfig from '../../firebase-applet-config.json';

export const GOOGLE_SECURETOKEN_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
export const ADMIN_SESSION_COOKIE = 'yf_admin_session';
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;
const CLOCK_SKEW_SECONDS = 60;

export interface VerifiedAdminIdentity {
  email: string;
  uid: string;
  method: 'firebase_id_token' | 'admin_session_cookie';
}

export type IdTokenFailure =
  | 'malformed'
  | 'unsupported_algorithm'
  | 'unknown_key'
  | 'bad_signature'
  | 'wrong_audience'
  | 'wrong_issuer'
  | 'expired'
  | 'issued_in_future'
  | 'missing_subject'
  | 'email_not_verified'
  | 'certificates_unavailable';

export class AdminAuthError extends Error {
  constructor(public readonly reason: IdTokenFailure | string) {
    super(`admin_auth_failed:${reason}`);
  }
}

// ------------------------------------------------------------------------------------------------
// Test doubles (only when explicitly allowed, exactly like the storage test doubles)
// ------------------------------------------------------------------------------------------------
interface AdminAuthTestDoubles {
  /** Returns the PEM certificate/public key for a key id (replaces the Google download). */
  certificateProvider?: (kid: string) => Promise<string | null> | string | null;
  projectId?: string;
  nowSeconds?: () => number;
  sessionSecret?: string;
}
let testDoubles: AdminAuthTestDoubles | null = null;

export function configureAdminAuthTestDoubles(doubles: AdminAuthTestDoubles | null): void {
  if (process.env.YOUFOREVER_ALLOW_TEST_DOUBLES !== '1') {
    throw new Error('Los dobles de prueba de autenticación solo se permiten en pruebas.');
  }
  testDoubles = doubles;
  certificateCache = { certs: {}, expiresAtMs: 0 };
}

const nowSeconds = () => (testDoubles?.nowSeconds ? testDoubles.nowSeconds() : Math.floor(Date.now() / 1000));

export function resolveFirebaseProjectId(): string {
  return (
    testDoubles?.projectId ||
    (process.env.FIREBASE_PROJECT_ID || '').trim() ||
    String((firebaseConfig as { projectId?: string }).projectId || '')
  );
}

// ------------------------------------------------------------------------------------------------
// Google certificates (cached according to Cache-Control max-age)
// ------------------------------------------------------------------------------------------------
let certificateCache: { certs: Record<string, string>; expiresAtMs: number } = { certs: {}, expiresAtMs: 0 };
let inFlightCertificateFetch: Promise<void> | null = null;

async function refreshGoogleCertificates(): Promise<void> {
  if (inFlightCertificateFetch) return inFlightCertificateFetch;
  inFlightCertificateFetch = (async () => {
    const res = await fetch(GOOGLE_SECURETOKEN_CERTS_URL);
    if (!res.ok) throw new AdminAuthError('certificates_unavailable');
    const certs = (await res.json()) as Record<string, string>;
    const maxAge = Number((res.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
    certificateCache = { certs, expiresAtMs: Date.now() + Math.max(60, maxAge) * 1000 };
  })().finally(() => {
    inFlightCertificateFetch = null;
  });
  return inFlightCertificateFetch;
}

async function getSigningCertificate(kid: string): Promise<string | null> {
  if (testDoubles?.certificateProvider) return (await testDoubles.certificateProvider(kid)) || null;
  if (Date.now() >= certificateCache.expiresAtMs || !certificateCache.certs[kid]) {
    try {
      await refreshGoogleCertificates();
    } catch {
      if (!certificateCache.certs[kid]) throw new AdminAuthError('certificates_unavailable');
    }
  }
  return certificateCache.certs[kid] || null;
}

// ------------------------------------------------------------------------------------------------
// Firebase ID token verification
// ------------------------------------------------------------------------------------------------
const b64urlDecode = (part: string): Buffer => Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const b64urlEncode = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function verifyFirebaseIdToken(token: string): Promise<{ uid: string; email: string }> {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts.some((p) => !p)) throw new AdminAuthError('malformed');
  let header: any;
  let payload: any;
  try {
    header = JSON.parse(b64urlDecode(parts[0]).toString('utf8'));
    payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
  } catch {
    throw new AdminAuthError('malformed');
  }
  if (!header || header.alg !== 'RS256') throw new AdminAuthError('unsupported_algorithm');
  if (typeof header.kid !== 'string' || !header.kid) throw new AdminAuthError('unknown_key');

  const certificate = await getSigningCertificate(header.kid);
  if (!certificate) throw new AdminAuthError('unknown_key');
  let signatureValid = false;
  try {
    signatureValid = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8'),
      crypto.createPublicKey(certificate),
      b64urlDecode(parts[2])
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) throw new AdminAuthError('bad_signature');

  const projectId = resolveFirebaseProjectId();
  const now = nowSeconds();
  if (!projectId || payload.aud !== projectId) throw new AdminAuthError('wrong_audience');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new AdminAuthError('wrong_issuer');
  if (typeof payload.exp !== 'number' || payload.exp <= now - CLOCK_SKEW_SECONDS) throw new AdminAuthError('expired');
  if (typeof payload.iat !== 'number' || payload.iat > now + CLOCK_SKEW_SECONDS) {
    throw new AdminAuthError('issued_in_future');
  }
  if (typeof payload.auth_time === 'number' && payload.auth_time > now + CLOCK_SKEW_SECONDS) {
    throw new AdminAuthError('issued_in_future');
  }
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) {
    throw new AdminAuthError('missing_subject');
  }
  if (typeof payload.email !== 'string' || payload.email_verified !== true) {
    throw new AdminAuthError('email_not_verified');
  }
  return { uid: payload.sub, email: payload.email.trim().toLowerCase() };
}

// ------------------------------------------------------------------------------------------------
// Admin session cookie (HMAC-SHA256)
// ------------------------------------------------------------------------------------------------
let processSessionSecret: Buffer | null = null;
function sessionSecret(): Buffer {
  if (testDoubles?.sessionSecret) return Buffer.from(testDoubles.sessionSecret, 'utf8');
  const configured = (process.env.ADMIN_SESSION_SECRET || '').trim();
  if (configured.length >= 32) return Buffer.from(configured, 'utf8');
  // Without a configured secret each instance uses its own random key: sessions simply have to be
  // re-established (automatically, from the signed-in Google session) after a restart or on another
  // instance. They can never be forged.
  if (!processSessionSecret) processSessionSecret = crypto.randomBytes(32);
  return processSessionSecret;
}

export function issueAdminSessionCookieValue(identity: { email: string; uid: string }): string {
  const iat = nowSeconds();
  const body = b64urlEncode(
    Buffer.from(
      JSON.stringify({
        v: 1,
        email: identity.email,
        uid: identity.uid,
        iat,
        exp: iat + ADMIN_SESSION_TTL_SECONDS,
        nonce: crypto.randomBytes(9).toString('hex'),
      }),
      'utf8'
    )
  );
  const mac = b64urlEncode(crypto.createHmac('sha256', sessionSecret()).update(body).digest());
  return `${body}.${mac}`;
}

export function verifyAdminSessionCookieValue(value: string): { email: string; uid: string } | null {
  const [body, mac, extra] = String(value || '').split('.');
  if (!body || !mac || extra !== undefined) return null;
  const expected = crypto.createHmac('sha256', sessionSecret()).update(body).digest();
  const given = b64urlDecode(mac);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body).toString('utf8'));
    if (payload?.v !== 1 || typeof payload.email !== 'string' || typeof payload.uid !== 'string') return null;
    if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds()) return null;
    return { email: payload.email, uid: payload.uid };
  } catch {
    return null;
  }
}

export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Cookie attributes. Over HTTPS (production, also when the app is embedded in an iframe) the cookie
 * is `SameSite=None; Secure; Partitioned`; over plain HTTP (local development) `SameSite=Strict`.
 * It is always HttpOnly and scoped to /api.
 */
export function buildAdminSessionCookie(value: string, secure: boolean, maxAgeSeconds = ADMIN_SESSION_TTL_SECONDS): string {
  const base = `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/api; HttpOnly; Max-Age=${maxAgeSeconds}`;
  return secure ? `${base}; Secure; SameSite=None; Partitioned` : `${base}; SameSite=Strict`;
}

// ------------------------------------------------------------------------------------------------
// V5.3.2 — Participant media access cookie
// ------------------------------------------------------------------------------------------------
/**
 * Photos and voice recordings are referenced by URL (`/api/photos/<id>`, `/api/audio/<id>`) inside
 * answers, manuscripts and books, and are loaded by `<img>`, `<audio>` and the PDF composer, which
 * cannot send custom headers. When a participant (or a relative using the participant's code)
 * opens a session with a valid access code, the server issues this HttpOnly cookie listing the
 * interviews that browser may see. It is signed (HMAC-SHA256, separate from the admin session) and
 * expires; it grants READ access to that interview's media only.
 */
export const MEDIA_ACCESS_COOKIE = 'yf_media_access';
export const MEDIA_ACCESS_TTL_SECONDS = 12 * 60 * 60;
const MEDIA_ACCESS_MAX_INTERVIEWS = 10;

const mediaMac = (body: string) =>
  b64urlEncode(crypto.createHmac('sha256', sessionSecret()).update(`media:${body}`).digest());

export function verifyMediaAccessCookieValue(value: string | null | undefined): string[] {
  const [body, mac, extra] = String(value || '').split('.');
  if (!body || !mac || extra !== undefined) return [];
  const expected = b64urlDecode(mediaMac(body));
  const given = b64urlDecode(mac);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return [];
  try {
    const payload = JSON.parse(b64urlDecode(body).toString('utf8'));
    if (payload?.v !== 1 || !Array.isArray(payload.interviews)) return [];
    if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds()) return [];
    return payload.interviews.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

/** New cookie value granting `interviewId`, keeping the (still valid) interviews already granted. */
export function issueMediaAccessCookieValue(interviewId: string, existingValue?: string | null): string {
  const previous = verifyMediaAccessCookieValue(existingValue).filter((id) => id !== interviewId);
  const interviews = [interviewId, ...previous].slice(0, MEDIA_ACCESS_MAX_INTERVIEWS);
  const body = b64urlEncode(
    Buffer.from(JSON.stringify({ v: 1, interviews, exp: nowSeconds() + MEDIA_ACCESS_TTL_SECONDS }), 'utf8')
  );
  return `${body}.${mediaMac(body)}`;
}

export function buildMediaAccessCookie(value: string, secure: boolean, maxAgeSeconds = MEDIA_ACCESS_TTL_SECONDS): string {
  const base = `${MEDIA_ACCESS_COOKIE}=${encodeURIComponent(value)}; Path=/api; HttpOnly; Max-Age=${maxAgeSeconds}`;
  return secure ? `${base}; Secure; SameSite=None; Partitioned` : `${base}; SameSite=Lax`;
}

export function mediaAccessInterviewsFromRequest(req: AdminAuthRequestLike): string[] {
  const cookieHeader = req.headers['cookie'];
  return verifyMediaAccessCookieValue(
    readCookie(typeof cookieHeader === 'string' ? cookieHeader : undefined, MEDIA_ACCESS_COOKIE)
  );
}

// ------------------------------------------------------------------------------------------------
// Request authentication
// ------------------------------------------------------------------------------------------------
export interface AdminAuthRequestLike {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}

const SAFE_METHODS = new Set(['GET', 'HEAD']);

/**
 * Resolves the VERIFIED administrator of a request, or null. `isAdmin` is the server-side admin
 * list. Client-supplied e-mails are never consulted.
 */
export async function authenticateAdminRequest(
  req: AdminAuthRequestLike,
  isAdmin: (email: string) => boolean
): Promise<VerifiedAdminIdentity | null> {
  const authHeader = req.headers['authorization'];
  const bearer =
    typeof authHeader === 'string' && /^Bearer\s+/i.test(authHeader) ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
  // A JWT has exactly three dot-separated parts; anything else (e.g. an e-mail) is not a credential.
  if (bearer && bearer.split('.').length === 3) {
    try {
      const identity = await verifyFirebaseIdToken(bearer);
      return isAdmin(identity.email) ? { ...identity, method: 'firebase_id_token' } : null;
    } catch {
      return null;
    }
  }
  if (SAFE_METHODS.has(String(req.method || 'GET').toUpperCase())) {
    const cookieHeader = req.headers['cookie'];
    const raw = readCookie(typeof cookieHeader === 'string' ? cookieHeader : undefined, ADMIN_SESSION_COOKIE);
    const session = raw ? verifyAdminSessionCookieValue(raw) : null;
    if (session && isAdmin(session.email)) return { ...session, method: 'admin_session_cookie' };
  }
  return null;
}
