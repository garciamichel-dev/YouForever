/**
 * V5.3 — "Ver auditoría del libro": administrative audit report of ONE saved book version.
 *
 * Admin-only. The data comes from `/api/admin/book-versions/:id/audit`, which the server protects
 * with `requireAdmin`; participants never receive it (hiding it here is not the protection).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Download, RefreshCw, CheckCircle2, MessageSquarePlus, Wrench, ShieldAlert } from 'lucide-react';
import { apiFetch } from '../utils/apiClient.ts';
import {
  BOOK_AUDIT_INCIDENT_KIND_LABELS,
  BOOK_AUDIT_INCIDENT_STATUS_LABELS,
  COVERAGE_BAND_LABELS,
  type BookAuditIncident,
  type BookAuditIncidentKind,
  type BookAuditIncidentStatus,
  type BookAuditReport,
} from '../logic/bookAuditReport.ts';
import type { CoverageBand } from '../logic/demoStoryRules.ts';

const STYLE_LABELS: Record<string, string> = {
  first_person_simple: 'Estilo A — autobiografía sencilla',
  first_person_literary: 'Estilo B — autobiografía literaria',
  third_person_biography: 'Estilo C — biografía narrativa',
};

const BAND_CLASSES: Record<CoverageBand, string> = {
  pending_review: 'bg-stone-100 text-stone-700 border-stone-300',
  orange: 'bg-orange-100 text-orange-900 border-orange-400',
  yellow: 'bg-yellow-100 text-yellow-900 border-yellow-400',
  green: 'bg-emerald-100 text-emerald-900 border-emerald-400',
};

/** Percentage shown with two decimals, truncated (never rounded up across a threshold). */
export function formatExactCoverage(percent: number): string {
  if (!Number.isFinite(percent)) return '—';
  return `${(Math.floor(percent * 100) / 100).toFixed(2)} %`;
}

