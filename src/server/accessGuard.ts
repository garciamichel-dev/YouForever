/**
 * V5.6.2 — Anti-brute-force limiter for participant access codes and Mi Esencia personal codes.
 *
 * Rules (chosen so that real participants never notice it):
 * - Only attempts with a code that matches NOTHING count as failures. An expired or revoked code
 *   belongs to a real person (for example, a book-status poll after the invitation expired) and is
 *   never counted.
 * - A success does NOT erase the failures. Before V5.6.2 it did, so anyone with one valid code (for
 *   example, from the free self-registration) could reset the counter after every 7 guesses.
 * - While an address is blocked, credentials that already succeeded from that same address keep
 *   working, so a family sharing one Wi-Fi is not locked out mid-interview because of someone else.
 *   Brand-new codes from a blocked address wait until the block ends (even if correct), which is
 *   what makes guessing useless.
 * - State is in memory, per server instance, and pruned periodically.
 */

export interface AccessLimiterOptions {
  maxFailures: number;
  windowMs: number;
  blockMs: number;
  trustedTtlMs: number;
  maxEntries: number;
}

export const DEFAULT_ACCESS_LIMITER_OPTIONS: AccessLimiterOptions = {
  maxFailures: 8,
  windowMs: 10 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
  trustedTtlMs: 12 * 60 * 60 * 1000,
  maxEntries: 50_000,
};

interface FailureEntry {
  failedCount: number;
  windowStart: number;
  blockedUntil: number;
}

export class AccessAttemptLimiter {
  private readonly opts: AccessLimiterOptions;
  private readonly now: () => number;
  private readonly failures = new Map<string, FailureEntry>();
  private readonly trusted = new Map<string, Map<string, number>>();
  private lastPruneAt = 0;

  constructor(options: Partial<AccessLimiterOptions> = {}, now: () => number = () => Date.now()) {
    this.opts = { ...DEFAULT_ACCESS_LIMITER_OPTIONS, ...options };
    this.now = now;
  }

  /** Is this client blocked for this attempt? A previously successful credential is never blocked. */
  check(clientKey: string, credentialId?: string): { blocked: boolean; retryAfterMinutes: number } {
    this.maybePrune();
    const entry = this.failures.get(clientKey);
    const now = this.now();
    if (!entry || entry.blockedUntil <= now) return { blocked: false, retryAfterMinutes: 0 };
    if (credentialId && this.isTrusted(clientKey, credentialId)) {
      return { blocked: false, retryAfterMinutes: 0 };
    }
    return {
      blocked: true,
      retryAfterMinutes: Math.max(1, Math.ceil((entry.blockedUntil - now) / 60000)),
    };
  }

  /** Record one attempt with a code that matched nothing. */
  recordFailure(clientKey: string): void {
    const now = this.now();
    const entry = this.failures.get(clientKey);
    if (!entry || (now - entry.windowStart > this.opts.windowMs && entry.blockedUntil <= now)) {
      this.failures.set(clientKey, { failedCount: 1, windowStart: now, blockedUntil: 0 });
      return;
    }
    entry.failedCount += 1;
    if (entry.failedCount >= this.opts.maxFailures && entry.blockedUntil <= now) {
      entry.blockedUntil = now + this.opts.blockMs;
    }
  }

  /** Remember that this credential worked from this client (does not reset the failure count). */
  recordSuccess(clientKey: string, credentialId: string): void {
    if (!credentialId) return;
    let set = this.trusted.get(clientKey);
    if (!set) {
      set = new Map();
      this.trusted.set(clientKey, set);
    }
    set.set(credentialId, this.now() + this.opts.trustedTtlMs);
  }

  isTrusted(clientKey: string, credentialId: string): boolean {
    const expires = this.trusted.get(clientKey)?.get(credentialId);
    return typeof expires === 'number' && expires > this.now();
  }

  /** Test/diagnostic helper. */
  size(): { failures: number; trustedClients: number } {
    return { failures: this.failures.size, trustedClients: this.trusted.size };
  }

  private maybePrune(): void {
    const now = this.now();
    if (now - this.lastPruneAt < 60_000 && this.failures.size + this.trusted.size < this.opts.maxEntries) {
      return;
    }
    this.lastPruneAt = now;
    for (const [key, entry] of this.failures) {
      if (entry.blockedUntil <= now && now - entry.windowStart > this.opts.windowMs) {
        this.failures.delete(key);
      }
    }
    for (const [key, set] of this.trusted) {
      for (const [cred, expires] of set) {
        if (expires <= now) set.delete(cred);
      }
      if (set.size === 0) this.trusted.delete(key);
    }
  }
}

/**
 * V5.6.2 — Cap on FORCED book regenerations ("regenerar" button) per interview, per rolling 24 h,
 * for non-administrators. Normal generation, resuming and style changes are not counted. Above the
 * cap the request is served without forcing (the existing job / result is reused), so the participant
 * never sees an error. BOOK_FORCE_REFRESH_DAILY_LIMIT overrides the default (0 = no cap).
 */
export function resolveForcedRegenerationDailyLimit(env: Record<string, string | undefined> = process.env): number {
  const raw = env.BOOK_FORCE_REFRESH_DAILY_LIMIT;
  if (raw === undefined || raw.trim() === '') return 15;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 15;
}

