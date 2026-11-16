import React, { useEffect, useState } from 'react';
import { Tag } from 'lucide-react';
import { APP_RELEASE_DATE, APP_VERSION, APP_VERSION_LABEL } from '../version.ts';

/**
 * V5.3.4 — Fixed label, on every screen, with the version of the code that is running.
 * Rendered ONLY for an authorized administrator (participants never receive it).
 *
 * It shows the version compiled into the frontend and compares it with the version reported by the
 * server (GET /api/admin/version, admin-only). If they differ, part of the app is still running an
 * older deployment and the label turns amber.
 */
interface ServerVersionInfo {
  version: string;
  label: string;
  releaseDate?: string;
  summary?: string;
  serverStartedAt?: string;
}

export function versionBadgeState(
  clientVersion: string,
  server: ServerVersionInfo | null,
  serverUnavailable: boolean
): { tone: 'ok' | 'mismatch' | 'unknown'; text: string } {
  const clientLabel = `V${clientVersion}`;
  if (server && server.version !== clientVersion) {
    return { tone: 'mismatch', text: `App ${clientLabel} · Servidor ${server.label}` };
  }
  if (!server && serverUnavailable) {
    return { tone: 'unknown', text: `${clientLabel} · servidor sin confirmar` };
  }
  return { tone: 'ok', text: `Versión ${clientLabel}` };
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-MX');
}

export function AdminVersionBadge({ isAuthorizedAdmin }: { isAuthorizedAdmin: boolean }) {
  const [server, setServer] = useState<ServerVersionInfo | null>(null);
  const [serverUnavailable, setServerUnavailable] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!isAuthorizedAdmin) {
      setServer(null);
      setServerUnavailable(false);
      return;
    }
    let cancelled = false;
    const load = async (attempt: number) => {
      try {
        const res = await fetch('/api/admin/version', { credentials: 'same-origin', cache: 'no-store' });
        const body = res.ok ? await res.json() : null;
        if (cancelled) return;
        if (body?.success && body.data?.version) {
          setServer(body.data as ServerVersionInfo);
          setServerUnavailable(false);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      } catch {
        if (cancelled) return;
        // The ID token may not be ready right after sign-in: retry a few times before giving up.
        if (attempt < 3) setTimeout(() => void load(attempt + 1), 1500 * (attempt + 1));
        else setServerUnavailable(true);
      }
    };
    void load(0);
    return () => {
      cancelled = true;
    };
  }, [isAuthorizedAdmin]);

  if (!isAuthorizedAdmin) return null;

  const state = versionBadgeState(APP_VERSION, server, serverUnavailable);
  const toneClass =
    state.tone === 'mismatch'
      ? 'bg-amber-500 text-white border-amber-600'
      : state.tone === 'unknown'
        ? 'bg-stone-500 text-white border-stone-600'
        : 'bg-stone-900/85 text-stone-100 border-stone-700 dark:bg-stone-100/90 dark:text-stone-900 dark:border-stone-300';

  return (
    <div
      className="fixed left-2 bottom-2 z-[70] print:hidden select-none"
      data-testid="admin-version-badge"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-md backdrop-blur ${toneClass}`}
        title="Versión del código en ejecución (solo visible para el administrador)"
      >
        <Tag className="h-3 w-3" aria-hidden="true" />
        <span>{state.text}</span>
      </button>
      {expanded && (
        <div className="mt-1 w-64 rounded-lg border border-stone-300 bg-white p-3 text-[11px] text-stone-700 shadow-lg dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200">
          <p className="mb-1 font-semibold">Solo visible para el administrador</p>
          <p>Aplicación (navegador): {APP_VERSION_LABEL} · {APP_RELEASE_DATE}</p>
          <p>
            Servidor:{' '}
            {server ? `${server.label} · ${server.releaseDate || '—'}` : serverUnavailable ? 'sin respuesta' : 'consultando…'}
          </p>
          {server?.serverStartedAt && <p>Servidor iniciado: {formatDate(server.serverStartedAt)}</p>}
          {server?.summary && <p className="mt-1 text-stone-500 dark:text-stone-400">{server.summary}</p>}
          {state.tone === 'mismatch' && (
            <p className="mt-1 font-semibold text-amber-600">
              Navegador y servidor tienen versiones distintas: falta volver a desplegar o recargar la página.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