export function CoverageBandChip({
  band,
  percent,
  compact = false,
}: {
  band: CoverageBand;
  percent: number;
  compact?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border rounded-full font-semibold ${
        compact ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'
      } ${BAND_CLASSES[band]}`}
      title="Indicador administrativo de cobertura documental (no visible para participantes)"
    >
      <span
        className={`w-2 h-2 rounded-full ${
          band === 'green'
            ? 'bg-emerald-600'
            : band === 'yellow'
            ? 'bg-yellow-500'
            : band === 'orange'
            ? 'bg-orange-500'
            : 'bg-stone-400'
        }`}
      />
      {COVERAGE_BAND_LABELS[band]} · {formatExactCoverage(percent)}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-stone-500 font-semibold">{label}</div>
      <div className="text-sm font-bold text-stone-900">{value}</div>
    </div>
  );
}

export default function BookAuditReportPanel({
  versionId,
  adminEmail,
  onClose,
}: {
  versionId: string;
  adminEmail: string;
  onClose: () => void;
}) {
  const [report, setReport] = useState<BookAuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<'all' | BookAuditIncidentKind>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | BookAuditIncidentStatus>('all');
  const [chapterFilter, setChapterFilter] = useState<string>('all');
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [generalNote, setGeneralNote] = useState('');
  const [selectedForCorrection, setSelectedForCorrection] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const headers = useMemo(() => ({ 'x-admin-user': adminEmail }), [adminEmail]);
  const base = `/api/admin/book-versions/${encodeURIComponent(versionId)}/audit`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiFetch<BookAuditReport>(base, { headers, retries: 1 });
    if (res.ok && res.data) setReport(res.data);
    else setError(res.error || 'No se pudo cargar el informe de auditoría.');
    setLoading(false);
  }, [base, headers]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (path: string, body: unknown) => {
    setBusy(true);
    const res = await apiFetch<BookAuditReport>(`${base}${path}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok && res.data) setReport(res.data);
    else setError(res.error || 'No se pudo guardar el cambio.');
    return res.ok;
  };

  const exportJson = async () => {
    const res = await fetch(`${base}/export`, { headers });
    if (!res.ok) {
      setError('No se pudo exportar el informe.');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auditoria_${versionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const incidents = report?.incidents || [];
  const chapters = Array.from(new Set(incidents.map((i) => i.chapterTitle).filter(Boolean))) as string[];
  const filtered = incidents.filter(
    (i) =>
      (kindFilter === 'all' || i.kind === kindFilter) &&
      (statusFilter === 'all' || i.adminStatus === statusFilter) &&
      (chapterFilter === 'all' || i.chapterTitle === chapterFilter)
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl my-6" data-testid="book-audit-report">
        <div className="flex items-start justify-between gap-4 p-5 border-b border-stone-200">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-stone-500">
              <ShieldAlert className="w-4 h-4 text-amber-700" /> Auditoría del libro · solo administradores
            </div>
            <h2 className="text-lg font-bold text-stone-900 mt-1">
              {report
                ? `${report.identification.protagonistName} — versión ${report.identification.versionNumber}`
                : 'Cargando…'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void load()} className="p-2 rounded-lg border border-stone-300 hover:bg-stone-50" title="Recargar">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" onClick={() => void exportJson()} disabled={!report} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-stone-900 text-white text-xs font-semibold disabled:opacity-50">
              <Download className="w-3.5 h-3.5" /> Exportar JSON
            </button>
            <button type="button" onClick={onClose} className="p-2 rounded-lg border border-stone-300 hover:bg-stone-50" title="Cerrar">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {error && <div className="m-5 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-sm">{error}</div>}

        {report && (
          <div className="p-5 space-y-6 text-sm">
            <section className="flex flex-wrap items-center gap-3">
              <CoverageBandChip band={report.coverage.band} percent={report.coverage.exactPercent} />
              <span className="text-xs text-stone-600">
                {report.delivery.deliveryStatus === 'delivered'
                  ? 'Entregado, plenamente verificado'
                  : report.delivery.deliveryStatus === 'delivered_with_observations'
                  ? 'Entregado con observaciones'
                  : 'Pendiente de revisión'}
              </span>
              {report.identification.source !== 'generated_on_save' && (
                <span className="text-xs px-2 py-0.5 rounded bg-stone-100 border border-stone-300 text-stone-700">
                  {report.identification.source === 'reconstructed_from_saved_version'
                    ? 'Informe reconstruido'
                    : 'Versión guardada sin auditoría'}
                </span>
              )}
              {report.durability && (
                <span className="text-xs text-stone-500">
                  Réplica remota: {report.durability.remoteStatus === 'written' ? 'escrita' : 'solo copia local'}
                </span>
              )}
            </section>

            <section>
              <h3 className="font-bold text-stone-900 mb-2">Identificación</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat label="Libro / versión" value={<span className="font-mono text-xs break-all">{report.identification.versionId}</span>} />
                <Stat label="Entrevista" value={<span className="font-mono text-xs break-all">{report.identification.interviewId}</span>} />
                <Stat label="Estilo" value={STYLE_LABELS[report.identification.narrativeStyle] || report.identification.narrativeStyle} />
                <Stat label="Número de versión" value={report.identification.versionNumber} />
                <Stat label="Generado" value={report.identification.generatedAt ? new Date(report.identification.generatedAt).toLocaleString() : '—'} />
                <Stat label="Guardado" value={new Date(report.identification.savedAt).toLocaleString()} />
                <Stat label="Proveedor / modelo" value={`${report.identification.provider || '—'} / ${report.identification.model || '—'}`} />
                <Stat label="Trabajo de generación" value={report.identification.generationJobId || '—'} />
                <Stat label="Motor" value={<span className="text-xs">{report.identification.engineVersion}</span>} />
                <Stat label="Reglas documentales" value={<span className="text-xs">{report.identification.rulesVersion}</span>} />
                <Stat label="Política de entrega" value={<span className="text-xs">{report.identification.deliveryPolicyVersion}</span>} />
                <Stat label="Vía de aprobación" value={report.identification.approvalPath || '—'} />
              </div>
            </section>

            <section>
              <h3 className="font-bold text-stone-900 mb-2">Cobertura documental</h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <Stat label="Cobertura exacta" value={formatExactCoverage(report.coverage.exactPercent)} />
                <Stat label="Unidades elegibles" value={report.coverage.eligibleUnits} />
                <Stat label="Verificadas" value={report.coverage.verifiedUnits} />
                <Stat label="No verificadas" value={report.coverage.notVerifiedUnits} />
                <Stat label="Omitidas" value={report.coverage.omittedUnits} />
                <Stat label="Parciales" value={report.coverage.partialUnits} />
                <Stat label="Ambiguas" value={report.coverage.ambiguousUnits} />
                <Stat label="Verificación pendiente" value={report.coverage.pendingVerificationUnits} />
                <Stat label="Contradicciones" value={report.coverage.contradictions} />
                <Stat label="Incidencias corregidas / pendientes" value={`${report.coverage.incidentsCorrected} / ${report.coverage.incidentsPending}`} />
                <Stat label="Exclusiones justificadas" value={report.coverage.exclusions.length} />
                <Stat label="Fotos disponibles" value={report.coverage.photosAvailable} />
                <Stat label="Fotos integradas" value={report.coverage.photosIntegrated} />
                <Stat label="Fotos pendientes" value={report.coverage.photosPending} />
                <Stat label="Auditoría estricta" value={report.strictAudit.documentaryPassed && report.strictAudit.editorialPassed ? 'Aprobada' : 'Con observaciones'} />
              </div>
              <p className="text-xs text-stone-500 mt-2">
                "No verificadas" incluye unidades pendientes de verificación: no equivale a omisiones confirmadas.
              </p>
            </section>

            <section>
              <div className="flex flex-wrap items-end justify-between gap-2 mb-2">
                <h3 className="font-bold text-stone-900">Incidencias ({filtered.length} de {incidents.length})</h3>
                <div className="flex flex-wrap gap-2 text-xs">
                  <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as any)} className="border border-stone-300 rounded-lg px-2 py-1">
                    <option value="all">Todos los tipos</option>
                    {Object.entries(BOOK_AUDIT_INCIDENT_KIND_LABELS).map(([k, l]) => (
                      <option key={k} value={k}>{l}</option>
                    ))}
                  </select>
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="border border-stone-300 rounded-lg px-2 py-1">
                    <option value="all">Todos los estados</option>
                    {Object.entries(BOOK_AUDIT_INCIDENT_STATUS_LABELS).map(([k, l]) => (
                      <option key={k} value={k}>{l}</option>
                    ))}
                  </select>
                  <select value={chapterFilter} onChange={(e) => setChapterFilter(e.target.value)} className="border border-stone-300 rounded-lg px-2 py-1">
                    <option value="all">Todos los capítulos</option>
                    {chapters.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                {filtered.map((inc: BookAuditIncident) => (
                  <div key={inc.incidentId} className="border border-stone-200 rounded-xl p-3" data-testid="audit-incident">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={selectedForCorrection.has(inc.incidentId)}
                        onChange={(e) => {
                          const next = new Set(selectedForCorrection);
                          if (e.target.checked) next.add(inc.incidentId);
                          else next.delete(inc.incidentId);
                          setSelectedForCorrection(next);
                        }}
                        title="Seleccionar para solicitar corrección"
                      />
                      <span className="font-bold text-stone-900">{BOOK_AUDIT_INCIDENT_KIND_LABELS[inc.kind]}</span>
                      <span className={`px-1.5 py-0.5 rounded ${inc.severity === 'alta' ? 'bg-rose-100 text-rose-800' : inc.severity === 'media' ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-700'}`}>
                        Gravedad {inc.severity}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-800">{BOOK_AUDIT_INCIDENT_STATUS_LABELS[inc.adminStatus]}</span>
                      {inc.chapterTitle && (
                        <span className="text-stone-600">
                          {inc.chapterTitle}
                          {typeof inc.paragraphIndex === 'number' ? ` · párrafo ${inc.paragraphIndex + 1}` : ''}
                        </span>
                      )}
                      {inc.unitId && <span className="font-mono text-stone-400">{inc.unitId}</span>}
                    </div>
                    {inc.testimony && (
                      <p className="mt-2 text-xs"><strong>Testimonio original:</strong> {inc.testimony}</p>
                    )}
                    {inc.excerpt && (
                      <p className="mt-1 text-xs text-stone-700"><strong>Fragmento:</strong> {inc.excerpt}</p>
                    )}
                    {(inc.judgeRationale || inc.detail) && (
                      <p className="mt-1 text-xs text-stone-600">
                        <strong>{inc.judgeRationale ? 'Juez semántico' : 'Detalle'}:</strong> {inc.judgeRationale || inc.detail}
                      </p>
                    )}
                    {inc.adminNotes.length > 0 && (
                      <ul className="mt-2 text-xs text-stone-600 list-disc pl-5">
                        {inc.adminNotes.map((n, i) => (
                          <li key={i}>{n.note} — {n.by}, {new Date(n.at).toLocaleString()}</li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {inc.adminStatus !== 'reviewed_by_admin' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void post(`/incidents/${encodeURIComponent(inc.incidentId)}/status`, { status: 'reviewed_by_admin' })}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-emerald-300 text-emerald-800 text-[11px] font-semibold hover:bg-emerald-50 disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3 h-3" /> Marcar revisada
                        </button>
                      )}
                      <input
                        value={noteDrafts[inc.incidentId] || ''}
                        onChange={(e) => setNoteDrafts({ ...noteDrafts, [inc.incidentId]: e.target.value })}
                        placeholder="Observación administrativa…"
                        className="flex-1 min-w-[180px] border border-stone-300 rounded-lg px-2 py-1 text-xs"
                      />
                      <button
                        type="button"
                        disabled={busy || !(noteDrafts[inc.incidentId] || '').trim()}
                        onClick={async () => {
                          if (await post('/notes', { note: noteDrafts[inc.incidentId], incidentId: inc.incidentId })) {
                            setNoteDrafts({ ...noteDrafts, [inc.incidentId]: '' });
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-300 text-[11px] font-semibold hover:bg-stone-50 disabled:opacity-50"
                      >
                        <MessageSquarePlus className="w-3 h-3" /> Añadir
                      </button>
                    </div>
                  </div>
                ))}
                {filtered.length === 0 && <p className="text-xs text-stone-500">No hay incidencias con estos filtros.</p>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy || selectedForCorrection.size === 0}
                  onClick={async () => {
                    if (await post('/corrections', { incidentIds: Array.from(selectedForCorrection), note: generalNote })) {
                      setSelectedForCorrection(new Set());
                    }
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-800 text-white text-xs font-semibold disabled:opacity-50"
                >
                  <Wrench className="w-3.5 h-3.5" /> Solicitar corrección focalizada ({selectedForCorrection.size})
                </button>
                <span className="text-xs text-stone-500">La versión guardada no se modifica: una corrección se guarda como versión nueva.</span>
              </div>
            </section>

            {report.repair && (
              <section>
                <h3 className="font-bold text-stone-900 mb-2">Reparación</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Stat label="Rondas" value={String((report.repair as any).roundsExecuted ?? '—')} />
                  <Stat label="Capítulos revisados" value={String((report.repair as any).chaptersReviewed ?? '—')} />
                  <Stat label="Aceptadas / rechazadas" value={`${(report.repair as any).repairsAccepted ?? 0} / ${(report.repair as any).repairsRejected ?? 0}`} />
                  <Stat label="Unidades recuperadas" value={String((report.repair as any).unitsRecovered ?? '—')} />
                  <Stat label="Incidencias restantes" value={String((report.repair as any).remainingIncidents ?? '—')} />
                  <Stat label="Motivo de cierre" value={String((report.repair as any).stopReason ?? '—')} />
                </div>
              </section>
            )}

            {report.operations && (
              <section>
                <h3 className="font-bold text-stone-900 mb-2">Información operativa</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Stat label="Duración total" value={`${Math.round(Number((report.operations as any).totalMs || 0) / 100) / 10} s`} />
                  <Stat label="Redacción" value={`${Math.round(Number((report.operations as any).draftMs || 0) / 100) / 10} s`} />
                  <Stat label="Auditoría" value={`${Math.round(Number((report.operations as any).auditMs || 0) / 100) / 10} s`} />
                  <Stat label="Reparación" value={`${Math.round(Number((report.operations as any).repairMs || 0) / 100) / 10} s`} />
                  <Stat label="Llamadas de redacción" value={String((report.operations as any).draftCalls ?? '—')} />
                  <Stat label="Casos enviados al juez" value={String((report.operations as any).judgeCasesSent ?? '—')} />
                  <Stat label="Casos desde caché" value={String((report.operations as any).judgeCasesFromCache ?? '—')} />
                  <Stat label="Lotes generados / reutilizados" value={`${(report.operations as any).batchesGenerated ?? '—'} / ${(report.operations as any).batchesReused ?? '—'}`} />
                  <Stat label="Tokens entrada / salida" value={`${(report.operations as any).tokens?.input ?? 'sin dato'} / ${(report.operations as any).tokens?.output ?? 'sin dato'}`} />
                  <Stat label="Tokens en caché" value={String((report.operations as any).tokens?.cachedInput ?? 'sin dato')} />
                  <Stat label="Costo estimado" value={(report.operations as any).estimatedCostUsd == null ? 'sin datos suficientes' : `US$ ${(report.operations as any).estimatedCostUsd}`} />
                  <Stat label="Reintentos / errores" value={`${(report.operations as any).retries ?? 0} / ${((report.operations as any).technicalErrors || []).length}`} />
                </div>
              </section>
            )}

            <section>
              <h3 className="font-bold text-stone-900 mb-2">Observaciones administrativas</h3>
              <ul className="text-xs text-stone-700 list-disc pl-5 space-y-1">
                {report.adminNotes.map((n, i) => (
                  <li key={i}>{n.note} — {n.by}, {new Date(n.at).toLocaleString()}</li>
                ))}
                {report.adminNotes.length === 0 && <li className="list-none text-stone-500">Sin observaciones.</li>}
              </ul>
              <div className="mt-2 flex gap-2">
                <input value={generalNote} onChange={(e) => setGeneralNote(e.target.value)} placeholder="Observación general…" className="flex-1 border border-stone-300 rounded-lg px-2 py-1 text-xs" />
                <button
                  type="button"
                  disabled={busy || !generalNote.trim()}
                  onClick={async () => {
                    if (await post('/notes', { note: generalNote })) setGeneralNote('');
                  }}
                  className="px-3 py-1 rounded-lg border border-stone-300 text-xs font-semibold disabled:opacity-50"
                >
                  Añadir
                </button>
              </div>
            </section>

            <section>
              <h3 className="font-bold text-stone-900 mb-2">Historial de auditoría</h3>
              <ul className="text-xs text-stone-600 space-y-1">
                {[...report.history].reverse().map((h, i) => (
                  <li key={i}>{new Date(h.at).toLocaleString()} · {h.event} · {h.by}{h.detail ? ` · ${h.detail}` : ''}</li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
