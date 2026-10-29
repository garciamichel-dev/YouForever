import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Copy,
  Check,
  Download,
  ArrowLeft,
  Clock,
  Shield,
  Filter,
  Sparkles,
  RefreshCw,
  Camera,
  Search,
  X,
  Archive,
  FileText,
  ExternalLink,
  Eye,
} from 'lucide-react';
import { ManuscriptRecord } from '../server/storage.ts';
import { AnswerPhotoAttachment } from '../logic/interviewRules.ts';
import { apiFetch } from '../utils/apiClient.ts';


interface EnrichedManuscript extends ManuscriptRecord {
  interviewTitle?: string;
  storyMode?: 'individual' | 'compartida';
  photos?: AnswerPhotoAttachment[];
}

interface ManuscriptsViewProps {
  interviewId: string | null;
  adminEmail?: string | null;
  onBack: () => void;
  onSelectInterview?: (interviewId: string | null) => void;
}

export const ManuscriptsView: React.FC<ManuscriptsViewProps> = ({
  interviewId,
  adminEmail,
  onBack,
  onSelectInterview,
}) => {
  const [manuscripts, setManuscripts] = useState<EnrichedManuscript[]>([]);
  const [selectedManuscript, setSelectedManuscript] = useState<EnrichedManuscript | null>(null);
  const [filterInterviewId, setFilterInterviewId] = useState<string>(interviewId || 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [activeViewMode, setActiveViewMode] = useState<'book' | 'qa'>('book');
  const [qaHtmlBlobUrl, setQaHtmlBlobUrl] = useState<string | null>(null);
  const [loadingQa, setLoadingQa] = useState(false);

  const fetchAllManuscripts = async (preferredInterviewId?: string | null) => {
    try {
      setLoading(true);
      const res = await apiFetch<EnrichedManuscript[]>('/api/manuscripts', {
        headers: {
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
        retries: 2,
      });
      if (res.ok && Array.isArray(res.data)) {
        const allList: EnrichedManuscript[] = res.data;
        setManuscripts(allList);

        const targetIntId = preferredInterviewId !== undefined ? preferredInterviewId : interviewId;
        if (targetIntId) {
          setFilterInterviewId(targetIntId);
          const matching = allList.filter((m) => m.interviewId === targetIntId);
          if (matching.length > 0) {
            setSelectedManuscript(matching[0]);
          } else if (allList.length > 0) {
            setSelectedManuscript(allList[0]);
          } else {
            setSelectedManuscript(null);
          }
        } else {
          setFilterInterviewId('all');
          setSelectedManuscript(allList.length > 0 ? allList[0] : null);
        }
      }
    } catch (err) {
      console.error('Error fetching manuscripts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllManuscripts(interviewId);
  }, [interviewId, adminEmail]);

  const handleFilterChange = (newFilterId: string) => {
    setFilterInterviewId(newFilterId);
    if (onSelectInterview) {
      onSelectInterview(newFilterId === 'all' ? null : newFilterId);
    }
    const filtered =
      newFilterId === 'all'
        ? manuscripts
        : manuscripts.filter((m) => m.interviewId === newFilterId);
    if (filtered.length > 0) {
      setSelectedManuscript(filtered[0]);
    } else {
      setSelectedManuscript(null);
    }
  };

  const handleRecompileSelected = async () => {
    const targetInterviewId =
      filterInterviewId !== 'all' ? filterInterviewId : selectedManuscript?.interviewId;
    if (!targetInterviewId) return;

    try {
      setCompiling(true);
      const res = await fetch(`/api/interviews/${targetInterviewId}/manuscript`, {
        method: 'POST',
        headers: {
          'x-admin-user': adminEmail || '',
        },
      });
      const data = await res.json();
      if (data.success) {
        await fetchAllManuscripts(targetInterviewId);
      }
    } catch (err) {
      console.error('Error compiling manuscript:', err);
    } finally {
      setCompiling(false);
    }
  };

  const handleCopy = () => {
    if (!selectedManuscript) return;
    navigator.clipboard.writeText(selectedManuscript.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const handleDownloadMarkdown = () => {
    if (!selectedManuscript) return;
    const blob = new Blob([selectedManuscript.content], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `${selectedManuscript.title.replace(/\s+/g, '_')}_v${selectedManuscript.version}.md`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownload = handleDownloadMarkdown;

  const handleDownloadZip = async () => {
    if (!selectedManuscript) return;
    try {
      setDownloadingZip(true);
      const res = await fetch(`/api/interviews/${selectedManuscript.interviewId}/backup/zip`, {
        headers: { 'x-admin-user': adminEmail || '' },
      });
      if (!res.ok) throw new Error('Error al generar el respaldo ZIP');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const contentDisposition = res.headers.get('content-disposition');
      let filename = `respaldo_legado_${selectedManuscript.interviewId}.zip`;
      if (contentDisposition && contentDisposition.includes('filename="')) {
        filename = contentDisposition.split('filename="')[1].split('"')[0];
      }
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading backup zip:', err);
      alert('No se pudo generar el archivo de respaldo ZIP.');
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleDownloadBookHtml = () => {
    if (!selectedManuscript) return;
    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${selectedManuscript.title} - Libro Biográfico de Legado</title>
  <style>
    body { font-family: Georgia, Cambria, serif; max-width: 800px; margin: 40px auto; padding: 24px; line-height: 1.8; color: #1c1917; background: #fffdfa; }
    h1 { font-size: 2.2rem; color: #92400e; text-align: center; margin-bottom: 0.5rem; }
    h2 { font-size: 1.5rem; color: #b45309; border-bottom: 2px solid #fef3c7; padding-bottom: 6px; margin-top: 2rem; }
    h3 { font-size: 1.2rem; color: #44403c; margin-top: 1.5rem; }
    blockquote { border-left: 4px solid #b45309; padding-left: 1rem; color: #4b5563; font-style: italic; margin: 1rem 0; }
    img { max-width: 100%; height: auto; border-radius: 8px; margin: 1rem 0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
    .print-btn { background: #b45309; color: #fff; padding: 8px 16px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; float: right; }
    @media print { .print-btn { display: none; } }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">Imprimir Libro</button>
  <div class="content">
    ${selectedManuscript.content
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
      .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*)\*/gim, '<em>$1</em>')
      .replace(/!\[(.*?)\]\((.*?)\)/gim, '<figure><img src="$2" alt="$1"><figcaption style="font-size:0.85rem;color:#78716c;margin-top:4px;">$1</figcaption></figure>')
      .replace(/\n$/gim, '<br />')}
  </div>
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${selectedManuscript.title.replace(/\s+/g, '_')}_libro.html`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadQaHtml = () => {
    if (!selectedManuscript) return;
    const adminParam = adminEmail ? `&admin=${encodeURIComponent(adminEmail)}` : '';
    window.open(`/api/interviews/${selectedManuscript.interviewId}/backup/qa-html?download=true${adminParam}`, '_blank');
  };

  const handleDownloadQaMarkdown = () => {
    if (!selectedManuscript) return;
    const adminParam = adminEmail ? `?admin=${encodeURIComponent(adminEmail)}` : '';
    window.open(`/api/interviews/${selectedManuscript.interviewId}/backup/qa-markdown${adminParam}`, '_blank');
  };

  const loadQaPreview = async (interviewId: string) => {
    try {
      setLoadingQa(true);
      const res = await fetch(`/api/interviews/${interviewId}/backup/qa-html`, {
        headers: { 'x-admin-user': adminEmail || '' },
      });
      if (res.ok) {
        const text = await res.text();
        const blob = new Blob([text], { type: 'text/html;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        setQaHtmlBlobUrl(url);
      }
    } catch (err) {
      console.error('Error loading QA preview:', err);
    } finally {
      setLoadingQa(false);
    }
  };

  // Unique interviews represented in manuscripts
  const uniqueInterviews = Array.from(
    new Map<string, string>(
      manuscripts.map((m) => [m.interviewId, m.interviewTitle || m.title])
    ).entries()
  );

  const displayedManuscripts = manuscripts
    .filter((m) => filterInterviewId === 'all' || m.interviewId === filterInterviewId)
    .filter((m) => {
      if (!searchQuery.trim()) return true;
      const term = searchQuery.toLowerCase().trim();
      const matchTitle = (m.title || '').toLowerCase().includes(term);
      const matchInterviewTitle = (m.interviewTitle || '').toLowerCase().includes(term);
      const matchAuthor = (m.generatedBy || '').toLowerCase().includes(term);
      const matchSummary = (m.summary || '').toLowerCase().includes(term);
      const matchContent = (m.content || '').toLowerCase().includes(term);
      const matchPhotos = (m.photos || []).some((p) =>
        (p.caption || p.fileName || '').toLowerCase().includes(term)
      );
      return matchTitle || matchInterviewTitle || matchAuthor || matchSummary || matchContent || matchPhotos;
    });

  // Keep selected manuscript synced with filtered list
  useEffect(() => {
    if (displayedManuscripts.length > 0) {
      if (!selectedManuscript || !displayedManuscripts.some((m) => m.id === selectedManuscript.id)) {
        setSelectedManuscript(displayedManuscripts[0]);
      }
    } else {
      setSelectedManuscript(null);
    }
  }, [displayedManuscripts, selectedManuscript]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="bg-white p-4 sm:p-5 rounded-xl border border-stone-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={onBack}
            className="inline-flex items-center space-x-1.5 text-xs text-stone-600 hover:text-stone-900 transition font-medium bg-stone-100 hover:bg-stone-200 px-3 py-1.5 rounded-lg"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Panel de Entrevistas</span>
          </button>

          {uniqueInterviews.length > 0 && (
            <div className="flex items-center space-x-2 text-xs">
              <Filter className="w-3.5 h-3.5 text-stone-400" />
              <select
                value={filterInterviewId}
                onChange={(e) => handleFilterChange(e.target.value)}
                className="px-2.5 py-1.5 border border-stone-300 rounded-lg text-xs text-stone-800 bg-white focus:outline-none focus:ring-2 focus:ring-amber-200"
              >
                <option value="all">Todas las historias ({manuscripts.length} versiones)</option>
                {uniqueInterviews.map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={() => fetchAllManuscripts(filterInterviewId === 'all' ? null : filterInterviewId)}
            className="inline-flex items-center space-x-1 px-2.5 py-1.5 text-xs text-stone-600 hover:text-stone-900 border border-stone-200 rounded-lg hover:bg-stone-50 transition"
            title="Sincronizar con la base de datos Firestore"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-amber-600' : ''}`} />
            <span>Actualizar</span>
          </button>
        </div>

        {selectedManuscript && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Descargar Respaldo Completo ZIP (Libro + Compilado Q&A + Audios + Fotos + JSON) */}
            <button
              onClick={handleDownloadZip}
              disabled={downloadingZip}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-50"
              title="Descargar paquete completo ZIP: Libro biográfico, compilado de preguntas y respuestas, audios de voz originales y fotografías"
            >
              {downloadingZip ? (
                <>
                  <Clock className="w-3.5 h-3.5 animate-spin text-amber-700" />
                  <span>Preparando ZIP...</span>
                </>
              ) : (
                <>
                  <Archive className="w-3.5 h-3.5 text-amber-700" />
                  <span>Descargar Respaldo (ZIP)</span>
                </>
              )}
            </button>

            <button
              onClick={handleRecompileSelected}
              disabled={compiling}
              className="inline-flex items-center space-x-1 px-3 py-1.5 bg-white hover:bg-stone-50 text-stone-700 border border-stone-200 rounded-lg text-xs font-semibold transition disabled:opacity-50"
              title="Generar una nueva versión del manuscrito con los testimonios más recientes"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-700" />
              <span>{compiling ? 'Compilando...' : 'Recompilar'}</span>
            </button>

            <button
              onClick={handleCopy}
              className="inline-flex items-center space-x-1 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg text-xs font-semibold transition"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-emerald-700">Copiado</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-stone-500" />
                  <span>Copiar MD</span>
                </>
              )}
            </button>

            <button
              onClick={handleDownload}
              className="inline-flex items-center space-x-1 px-3 py-1.5 bg-stone-700 hover:bg-stone-800 text-white rounded-lg text-xs font-semibold transition"
              title="Descargar el libro biográfico en formato Markdown"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Libro .md</span>
            </button>

            <button
              onClick={handleDownloadBookHtml}
              className="inline-flex items-center space-x-1 px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-semibold transition"
              title="Descargar el libro biográfico en formato HTML para imprimir o ver fuera de línea"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Libro .html</span>
            </button>
          </div>
        )}
      </div>

      {/* Search and Filters Bar */}
      <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3 top-3 text-stone-400" />
          <input
            type="text"
            placeholder="Buscar por nombre, apellido, título o contenido..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 border border-stone-300 rounded-lg text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-600"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2.5 text-stone-400 hover:text-stone-700 p-0.5 rounded transition"
              title="Limpiar búsqueda"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center space-x-3 text-xs text-stone-500 shrink-0 w-full md:w-auto justify-between md:justify-end">
          {searchQuery.trim() ? (
            <div className="flex items-center space-x-2">
              <span className="bg-amber-50 text-amber-900 border border-amber-200 px-2.5 py-1 rounded-md font-semibold">
                {displayedManuscripts.length} {displayedManuscripts.length === 1 ? 'coincidencia' : 'coincidencias'} para «{searchQuery}»
              </span>
              <button
                onClick={() => setSearchQuery('')}
                className="text-amber-800 hover:underline text-[11px] font-medium"
              >
                Limpiar
              </button>
            </div>
          ) : (
            <span className="text-stone-500 font-medium">
              {displayedManuscripts.length} {displayedManuscripts.length === 1 ? 'borrador disponible' : 'borradores disponibles'}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="bg-white p-12 text-center rounded-xl border border-stone-200 text-stone-500">
          <Clock className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-600" />
          <p>Cargando manuscritos guardados en la base de datos...</p>
        </div>
      ) : displayedManuscripts.length === 0 ? (
        <div className="bg-white p-12 text-center rounded-xl border border-stone-200 text-stone-500 space-y-3">
          <BookOpen className="w-8 h-8 mx-auto text-stone-400 mb-2" />
          <p className="font-serif text-base font-semibold text-stone-800">
            {searchQuery.trim()
              ? `No se encontraron manuscritos para «${searchQuery}»`
              : filterInterviewId !== 'all'
              ? 'Aún no se ha compilado ningún manuscrito para esta entrevista.'
              : 'Aún no hay manuscritos compilados en la base de datos.'}
          </p>
          <p className="text-xs text-stone-500 max-w-md mx-auto">
            {searchQuery.trim()
              ? 'Intenta con otro término de búsqueda o limpia el filtro para ver todos los borradores.'
              : 'Puedes hacer clic en «Generar Manuscrito» desde el panel de Gestión de Entrevistas para que el sistema compile y guarde permanentemente el borrador fidedigno.'}
          </p>
          {searchQuery.trim() ? (
            <div className="pt-2">
              <button
                onClick={() => setSearchQuery('')}
                className="inline-flex items-center space-x-1.5 px-4 py-2 bg-stone-800 hover:bg-stone-900 text-white rounded-lg text-xs font-semibold transition"
              >
                <X className="w-3.5 h-3.5" />
                <span>Limpiar Búsqueda</span>
              </button>
            </div>
          ) : filterInterviewId !== 'all' && (
            <div className="pt-2 flex items-center justify-center gap-3">
              <button
                onClick={handleRecompileSelected}
                disabled={compiling}
                className="inline-flex items-center space-x-1.5 px-4 py-2 bg-stone-800 hover:bg-stone-900 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>{compiling ? 'Compilando...' : 'Generar Manuscrito Ahora'}</span>
              </button>
              {manuscripts.length > 0 && (
                <button
                  onClick={() => handleFilterChange('all')}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg text-xs font-semibold transition"
                >
                  <span>Ver todos los manuscritos guardados ({manuscripts.length})</span>
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Versions Sidebar */}
          <div className="md:col-span-1 space-y-3">
            <h4 className="text-xs font-bold text-stone-600 uppercase tracking-wide">
              Manuscritos Guardados ({displayedManuscripts.length})
            </h4>
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {displayedManuscripts.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedManuscript(m)}
                  className={`w-full text-left p-3 rounded-lg border text-xs transition ${
                    selectedManuscript?.id === m.id
                      ? 'bg-amber-50 border-amber-300 text-amber-900 font-semibold shadow-xs'
                      : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  <div className="font-serif font-bold text-stone-900 truncate mb-1">
                    {m.interviewTitle || m.title}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-700 text-[10px] font-semibold">
                      Versión {m.version}
                    </span>
                    <div className="flex items-center space-x-1.5">
                      {m.photos && m.photos.length > 0 && (
                        <span className="inline-flex items-center space-x-0.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-semibold">
                          <Camera className="w-2.5 h-2.5 mr-0.5" />
                          <span>{m.photos.length}</span>
                        </span>
                      )}
                      <span className="text-[10px] text-stone-400">
                        {new Date(m.generatedAt).toLocaleDateString('es-MX', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] text-stone-500 mt-1 truncate">
                    Por: {m.generatedBy}
                  </div>
                </button>
              ))}
            </div>

            {/* Fidelity ethical badge */}
            <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 text-[11px] text-stone-600 space-y-1">
              <div className="flex items-center space-x-1.5 text-stone-800 font-semibold">
                <Shield className="w-3.5 h-3.5 text-emerald-600" />
                <span>Respaldo Permanente Firestore</span>
              </div>
              <p>
                Todos los manuscritos, fotografías y versiones se conservan de forma permanente en la base de datos y respetan íntegramente las perspectivas de cada participante.
              </p>
            </div>
          </div>

          {/* Manuscript Content Reader */}
          <div className="md:col-span-3 bg-white p-8 rounded-xl border border-stone-200 shadow-sm space-y-6">
            {selectedManuscript && (
              <>
                {/* Mode Switcher Tabs */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-stone-200">
                  <div className="inline-flex rounded-lg bg-stone-100 p-1 border border-stone-200">
                    <button
                      type="button"
                      onClick={() => setActiveViewMode('book')}
                      className={`inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-md text-xs font-semibold transition ${
                        activeViewMode === 'book'
                          ? 'bg-white text-stone-900 shadow-xs border border-stone-200/80'
                          : 'text-stone-600 hover:text-stone-900'
                      }`}
                    >
                      <BookOpen className="w-3.5 h-3.5 text-amber-700" />
                      <span>Libro Biográfico y Legado</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveViewMode('qa')}
                      className={`inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-md text-xs font-semibold transition ${
                        activeViewMode === 'qa'
                          ? 'bg-white text-stone-900 shadow-xs border border-stone-200/80'
                          : 'text-stone-600 hover:text-stone-900'
                      }`}
                    >
                      <Archive className="w-3.5 h-3.5 text-amber-700" />
                      <span>Compilado Testimonial (Preguntas, Respuestas, Audios y Fotos)</span>
                    </button>
                  </div>

                  {/* Mode-specific Quick Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    {activeViewMode === 'book' ? (
                      <>
                        <button
                          type="button"
                          onClick={handleDownloadBookHtml}
                          className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-stone-50 hover:bg-stone-100 border border-stone-300 text-stone-700 rounded-lg text-xs font-semibold transition"
                          title="Descargar libro en HTML con diseño editorial para lectura e impresión"
                        >
                          <Download className="w-3 h-3 text-stone-500" />
                          <span>Libro .html</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadMarkdown}
                          className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-stone-50 hover:bg-stone-100 border border-stone-300 text-stone-700 rounded-lg text-xs font-semibold transition"
                          title="Descargar libro en Markdown"
                        >
                          <Download className="w-3 h-3 text-stone-500" />
                          <span>Libro .md</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={handleDownloadQaHtml}
                          className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 rounded-lg text-xs font-semibold transition"
                          title="Descargar dossier interactivo offline de preguntas y respuestas"
                        >
                          <Download className="w-3 h-3 text-amber-700" />
                          <span>Dossier HTML</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadQaMarkdown}
                          className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-stone-50 hover:bg-stone-100 border border-stone-300 text-stone-700 rounded-lg text-xs font-semibold transition"
                          title="Descargar compilado de preguntas y respuestas en Markdown"
                        >
                          <FileText className="w-3 h-3 text-stone-500" />
                          <span>Compilado .md</span>
                        </button>
                        <a
                          href={`/api/interviews/${selectedManuscript.interviewId}/backup/qa-html?admin=${encodeURIComponent(adminEmail || '')}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg text-xs font-semibold transition"
                          title="Abrir dossier de preguntas y respuestas en una pestaña completa"
                        >
                          <ExternalLink className="w-3 h-3 text-stone-500" />
                          <span>Abrir pestaña</span>
                        </a>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={handleDownloadZip}
                      disabled={downloadingZip}
                      className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-amber-800 hover:bg-amber-900 text-white rounded-lg text-xs font-semibold transition shadow-xs disabled:opacity-50"
                      title="Descargar respaldo ZIP con libro completo, compilado Q&A, audios de voz originales y fotografías"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      <span>{downloadingZip ? 'Generando ZIP...' : 'Descargar Respaldo (ZIP)'}</span>
                    </button>
                  </div>
                </div>

                {activeViewMode === 'book' ? (
                  <>
                    <div className="border-b border-stone-200 pb-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500 mb-1">
                        <span className="font-semibold text-amber-800">
                          {selectedManuscript.interviewTitle || selectedManuscript.title}
                        </span>
                        <span>•</span>
                        <span>Versión {selectedManuscript.version}</span>
                        <span>•</span>
                        <span>
                          Compilado el {new Date(selectedManuscript.generatedAt).toLocaleString('es-MX')}
                        </span>
                        {selectedManuscript.photos && selectedManuscript.photos.length > 0 && (
                          <>
                            <span>•</span>
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-semibold">
                              <Camera className="w-3 h-3" />
                              <span>
                                {selectedManuscript.photos.length}{' '}
                                {selectedManuscript.photos.length === 1
                                  ? 'fotografía integrada'
                                  : 'fotografías integradas'}
                              </span>
                            </span>
                          </>
                        )}
                      </div>
                      <h1 className="font-serif text-2xl font-bold text-stone-900">
                        {selectedManuscript.title}
                      </h1>
                      {selectedManuscript.summary && (
                        <p className="mt-2 text-sm text-stone-600 italic bg-amber-50/50 p-3 rounded-lg border border-amber-100">
                          «{selectedManuscript.summary}»
                        </p>
                      )}
                    </div>

                    {/* Rich Editorial Renderer with Inline Archival Photographs */}
                    <div className="space-y-4 font-serif text-stone-800 leading-relaxed">
                      {selectedManuscript.content.split('\n').map((rawLine, idx, allLines) => {
                        const line = rawLine.trim();
                        if (!line) {
                          return <div key={idx} className="h-1" />;
                        }

                        // 1. Check for Markdown Image: ![altText](url)
                        const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
                        if (imgMatch) {
                          const altRaw = imgMatch[1] || '';
                          const imgUrl = imgMatch[2] || '';
                          const matchedPhoto = (selectedManuscript.photos || []).find(
                            (p) => imgUrl.includes(p.id) || p.imageUrl === imgUrl
                          );
                          const displayCaption =
                            matchedPhoto?.caption || altRaw.split('|')[0]?.trim() || altRaw;
                          const displayAuthor = matchedPhoto?.participantName || '';
                          const displayQuestion = matchedPhoto?.questionText || '';
                          const displayStage = matchedPhoto?.lifeStage
                            ? matchedPhoto.lifeStage.replace(/_/g, ' ')
                            : '';

                          return (
                            <figure
                              key={idx}
                              className="my-6 bg-stone-50 rounded-2xl border border-stone-200 overflow-hidden shadow-xs"
                            >
                              <div className="bg-stone-900/5 p-4 flex items-center justify-center">
                                <img
                                  src={imgUrl}
                                  alt={displayCaption}
                                  className="max-h-96 w-auto rounded-lg shadow-sm border border-stone-200 object-contain bg-white"
                                />
                              </div>
                              <figcaption className="p-4 border-t border-stone-200 space-y-1.5 font-sans">
                                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-amber-900 font-semibold">
                                  <span className="inline-flex items-center space-x-1">
                                    <Camera className="w-3.5 h-3.5 text-amber-700" />
                                    <span>Memoria Fotográfica en este Capítulo</span>
                                  </span>
                                  <div className="flex items-center gap-2 text-stone-500">
                                    {displayStage && (
                                      <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 capitalize text-[10px]">
                                        Etapa: {displayStage}
                                      </span>
                                    )}
                                    {displayAuthor && (
                                      <span className="text-[11px] text-stone-600">
                                        Aportada por: <strong>{displayAuthor}</strong>
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <p className="text-xs sm:text-sm text-stone-800 italic font-serif leading-relaxed">
                                  «{displayCaption}»
                                </p>
                                {displayQuestion && (
                                  <p className="text-[11px] text-stone-500">
                                    Relacionada con la pregunta: <em>{displayQuestion}</em>
                                  </p>
                                )}
                              </figcaption>
                            </figure>
                          );
                        }

                        // Skip redundant italic caption line immediately following an image block
                        if (
                          idx > 0 &&
                          /^!\[([^\]]*)\]\(([^)]+)\)$/.test(allLines[idx - 1].trim()) &&
                          line.startsWith('*Fotografía relacionada con')
                        ) {
                          return null;
                        }

                        // 2. Headings
                        if (line.startsWith('# ')) {
                          return (
                            <h2
                              key={idx}
                              className="text-2xl font-bold text-stone-900 pt-2 pb-1 border-b border-stone-200"
                            >
                              {line.replace(/^#\s+/, '')}
                            </h2>
                          );
                        }
                        if (line.startsWith('## ')) {
                          return (
                            <h3
                              key={idx}
                              className="text-xl font-bold text-amber-950 pt-5 pb-1 border-b border-amber-200/70"
                            >
                              {line.replace(/^##\s+/, '')}
                            </h3>
                          );
                        }
                        if (line.startsWith('### ')) {
                          return (
                            <h4 key={idx} className="text-base font-bold text-stone-800 pt-3">
                              {line.replace(/^###\s+/, '')}
                            </h4>
                          );
                        }

                        // 3. Blockquotes
                        if (line.startsWith('>')) {
                          return (
                            <blockquote
                              key={idx}
                              className="pl-4 py-2 border-l-4 border-amber-400 bg-amber-50/40 rounded-r-lg italic text-stone-800 text-sm"
                            >
                              {line.replace(/^>\s*/, '')}
                            </blockquote>
                          );
                        }

                        // 4. Bullet points
                        if (line.startsWith('- ')) {
                          return (
                            <li key={idx} className="ml-5 list-disc text-sm text-stone-800">
                              {line.replace(/^-\s+/, '')}
                            </li>
                          );
                        }

                        // 5. Regular narrative paragraph
                        return (
                          <p key={idx} className="text-sm text-stone-800 leading-relaxed">
                            {line}
                          </p>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="space-y-4">
                    {/* Q&A Dossier View Container */}
                    <div className="p-4 bg-amber-50/80 rounded-xl border border-amber-200 text-xs text-amber-950 flex items-start space-x-3">
                      <Archive className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold text-stone-900 text-sm mb-1">
                          Compilado Testimonial Fidedigno (Preguntas, Respuestas, Audios y Fotos)
                        </div>
                        <p className="text-stone-700 leading-relaxed">
                          Este respaldo contiene el registro íntegro de cada pregunta formulada, las respuestas literales dadas por el entrevistado y participantes, las fotografías adjuntadas y los reproductores interactivos de cada nota de voz grabada. Puede reproducir los audios directamente aquí, descargar el Dossier HTML autónomo (funciona sin conexión a internet) o descargar el paquete ZIP con todos los archivos de audio y fotos en sus formatos originales.
                        </p>
                      </div>
                    </div>

                    <div className="border border-stone-200 rounded-xl overflow-hidden shadow-xs bg-white">
                      <iframe
                        src={`/api/interviews/${selectedManuscript.interviewId}/backup/qa-html?admin=${encodeURIComponent(adminEmail || '')}`}
                        title="Compilado de Preguntas y Respuestas con Audios y Fotografías"
                        className="w-full h-[760px] border-0"
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