export class ForcedRegenerationLimiter {
  private readonly events = new Map<string, number[]>();
  constructor(
    private readonly limit: () => number = () => resolveForcedRegenerationDailyLimit(),
    private readonly now: () => number = () => Date.now(),
    private readonly windowMs: number = 24 * 60 * 60 * 1000
  ) {}

  /** true → this forced regeneration may run (and is counted); false → serve it without forcing. */
  tryConsume(interviewId: string): boolean {
    const limit = this.limit();
    if (limit === 0) return true;
    const now = this.now();
    const recent = (this.events.get(interviewId) || []).filter((t) => now - t < this.windowMs);
    if (recent.length >= limit) {
      this.events.set(interviewId, recent);
      return false;
    }
    recent.push(now);
    this.events.set(interviewId, recent);
    return true;
  }
}

/**
 * Client identity for the limiter. With `trust proxy` configured (see api.ts) Express resolves
 * `req.ip` from the X-Forwarded-For entry added by the platform's own proxy, which the client
 * cannot forge.
 */
export function clientKeyFromRequest(req: {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}): string {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedLast = Array.isArray(forwarded)
    ? forwarded[forwarded.length - 1]
    : String(forwarded || '').split(',').pop();
  return String(req.ip || forwardedLast?.trim() || req.socket?.remoteAddress || 'anon');
}

/**
 * Number of proxy hops Express should trust. Cloud Run (where AI Studio deploys) adds exactly one,
 * so the default is 1. Set TRUST_PROXY_HOPS=0 to disable, or a larger number behind extra proxies.
 */
export function resolveTrustProxyHops(env: Record<string, string | undefined> = process.env): number {
  const raw = env.TRUST_PROXY_HOPS;
  if (raw === undefined || raw.trim() === '') return 1;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
}

/**
 * V5.8.5 (#9) — Anti-spam limits of the public free registration, so nobody can use the
 * registration form to send mass e-mails from YouForever's Gmail account. The numbers come from
 * Configuración Global (FreeRegistrationLimits; 0 = no limit) and are read on every request, so a
 * change applies immediately. In memory, per server instance.
 *
 * - Registrations per connection (IP) in a rolling hour.
 * - Registrations per e-mail address in a rolling 24 hours.
 * - "Reenviar correo": one per interview every N minutes.
 * Only successful registrations / sends are counted (a form error is never penalized).
 */
export interface FreeRegistrationLimitValues {
  perIpPerHour: number;
  perEmailPerDay: number;
  resendCooldownMinutes: number;
}

export class FreeRegistrationLimiter {
  private readonly byIp = new Map<string, number[]>();
  private readonly byEmail = new Map<string, number[]>();
  private readonly lastResend = new Map<string, number>();
  private lastPruneAt = 0;

  constructor(
    private readonly limits: () => FreeRegistrationLimitValues,
    private readonly now: () => number = () => Date.now()
  ) {}

  private recent(map: Map<string, number[]>, key: string, windowMs: number): number[] {
    const t = this.now();
    const list = (map.get(key) || []).filter((ts) => t - ts < windowMs);
    if (list.length) map.set(key, list);
    else map.delete(key);
    return list;
  }

  /** null = allowed; otherwise the message to show (Spanish, no technical details). */
  checkRegistration(clientKey: string, emails: string[]): string | null {
    this.maybePrune();
    const { perIpPerHour, perEmailPerDay } = this.limits();
    if (perIpPerHour > 0 && this.recent(this.byIp, clientKey, 3_600_000).length >= perIpPerHour) {
      return 'Se alcanzó el número máximo de registros desde esta conexión por ahora. Intenta de nuevo en una hora.';
    }
    if (perEmailPerDay > 0) {
      for (const email of emails) {
        if (this.recent(this.byEmail, email, 86_400_000).length >= perEmailPerDay) {
          return `El correo ${email} ya alcanzó el número máximo de registros por hoy. Intenta de nuevo mañana o revisa tu bandeja de entrada (y la carpeta de spam).`;
        }
      }
    }
    return null;
  }

  recordRegistration(clientKey: string, emails: string[]): void {
    const t = this.now();
    this.byIp.set(clientKey, [...this.recent(this.byIp, clientKey, 3_600_000), t]);
    for (const email of emails) {
      this.byEmail.set(email, [...this.recent(this.byEmail, email, 86_400_000), t]);
    }
  }

  /** null = allowed; otherwise the message to show. */
  checkResend(interviewId: string): string | null {
    const { resendCooldownMinutes } = this.limits();
    if (resendCooldownMinutes <= 0) return null;
    const last = this.lastResend.get(interviewId);
    if (last === undefined) return null;
    const waitMs = last + resendCooldownMinutes * 60_000 - this.now();
    if (waitMs <= 0) return null;
    const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
    return `El correo se acaba de reenviar. Podrás reenviarlo de nuevo en ${minutes} minuto(s); revisa también la carpeta de spam.`;
  }

  recordResend(interviewId: string): void {
    this.lastResend.set(interviewId, this.now());
  }

  private maybePrune(): void {
    const t = this.now();
    if (t - this.lastPruneAt < 600_000) return;
    this.lastPruneAt = t;
    for (const key of Array.from(this.byIp.keys())) this.recent(this.byIp, key, 3_600_000);
    for (const key of Array.from(this.byEmail.keys())) this.recent(this.byEmail, key, 86_400_000);
    for (const [key, ts] of Array.from(this.lastResend.entries())) {
      if (t - ts > 86_400_000) this.lastResend.delete(key);
    }
  }
}
