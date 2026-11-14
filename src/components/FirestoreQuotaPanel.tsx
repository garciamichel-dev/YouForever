import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  Clock,
  Layers,
} from 'lucide-react';
import type {
  FirestoreQuotaReport,
  FirestoreQuotaMetricSummary,
} from '../logic/firestoreQuota.ts';
import { apiFetch } from '../utils/apiClient.ts';

interface FirestoreQuotaPanelProps {
  adminEmail: string | null;
  onSyncedInterviews?: () => void;
  onReportLoaded?: (report: FirestoreQuotaReport) => void;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('es-MX').format(Math.max(0, Math.round(n || 0)));
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return 'Sin registro aún';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Sin registro aún';
  return d.toLocaleString('es-MX', {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
}

export const FirestoreQuotaPanel: React.FC<FirestoreQuotaPanelProps> = ({
  adminEmail,
  onSyncedInterviews,
  onReportLoaded,
}) => {
  const [report, setReport] = useState<FirestoreQuotaReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [probing, setProbing] = useState<boolean>(false);
  const [fullSyncing, setFullSyncing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadQuotaReport = useCallback(async () => {
    try {
      const res = await apiFetch<FirestoreQuotaReport>('/api/admin/firestore-quota', {
        headers: {
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
        retries: 1,
      });
      if (res.ok && res.data) {
        setReport(res.data);
        setErrorMessage(null);
        onReportLoaded?.(res.data);
      } else if (res.error) {
        setErrorMessage(res.error);
      }
    } catch {
      setErrorMessage('No se pudo cargar el estado de cuotas de Firestore.');
    } finally {
      setLoading(false);
    }
  }, [adminEmail, onReportLoaded]);

  useEffect(() => {
    void loadQuotaReport();
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadQuotaReport();
      }
    }, 45_000);
    return () => clearInterval(intervalId);
  }, [loadQuotaReport]);

  const handleProbeNow = async () => {
    try {
      setProbing(true);
      setErrorMessage(null);
      const res = await apiFetch<FirestoreQuotaReport>('/api/admin/firestore-quota/probe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
        body: JSON.stringify({ sync: true }),
      });
      if (res.ok && res.data) {
        setReport(res.data);
        onReportLoaded?.(res.data);
        onSyncedInterviews?.();
        setActionMessage(
          res.data.probe?.healthy
            ? `Sonda en vivo exitosa (${res.data.probe.latencyMs} ms). Sincronización incremental verificada.`
            : res.data.probe?.errorMessage || 'Sonda completada con advertencias.'
        );
        setTimeout(() => setActionMessage(null), 5000);
      } else {
        setErrorMessage(res.error || 'Error al ejecutar la consulta en vivo a Firestore.');
      }
    } catch {
      setErrorMessage('Error de red al consultar Cloud Firestore.');
    } finally {
      setProbing(false);
    }
  };

