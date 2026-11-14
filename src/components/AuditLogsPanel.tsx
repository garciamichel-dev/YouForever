import React, { useState, useEffect } from 'react';
import { Shield, Clock, Search, RefreshCw } from 'lucide-react';
import { AuditLogRecord } from '../server/storage.ts';
import { apiFetch } from '../utils/apiClient.ts';

interface AuditLogsPanelProps {
  adminEmail?: string | null;
}

export const AuditLogsPanel: React.FC<AuditLogsPanelProps> = ({ adminEmail }) => {
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const res = await apiFetch<AuditLogRecord[]>('/api/audit-logs', {
        headers: {
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
        retries: 2,
      });
      if (res.ok && res.data) {
        setLogs(res.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const filteredLogs = logs.filter(
    (l) =>
      l.action.toLowerCase().includes(search.toLowerCase()) ||
      l.targetType.toLowerCase().includes(search.toLowerCase()) ||
      l.performedBy.toLowerCase().includes(search.toLowerCase()) ||
      JSON.stringify(l.details || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold font-serif text-stone-900 flex items-center space-x-2">
            <Shield className="w-5 h-5 text-amber-700" />
            <span>Bitácora de Auditoría y Seguridad</span>
          </h2>
          <p className="text-sm text-stone-500">
            Registro cronológico inmutable de acciones administrativas, cambios de reglas y evaluaciones de IA.
          </p>
        </div>

        <button
          onClick={fetchLogs}
          className="inline-flex items-center space-x-1 px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg text-xs font-semibold transition"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Actualizar Bitácora</span>
        </button>
      </div>

      <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm flex items-center">
        <Search className="w-4 h-4 text-stone-400 mr-2" />
        <input
          type="text"
          placeholder="Buscar eventos por acción, entidad o autor..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full text-xs text-stone-900 focus:outline-none"
        />
      </div>

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-stone-200 text-left text-xs">
            <thead className="bg-stone-50 text-stone-600 font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Fecha y Hora</th>
                <th className="px-4 py-3">Acción</th>
                <th className="px-4 py-3">Entidad / Objetivo</th>
                <th className="px-4 py-3">Ejecutado Por</th>
                <th className="px-4 py-3">Detalles</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 bg-white">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-stone-500">
                    No hay registros de auditoría disponibles.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((l) => (
                  <tr key={l.id} className="hover:bg-stone-50/70">
                    <td className="px-4 py-3 whitespace-nowrap text-stone-500">
                      {new Date(l.timestamp).toLocaleString('es-MX')}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-mono font-semibold text-stone-800">
                      <span className="bg-stone-100 px-2 py-0.5 rounded text-[11px]">
                        {l.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-stone-700">
                      <span className="capitalize">{l.targetType}</span>:{' '}
                      <code className="text-[10px] text-stone-500">{l.targetId}</code>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-stone-700 font-medium">
                      {l.performedBy}
                    </td>
                    <td className="px-4 py-3 max-w-md text-[11px] text-stone-600">
                      {l.details ? (
                        <div className="space-y-1">
                          {Boolean((l.details as any).internalReasonCode) && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-950 font-mono font-bold text-[10px]">
                                {String((l.details as any).internalReasonCode)}
                              </span>
                              {Boolean((l.details as any).diagnosticSummary) && (
                                <span className="text-amber-900 font-medium text-[11px]">
                                  {String((l.details as any).diagnosticSummary)}
                                </span>
                              )}
                            </div>
                          )}
                          <div className="font-mono text-[10px] text-stone-500 truncate">
                            {JSON.stringify(l.details)}
                          </div>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