  const handleFullSync = async () => {
    try {
      setFullSyncing(true);
      setErrorMessage(null);
      const res = await fetch('/api/interviews/sync-firestore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
        body: JSON.stringify({ full: true }),
      });
      const json = await res.json();
      if (json?.quotaReport) {
        setReport(json.quotaReport);
        onReportLoaded?.(json.quotaReport);
      } else {
        await loadQuotaReport();
      }
      if (json?.success) {
        onSyncedInterviews?.();
        setActionMessage(
          json.syncResult?.message ||
            'Sincronización completa finalizada con actualización de caché local.'
        );
        setTimeout(() => setActionMessage(null), 5000);
      } else {
        setErrorMessage(json?.error || 'No se pudo completar la sincronización completa.');
      }
    } catch {
      setErrorMessage('Error de red al ejecutar sincronización completa.');
    } finally {
      setFullSyncing(false);
    }
  };

  const renderMetricCard = (metric: FirestoreQuotaMetricSummary) => {
    const barPercent = Math.min(100, Math.max(0, metric.percent));
    const barColor = metric.exceeded100
      ? 'bg-rose-600'
      : metric.nearLimit80
        ? 'bg-amber-600'
        : 'bg-emerald-600';
    const cardBorder = metric.exceeded100
      ? 'border-rose-300 bg-rose-50/40'
      : metric.nearLimit80
        ? 'border-amber-300 bg-amber-50/40'
        : 'border-stone-200 bg-white';
    const badgeColor = metric.exceeded100
      ? 'text-rose-800 bg-rose-100 border-rose-200'
      : metric.nearLimit80
        ? 'text-amber-900 bg-amber-100 border-amber-300'
        : 'text-emerald-800 bg-emerald-50 border-emerald-200';

    return (
      <div
        key={metric.key}
        data-testid={`quota-card-${metric.key}`}
        className={`rounded-xl border p-5 space-y-3 ${cardBorder}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              {metric.label}
            </p>
            <div className="mt-1 flex items-baseline gap-1.5 tabular-nums font-mono">
              <span className="text-2xl font-bold text-stone-900">
                {formatNumber(metric.used)}
              </span>
              <span className="text-xs text-stone-500">
                / {formatNumber(metric.freeLimit)} gratis
              </span>
            </div>
          </div>
          <span
            className={`px-2 py-0.5 rounded-md border text-xs font-bold tabular-nums font-mono ${badgeColor}`}
          >
            {metric.percent.toFixed(1)}%
          </span>
        </div>

        {/* Progress Bar with explicit 80% warning threshold mark */}
        <div className="relative h-2.5 w-full rounded-full bg-stone-200 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${barColor}`}
            style={{ width: `${barPercent}%` }}
          />
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-stone-800/70"
            style={{ left: '80%' }}
            title="Umbral de alerta preventiva (80%)"
          />
        </div>

        <div className="flex items-center justify-between text-[11px] text-stone-600 tabular-nums">
          <span>Umbral alerta 80%: {formatNumber(metric.warningThresholdCount)}</span>
          <span className="font-medium">
            {metric.exceeded100
              ? 'Supera capa gratuita (Blaze cubre excedente)'
              : metric.nearLimit80
                ? 'Cerca del límite diario (≥ 80%)'
                : `Restante gratis: ${formatNumber(Math.max(0, metric.freeLimit - metric.used))}`}
          </span>
        </div>
      </div>
    );
  };

  if (loading && !report) {
    return (
      <div className="bg-white rounded-xl border border-stone-200 p-8 text-center text-sm text-stone-500">
        Cargando telemetría de cuotas de Cloud Firestore...
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="firestore-quota-panel">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-bold font-serif text-stone-900 flex items-start sm:items-center space-x-2">
            <Activity className="w-5 h-5 text-amber-700 shrink-0 mt-1 sm:mt-0" />
            <span>Monitor de Cuotas y Sincronización Firestore</span>
          </h2>
          <p className="text-sm text-stone-500 mt-0.5">
            Supervisa el consumo diario frente a la capa gratuita de Firebase (reinicio a medianoche hora del Pacífico) y verifica la sincronización entre AI Studio y www.youforever.app.
          </p>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void handleProbeNow()}
            disabled={probing}
            data-testid="btn-probe-quota"
            className="inline-flex items-center space-x-1.5 min-h-[40px] px-3 py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${probing ? 'animate-spin' : ''}`} />
            <span>{probing ? 'Consultando Firestore...' : 'Consultar cuota ahora'}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleFullSync()}
            disabled={fullSyncing}
            data-testid="btn-full-sync-quota"
            className="inline-flex items-center space-x-1.5 min-h-[40px] px-3 py-2 bg-white hover:bg-stone-50 border border-stone-300 text-stone-800 rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-50 cursor-pointer whitespace-nowrap"
            title="Ejecutar una resincronización completa de respaldo (útil solo si necesitas verificar colecciones históricas)"
          >
            <Database className={`w-3.5 h-3.5 text-amber-700 ${fullSyncing ? 'animate-pulse' : ''}`} />
            <span>{fullSyncing ? 'Resincronizando...' : 'Sincronización completa'}</span>
          </button>

          {report?.consoleUsageUrl && (
            <a
              href={report.consoleUsageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-1.5 min-h-[40px] px-3 py-2 bg-stone-100 hover:bg-stone-200 border border-stone-300 text-stone-800 rounded-lg text-xs font-semibold transition whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5 text-stone-600" />
              <span>Consola Firebase</span>
            </a>
          )}
        </div>
      </div>

      {/* Feedback messages */}
      {errorMessage && (
        <div className="p-4 rounded-xl border border-rose-300 bg-rose-50 text-rose-900 text-xs flex items-center space-x-2">
          <ShieldAlert className="w-4 h-4 text-rose-700 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {actionMessage && (
        <div className="p-4 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-900 text-xs flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{actionMessage}</span>
        </div>
      )}

      {/* Main Threshold Alert Banner (80% Warning / 100% Exceeded / Healthy) */}
      {report && (
        <>
          <div
            data-testid="quota-alert-banner"
            data-alert-level={report.alertLevel}
            className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              report.alertLevel === 'exceeded'
                ? 'bg-rose-50 border-rose-300 text-rose-950'
                : report.alertLevel === 'warning_80'
                  ? 'bg-amber-50 border-amber-300 text-amber-950'
                  : 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
            }`}
          >
            <div className="flex items-start space-x-3">
              {report.alertLevel === 'exceeded' ? (
                <ShieldAlert className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" />
              ) : report.alertLevel === 'warning_80' ? (
                <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <p className="text-sm font-bold">{report.alertTitle}</p>
                <p className="text-xs leading-relaxed opacity-90">{report.alertDescription}</p>
              </div>
            </div>
            <div className="text-left sm:text-right shrink-0 text-xs tabular-nums">
              <div className="font-mono font-bold text-stone-900">
                Fecha cuota: {report.dateKey}
              </div>
              <div className="text-[11px] opacity-75">Zona horaria: {report.timezone}</div>
            </div>
          </div>

          {/* 3 Daily Quota Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {renderMetricCard(report.metrics.reads)}
            {renderMetricCard(report.metrics.writes)}
            {renderMetricCard(report.metrics.deletes)}
          </div>

          {/* Incremental Savings & Multi-site Sync Freshness */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Incremental Optimization Breakdown */}
            <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-stone-900 flex items-center space-x-2">
                  <TrendingDown className="w-4 h-4 text-emerald-700" />
                  <span>Ahorro por Sincronización Incremental</span>
                </h3>
                <span className="text-xs font-mono font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md tabular-nums">
                  -{report.reductionPercent.toFixed(1)}% lecturas
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-stone-50 border border-stone-200">
                  <p className="text-stone-500">Lecturas evitadas hoy</p>
                  <p className="text-lg font-bold font-mono tabular-nums text-stone-900 mt-0.5">
                    {formatNumber(report.readsSavedByIncremental)}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-stone-50 border border-stone-200">
                  <p className="text-stone-500">Sin optimización (est.)</p>
                  <p className="text-lg font-bold font-mono tabular-nums text-stone-900 mt-0.5">
                    {formatNumber(report.estimatedTotalWithoutOptimization)}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-stone-700 flex items-center space-x-1.5">
                  <Layers className="w-3.5 h-3.5 text-stone-500" />
                  <span>Desglose de operaciones en esta instancia (hoy)</span>
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-stone-200 text-left text-stone-500">
                        <th className="py-1.5 font-medium">Módulo</th>
                        <th className="py-1.5 font-medium text-right">Lecturas</th>
                        <th className="py-1.5 font-medium text-right">Escrituras</th>
                        <th className="py-1.5 font-medium text-right">Eliminaciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 font-mono tabular-nums">
                      <tr>
                        <td className="py-1.5 font-sans text-stone-800">Entrevistas &amp; Libros</td>
                        <td className="py-1.5 text-right">{formatNumber(report.bySource.storage.reads)}</td>
                        <td className="py-1.5 text-right">{formatNumber(report.bySource.storage.writes)}</td>
                        <td className="py-1.5 text-right">{formatNumber(report.bySource.storage.deletes)}</td>
                      </tr>
                      <tr>
                        <td className="py-1.5 font-sans text-stone-800">Mi Esencia</td>
                        <td className="py-1.5 text-right">{formatNumber(report.bySource.miEsencia.reads)}</td>
                        <td className="py-1.5 text-right">{formatNumber(report.bySource.miEsencia.writes)}</td>
                        <td className="py-1.5 text-right">{formatNumber(report.bySource.miEsencia.deletes)}</td>
                      </tr>
                      <tr>
                        <td className="py-1.5 font-sans text-stone-800">Sonda / Telemetría</td>
                        <td className="py-1.5 text-right">{formatNumber(report.bySource.probe.reads)}</td>
                        <td className="py-1.5 text-right">{formatNumber(report.bySource.probe.writes)}</td>
                        <td className="py-1.5 text-right">{formatNumber(report.bySource.probe.deletes)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-stone-500">
                  {report.sharedAcrossInstances
                    ? 'Conteo combinado activo con documento compartido en Firestore (AI Studio + www.youforever.app).'
                    : 'Pulsa «Consultar cuota ahora» para combinar el conteo compartido entre AI Studio y www.youforever.app.'}
                </p>
              </div>
            </div>

            {/* Multi-Site Sync Freshness */}
            <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-stone-900 flex items-center space-x-2">
                  <Clock className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>Sincronización Multi-Sitio (AI Studio ↔ www.youforever.app)</span>
                </h3>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-md border border-stone-200 bg-stone-50 text-stone-700 whitespace-nowrap shrink-0">
                  Modo: {report.syncStatus.lastSyncMode === 'full' ? 'Base completa' : 'Incremental'}
                </span>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-stone-50 border border-stone-200">
                  <dt className="text-stone-500">Última sincronización exitosa</dt>
                  <dd className="font-medium text-stone-900 mt-0.5 tabular-nums">
                    {formatDateTime(report.syncStatus.lastSuccessAt)}
                  </dd>
                </div>
                <div className="p-3 rounded-lg bg-stone-50 border border-stone-200">
                  <dt className="text-stone-500">Entrevistas (Remoto / Local)</dt>
                  <dd className="font-bold font-mono text-stone-900 mt-0.5 tabular-nums">
                    {report.syncStatus.syncedRemoteInterviewsCount} remotas / {report.syncStatus.localInterviewsCount} locales
                  </dd>
                </div>
                <div className="p-3 rounded-lg bg-stone-50 border border-stone-200">
                  <dt className="text-stone-500">Estado de sonda en vivo</dt>
                  <dd className="font-medium text-stone-900 mt-0.5">
                    {report.probe
                      ? report.probe.healthy
                        ? `Conectado (${report.probe.latencyMs} ms)`
                        : report.probe.errorMessage || 'Error de conexión'
                      : 'Sin sonda ejecutada en esta sesión'}
                  </dd>
                </div>
                <div className="p-3 rounded-lg bg-stone-50 border border-stone-200">
                  <dt className="text-stone-500">Proyecto / Base de datos</dt>
                  <dd className="font-mono text-[11px] text-stone-800 mt-0.5 truncate" title={`${report.projectId} / ${report.databaseId}`}>
                    {report.projectId}
                  </dd>
                </div>
              </dl>

              {report.syncStatus.lastError && (
                <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-xs">
                  <strong>Nota de sincronización:</strong> {report.syncStatus.lastError}
                </div>
              )}

              <p className="text-[11px] text-stone-500 leading-relaxed">
                Cada actualización realizada en <strong>www.youforever.app</strong> o en esta consola consulta únicamente entrevistas y respuestas modificadas desde el último marcador incremental, evitando relecturas masivas innecesarias y fusionando los cambios sin sobrescribir registros locales.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
