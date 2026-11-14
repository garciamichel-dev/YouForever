import JSZip from 'jszip';
import {
  InterviewRecord,
  ParticipantRecord,
  QuestionRecord,
  AnswerRecord,
  InterviewPhotoRecord,
  InterviewAudioRecord,
} from '../logic/interviewRules.ts';
import { ManuscriptRecord } from './storage.ts';

interface StorageReader {
  getInterview(interviewId: string): InterviewRecord | undefined;
  getParticipantsForInterview(interviewId: string): ParticipantRecord[];
  getAnswersForInterview(interviewId: string): AnswerRecord[];
  getQuestionsForVersion(versionId: string): QuestionRecord[];
  getPhotosForInterview(interviewId: string): InterviewPhotoRecord[];
  getAudiosForInterview(interviewId: string): InterviewAudioRecord[];
  getManuscriptsForInterview(interviewId: string): ManuscriptRecord[];
}

const STAGE_LABELS: Record<string, string> = {
  infancia: 'Infancia y Raíces Familiares',
  juventud: 'Juventud, Vocación y Primeros Desafíos',
  adultez: 'Adultez, Familia, Pareja e Hijos',
  madurez: 'Madurez, Trayectoria y Aprendizajes',
  legado_general: 'Valores, Filosofía de Vida y Legado Trascendente',
  general: 'Compilación Testimonial',
};

/**
 * Extracts binary Buffer and clean extension from a Base64 data URL string.
 */
function decodeDataUrlToBuffer(
  dataUrl: string | undefined | null,
  fallbackMime: string = 'application/octet-stream'
): { buffer: Buffer; mime: string; ext: string } {
  let mime = fallbackMime || 'application/octet-stream';
  const rawStr = typeof dataUrl === 'string' ? dataUrl.trim() : '';
  let base64Part = rawStr;

  if (!rawStr || rawStr.startsWith('/') || rawStr.startsWith('http')) {
    base64Part = '';
  } else if (rawStr.startsWith('data:')) {
    const commaIdx = rawStr.indexOf(',');
    if (commaIdx !== -1) {
      const header = rawStr.substring(0, commaIdx);
      const mimeMatch = header.match(/^data:([^;]+)/);
      if (mimeMatch && mimeMatch[1]) {
        mime = mimeMatch[1];
      }
      base64Part = rawStr.substring(commaIdx + 1);
    }
  }

  const cleanBase64 = base64Part.replace(/\s+/g, '');
  let buffer: Buffer;
  try {
    buffer = cleanBase64 ? Buffer.from(cleanBase64, 'base64') : Buffer.alloc(0);
  } catch {
    buffer = Buffer.alloc(0);
  }

  let ext = 'bin';
  if (mime.includes('webm')) ext = 'webm';
  else if (mime.includes('mp4') || mime.includes('m4a')) ext = 'm4a';
  else if (mime.includes('ogg')) ext = 'ogg';
  else if (mime.includes('wav')) ext = 'wav';
  else if (mime.includes('mpeg') || mime.includes('mp3')) ext = 'mp3';
  else if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';
  else if (mime.includes('png')) ext = 'png';
  else if (mime.includes('webp')) ext = 'webp';

  return { buffer, mime, ext };
}

/**
 * Generates the complete Markdown dossier of all Questions and Answers as answered by the interviewee.
 */
export function generateQACompilationMarkdown(params: {
  interview: InterviewRecord;
  participants: ParticipantRecord[];
  questions: QuestionRecord[];
  answers: AnswerRecord[];
  photos: InterviewPhotoRecord[];
  audios: InterviewAudioRecord[];
  audioFileNamesMap?: Map<string, string>;
  photoFileNamesMap?: Map<string, string>;
}): string {
  const {
    interview,
    participants,
    questions,
    answers,
    photos,
    audios,
    audioFileNamesMap,
    photoFileNamesMap,
  } = params;

  const questionMap = new Map(questions.map((q) => [q.id, q]));
  const photoMap = new Map(photos.map((p) => [p.id, p]));
  const audioMap = new Map(audios.map((a) => [a.id, a]));

  const activeAnswerPhotosCount = answers.reduce(
    (sum, a) => sum + (Array.isArray(a.photos) ? a.photos.filter(Boolean).length : 0),
    0
  );

  const lines: string[] = [
    `# COMPILADO TESTIMONIAL DE PREGUNTAS Y RESPUESTAS`,
    `## Respaldo Integral y Fidedigno del Entrevistado`,
    `\n---\n`,
    `* **Título de la obra:** ${interview.title}`,
    `* **Modalidad:** ${interview.storyMode === 'compartida' ? 'Historia Compartida' : 'Historia Individual'}`,
    `* **Fecha de generación de respaldo:** ${new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
    `* **Participantes registrados:** ${participants.map((p) => `${p.name} (${p.relationship})`).join(', ')}`,
    `* **Total de respuestas archivadas:** ${answers.length}`,
    `* **Total de fotografías adjuntas:** ${activeAnswerPhotosCount}`,
    `* **Total de notas de voz registradas:** ${audios.length}`,
    `\n---\n`,
    `## Índice de Contenidos Testimoniales`,
  ];

  // Group answers by life stage
  const stageGroups: Record<string, AnswerRecord[]> = {};
  for (const ans of answers) {
    const q = questionMap.get(ans.questionId);
    const parentQ = ans.parentQuestionId ? questionMap.get(ans.parentQuestionId) : undefined;
    const stage = q?.lifeStage || parentQ?.lifeStage || 'legado_general';
    if (!stageGroups[stage]) stageGroups[stage] = [];
    stageGroups[stage].push(ans);
  }

  const stagesOrder = ['infancia', 'juventud', 'adultez', 'madurez', 'legado_general'];
  for (const stageKey of stagesOrder) {
    const group = stageGroups[stageKey];
    if (group && group.length > 0) {
      lines.push(`* [${STAGE_LABELS[stageKey] || stageKey}](#etapa-${stageKey}) (${group.length} testimonios)`);
    }
  }

  lines.push(`\n---\n`);

  // Render each stage and question
  let globalItemIndex = 1;

  for (const stageKey of stagesOrder) {
    const group = stageGroups[stageKey];
    if (!group || group.length === 0) continue;

    lines.push(`\n<a id="etapa-${stageKey}"></a>`);
    lines.push(`## Etapa: ${STAGE_LABELS[stageKey] || stageKey}\n`);

    for (const ans of group) {
      const q = questionMap.get(ans.questionId);
      const questionText = ans.questionText || q?.text || 'Pregunta de entrevista';
      const topic = q?.topic || 'tema_general';

      let typeBadge = 'Pregunta Principal';
      if (ans.isFollowUp) typeBadge = 'Profundización Autónoma (IA)';
      else if (ans.isAdditionalMemory) typeBadge = 'Información Adicional Libre';
      else if (ans.branchChoice) typeBadge = `Ramificación Condicional (${ans.branchChoice === 'yes' ? 'Sí' : 'No'})`;

      lines.push(`### #${globalItemIndex}. ${questionText}`);
      lines.push(`* **Tema:** \`${topic}\` | **Tipo:** *${typeBadge}* | **Autor:** **${ans.participantName}**`);
      lines.push(`* **Fecha de respuesta:** ${new Date(ans.createdAt).toLocaleString('es-ES')}`);
      lines.push('');

      if (ans.notRecalled) {
        lines.push(`> *El participante indicó formalmente: «No lo recuerdo».*`);
      } else if (ans.answerText && String(ans.answerText).trim().length > 0) {
        lines.push(`**Respuesta textual:**`);
        lines.push(`> "${String(ans.answerText).replace(/\n/g, '\n> ')}"`);
      } else {
        lines.push(`> *(Sin texto escrito)*`);
      }
      lines.push('');

      // Transcripciones de grabaciones de voz (sin insertar archivos ni enlaces de audio)
      const voiceList = (ans.audioRecordings && ans.audioRecordings.length > 0)
        ? ans.audioRecordings
        : ans.audio
        ? [ans.audio]
        : [];

      if (voiceList.length > 0) {
        const transcriptions = voiceList
          .map((audioItem) => {
            if (!audioItem) return '';
            const storedAudio = audioMap.get(audioItem.id) || audioItem;
            return String(audioItem.transcription || storedAudio?.transcription || '').trim();
          })
          .filter((t) => t.length > 0);

        if (transcriptions.length > 0) {
          lines.push(`#### Transcripciones de Voz (${transcriptions.length}):`);
          transcriptions.forEach((tr, aIdx) => {
            lines.push(`* **Transcripción de voz #${aIdx + 1}:** "${tr}"`);
          });
          lines.push('');
        }
      }

      // Photographs actively attached to this answer
      const combinedPhotos = Array.isArray(ans.photos) ? ans.photos.filter(Boolean) : [];

      if (combinedPhotos.length > 0) {
        lines.push(`#### Fotografías Adjuntas (${combinedPhotos.length}):`);
        combinedPhotos.forEach((photoItem, pIdx) => {
          const storedPhoto = (photoItem?.id ? photoMap.get(photoItem.id) : undefined) || photoItem;
          const fileName =
            (storedPhoto?.id && photoFileNamesMap?.get(storedPhoto.id)) ||
            (storedPhoto as any)?.dataUrl ||
            storedPhoto?.imageUrl ||
            `fotos/${storedPhoto?.id || pIdx + 1}.jpg`;
          const captionText = String(storedPhoto?.caption || photoItem?.caption || 'Sin descripción registrada').trim();
          lines.push(`* **Fotografía #${pIdx + 1}:**`);
          lines.push(`  * **Descripción de fotografía:** *«${captionText}»*`);
          lines.push(`  * ![Fotografía #${pIdx + 1} - ${captionText}](${fileName})`);
        });
        lines.push('');
      }

      lines.push(`---`);
      globalItemIndex++;
    }
  }

  lines.push(`\n## Fin del Compilado Testimonial de Respaldo`);
  lines.push(`*Documento generado automáticamente por YouForever.*`);

  return lines.join('\n');
}

/**
 * Generates an interactive, beautiful, self-contained standalone HTML Dossier
 * that works completely offline in any web browser, with embedded audio players and photos.
 */
export function generateQACompilationHtml(params: {
  interview: InterviewRecord;
  participants: ParticipantRecord[];
  questions: QuestionRecord[];
  answers: AnswerRecord[];
  photos: InterviewPhotoRecord[];
  audios: InterviewAudioRecord[];
  audioFileNamesMap?: Map<string, string>;
  photoFileNamesMap?: Map<string, string>;
  adminEmail?: string | null;
}): string {
  const {
    interview,
    participants,
    questions,
    answers,
    photos,
    audios,
    audioFileNamesMap,
    photoFileNamesMap,
    adminEmail,
  } = params;

  const cleanAdminEmail =
    typeof adminEmail === 'string' && adminEmail.trim().length > 0 ? adminEmail.trim() : '';
  const pdfHref = `/api/interviews/${encodeURIComponent(interview.id)}/backup/qa-pdf${
    cleanAdminEmail ? `?admin=${encodeURIComponent(cleanAdminEmail)}` : ''
  }`;

  const questionMap = new Map(questions.map((q) => [q.id, q]));
  const photoMap = new Map(photos.map((p) => [p.id, p]));
  const audioMap = new Map(audios.map((a) => [a.id, a]));

  const stageGroups: Record<string, AnswerRecord[]> = {};
  for (const ans of answers) {
    const q = questionMap.get(ans.questionId);
    const parentQ = ans.parentQuestionId ? questionMap.get(ans.parentQuestionId) : undefined;
    const stage = q?.lifeStage || parentQ?.lifeStage || 'legado_general';
    if (!stageGroups[stage]) stageGroups[stage] = [];
    stageGroups[stage].push(ans);
  }

  const stagesOrder = ['infancia', 'juventud', 'adultez', 'madurez', 'legado_general'];

  const itemsHtml: string[] = [];
  let globalCount = 1;

  for (const stageKey of stagesOrder) {
    const group = stageGroups[stageKey];
    if (!group || group.length === 0) continue;

    itemsHtml.push(`
      <section class="stage-section" id="stage-${stageKey}">
        <div class="stage-header">
          <span class="stage-pill">${STAGE_LABELS[stageKey] || stageKey}</span>
          <span class="stage-count">${group.length} testimonios</span>
        </div>
    `);

    for (const ans of group) {
      const q = questionMap.get(ans.questionId);
      const questionText = ans.questionText || q?.text || 'Pregunta de entrevista';
      const topic = q?.topic || 'tema_general';

      let typeBadge = 'Pregunta Principal';
      let typeClass = 'badge-primary';
      if (ans.isFollowUp) {
        typeBadge = 'Profundización Autónoma';
        typeClass = 'badge-deepening';
      } else if (ans.isAdditionalMemory) {
        typeBadge = 'Información Adicional Libre';
        typeClass = 'badge-additional';
      } else if (ans.branchChoice) {
        typeBadge = `Ramificación (${ans.branchChoice === 'yes' ? 'Sí' : 'No'})`;
        typeClass = 'badge-branch';
      }

      const voiceList = (ans.audioRecordings && ans.audioRecordings.length > 0)
        ? ans.audioRecordings
        : ans.audio
        ? [ans.audio]
        : [];

      itemsHtml.push(`
        <article class="question-card" id="q-${ans.id}">
          <div class="card-meta">
            <span class="question-num">#${globalCount}</span>
            <span class="badge ${typeClass}">${typeBadge}</span>
            <span class="badge badge-topic">${topic}</span>
            <span class="author-tag">Respondido por: <strong>${escapeHtml(ans.participantName)}</strong></span>
            <span class="date-tag">${new Date(ans.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
          </div>

          <h3 class="question-title">${escapeHtml(questionText)}</h3>

          <div class="answer-box ${ans.notRecalled ? 'not-recalled-box' : ''}">
            ${
              ans.notRecalled
                ? `<p class="not-recalled-text"><em>«El participante declaró formalmente no recordar este acontecimiento o detalle.»</em></p>`
                : `<p class="verbatim-text">"${escapeHtml(ans.answerText || '').replace(/\n/g, '<br/>')}"</p>`
            }
          </div>

          ${(() => {
            const transcriptions = voiceList
              .map((voiceItem) => {
                if (!voiceItem) return '';
                const fullAudio = audioMap.get(voiceItem.id) || voiceItem;
                return String(voiceItem.transcription || fullAudio?.transcription || '').trim();
              })
              .filter((t) => t.length > 0);

            if (transcriptions.length === 0) return '';
            return `
              <div class="voice-section">
                <h4 class="media-title">Transcripciones de Grabaciones de Voz (${transcriptions.length})</h4>
                <div class="audios-grid">
                  ${transcriptions
                    .map(
                      (trText, vIdx) => `
                        <div class="audio-item">
                          <div class="transcription-card">
                            <span class="transcription-label">Transcripción de voz #${vIdx + 1}:</span>
                            <p class="transcription-text">«${escapeHtml(trText)}»</p>
                          </div>
                        </div>
                      `
                    )
                    .join('')}
                </div>
              </div>
            `;
          })()}

          ${(() => {
            const combinedPhotos = Array.isArray(ans.photos) ? ans.photos.filter(Boolean) : [];
            if (combinedPhotos.length === 0) return '';
            return `
              <div class="photos-section">
                <h4 class="media-title">Fotografías Asociadas (${combinedPhotos.length})</h4>
                <div class="photos-grid">
                  ${combinedPhotos
                    .map((photoItem, pIdx) => {
                      const fullPhoto = (photoItem?.id ? photoMap.get(photoItem.id) : undefined) || photoItem;
                      const dataUrlFallback =
                        (fullPhoto as any)?.dataUrl ||
                        fullPhoto?.imageUrl ||
                        (fullPhoto?.id ? `/api/photos/${fullPhoto.id}` : '');
                      const primarySrc = photoFileNamesMap
                        ? (photoFileNamesMap.get(fullPhoto.id) || dataUrlFallback)
                        : dataUrlFallback;
                      const captionText = String(
                        fullPhoto?.caption || photoItem?.caption || 'Sin descripción registrada'
                      ).trim();
                      return `
                        <div class="photo-card">
                          <img src="${escapeHtml(primarySrc)}" data-fallback="${escapeHtml(dataUrlFallback)}" alt="${escapeHtml(captionText)}" class="photo-img" onerror="if(this.dataset.fallback && this.src!==this.dataset.fallback){this.src=this.dataset.fallback;}" />
                          <div class="photo-caption">
                            <strong>Fotografía #${pIdx + 1}:</strong> ${escapeHtml(captionText)}
                          </div>
                        </div>
                      `;
                    })
                    .join('')}
                </div>
              </div>
            `;
          })()}
        </article>
      `);

      globalCount++;
    }

    itemsHtml.push(`</section>`);
  }

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Compilado Testimonial - ${escapeHtml(interview.title)}</title>
  <style>
    :root {
      --font-serif: Georgia, Cambria, 'Times New Roman', Times, serif;
      --font-sans: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      --color-bg: #f8fafc;
      --color-surface: #ffffff;
      --color-primary: #b45309;
      --color-primary-light: #fef3c7;
      --color-text: #1e293b;
      --color-muted: #64748b;
      --color-border: #e2e8f0;
      --color-card-border: #cbd5e1;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--color-bg);
      color: var(--color-text);
      font-family: var(--font-sans);
      line-height: 1.6;
      padding: 24px;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
    }

    .top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      flex-wrap: wrap;
      gap: 12px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.2s;
    }

    .btn-print {
      background: var(--color-primary);
      color: #fff;
    }
    .btn-print:hover { background: #92400e; }

    .header-hero {
      background: #ffffff;
      border: 1px solid var(--color-border);
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
      margin-bottom: 32px;
    }

    .hero-kicker {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      font-weight: 700;
      color: var(--color-primary);
      margin-bottom: 8px;
    }

    .hero-title {
      font-family: var(--font-serif);
      font-size: 28px;
      color: #0f172a;
      line-height: 1.25;
      margin-bottom: 12px;
    }

    .hero-desc {
      color: var(--color-muted);
      font-size: 14px;
      margin-bottom: 20px;
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      border-top: 1px solid var(--color-border);
      padding-top: 16px;
      font-size: 13px;
    }

    .meta-item strong {
      color: #0f172a;
    }

    .nav-toc {
      background: #fff;
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 32px;
      font-size: 13px;
    }

    .nav-toc-title {
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 8px;
    }

    .nav-toc-links {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
    }

    .nav-toc-links a {
      color: var(--color-primary);
      text-decoration: none;
      font-weight: 500;
    }
    .nav-toc-links a:hover { text-decoration: underline; }

    .stage-section {
      margin-bottom: 40px;
    }

    .stage-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 2px solid var(--color-primary-light);
    }

    .stage-pill {
      font-family: var(--font-serif);
      font-size: 18px;
      font-weight: 700;
      color: #78350f;
    }

    .stage-count {
      font-size: 12px;
      font-weight: 600;
      color: var(--color-muted);
      background: #f1f5f9;
      padding: 2px 8px;
      border-radius: 9999px;
    }

    .question-card {
      background: #ffffff;
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 20px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      page-break-inside: avoid;
    }

    .card-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      font-size: 11px;
    }

    .question-num {
      font-weight: 800;
      color: #475569;
      background: #f1f5f9;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .badge {
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 6px;
    }

    .badge-primary { background: #e0e7ff; color: #3730a3; }
    .badge-deepening { background: #fef3c7; color: #92400e; }
    .badge-additional { background: #dcfce7; color: #166534; }
    .badge-branch { background: #f1f5f9; color: #475569; }
    .badge-topic { background: #f8fafc; color: #64748b; border: 1px solid var(--color-border); }

    .author-tag { color: #334155; }
    .date-tag { color: var(--color-muted); margin-left: auto; }

    .question-title {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.4;
      margin-bottom: 16px;
    }

    .answer-box {
      background: #f8fafc;
      border-left: 4px solid var(--color-primary);
      padding: 16px;
      border-radius: 0 8px 8px 0;
      margin-bottom: 16px;
    }

    .not-recalled-box {
      border-left-color: #cbd5e1;
      background: #fafafa;
    }

    .not-recalled-text {
      color: #64748b;
      font-style: italic;
      font-size: 13px;
    }

    .verbatim-text {
      font-size: 14px;
      color: #1e293b;
      line-height: 1.7;
      white-space: pre-wrap;
    }

    .media-title {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 700;
      color: #475569;
      margin-bottom: 12px;
    }

    .voice-section {
      background: #f1f5f9;
      border-radius: 8px;
      padding: 16px;
      margin-top: 16px;
    }

    .audios-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .audio-item {
      background: #ffffff;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 12px;
    }

    .audio-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      font-size: 11px;
    }

    .audio-badge {
      font-weight: 700;
      color: #3730a3;
      background: #e0e7ff;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .audio-filename {
      color: var(--color-muted);
      font-family: monospace;
    }

    .native-audio {
      width: 100%;
      height: 36px;
      margin-bottom: 8px;
    }

    .transcription-card {
      background: #fafafa;
      border-left: 2px solid #cbd5e1;
      padding: 8px 12px;
      border-radius: 0 4px 4px 0;
      font-size: 12px;
    }

    .transcription-label {
      font-weight: 700;
      color: #475569;
      font-size: 10px;
      text-transform: uppercase;
      display: block;
      margin-bottom: 2px;
    }

    .transcription-text {
      color: #334155;
      font-style: italic;
    }

    .photos-section {
      margin-top: 16px;
    }

    .photos-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 16px;
    }

    .photo-card {
      background: #fff;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      overflow: hidden;
    }

    .photo-img {
      width: 100%;
      height: 180px;
      object-fit: cover;
      display: block;
      background: #e2e8f0;
    }

    .photo-caption {
      padding: 10px;
      font-size: 12px;
      color: #334155;
      line-height: 1.4;
      background: #fff;
    }

    @media print {
      body { background: #fff; padding: 0; font-size: 12pt; }
      .top-bar, .nav-toc { display: none; }
      .header-hero { border: none; box-shadow: none; padding: 0 0 24pt 0; }
      .question-card { border: 1px solid #ccc; box-shadow: none; page-break-inside: avoid; }
      .native-audio { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="top-bar">
      <span style="font-size: 12px; font-weight: 600; color: #64748b;">Dossier Testimonial de Respaldo - YouForever</span>
      <a
        id="qa-pdf-download-link"
        class="btn btn-print"
        href="${escapeHtml(pdfHref)}"
        download="Compilado_Testimonial_Fidedigno_${encodeURIComponent(interview.id)}.pdf"
        style="text-decoration: none; display: inline-flex; align-items: center; gap: 6px;"
      >Imprimir / Guardar como PDF</a>
    </div>

    <header class="header-hero">
      <div class="hero-kicker">Compilado Testimonial Fidedigno</div>
      <h1 class="hero-title">${escapeHtml(interview.title)}</h1>
      <p class="hero-desc">
        Este documento recopila de manera fidedigna e inalterada todas y cada una de las preguntas formuladas,
        las respuestas textuales proporcionadas por los entrevistados, las fotografías originales aportadas con su contexto
        y las grabaciones de voz con sus respectivas transcripciones.
      </p>

      <div class="meta-grid">
        <div class="meta-item"><strong>Modalidad:</strong> ${interview.storyMode === 'compartida' ? 'Historia Compartida' : 'Historia Individual'}</div>
        <div class="meta-item"><strong>Participantes:</strong> ${participants.map((p) => escapeHtml(p.name)).join(', ')}</div>
        <div class="meta-item"><strong>Respuestas Totales:</strong> ${answers.length} registradas</div>
        <div class="meta-item"><strong>Archivos de Voz:</strong> ${audios.length} grabaciones</div>
        <div class="meta-item"><strong>Fotografías:</strong> ${answers.reduce((sum, a) => sum + (Array.isArray(a.photos) ? a.photos.filter(Boolean).length : 0), 0)} imágenes</div>
        <div class="meta-item"><strong>Fecha de Exportación:</strong> ${new Date().toLocaleDateString('es-ES')}</div>
      </div>
    </header>

    <nav class="nav-toc">
      <div class="nav-toc-title">Navegar por Etapas de Vida:</div>
      <div class="nav-toc-links">
        ${stagesOrder
          .filter((st) => stageGroups[st] && stageGroups[st].length > 0)
          .map((st) => `<a href="#stage-${st}">${STAGE_LABELS[st] || st} (${stageGroups[st].length})</a>`)
          .join('')}
      </div>
    </nav>

    <main>
      ${itemsHtml.join('')}
    </main>

    <footer style="margin-top: 48px; padding-top: 24px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8;">
      Compilado generado por YouForever. Todos los derechos reservados a la familia y participantes.
    </footer>
  </div>

  <script>
    (function() {
      const pdfLink = document.getElementById('qa-pdf-download-link');
      if (pdfLink) {
        try {
          const urlParams = new URLSearchParams(window.location.search || '');
          const urlAdmin = urlParams.get('admin') || urlParams.get('adminEmail') || urlParams.get('token');
          const rawHref = pdfLink.getAttribute('href') || '';
          if (urlAdmin && rawHref.indexOf('admin=') === -1) {
            const sep = rawHref.indexOf('?') === -1 ? '?' : '&';
            pdfLink.setAttribute('href', rawHref + sep + 'admin=' + encodeURIComponent(urlAdmin));
          }
          pdfLink.addEventListener('click', function(ev) {
            if (window.location.protocol === 'file:') {
              ev.preventDefault();
              window.print();
              return;
            }
          });
        } catch (_e) {}
      }
    })();

    // Fallback handler for audio files if opened outside the ZIP folder
    document.querySelectorAll('audio').forEach(audio => {
      audio.addEventListener('error', () => {
        const fallback = audio.getAttribute('data-fallback');
        if (fallback && fallback.startsWith('data:') && audio.src !== fallback) {
          audio.src = fallback;
          audio.load();
        }
      });
    });
  </script>
</body>
</html>`;
}

/**
 * Builds the complete ZIP package with:
 * 1. Libro Completo de Historia y Legado (.md and .html)
 * 2. Compilado de Preguntas y Respuestas con fotos y audios (.html and .md)
 * 3. Carpeta audios/ con todos los archivos de voz decodificados (.webm / .mp3)
 * 4. Carpeta fotos/ con todas las fotografías decodificadas (.jpg / .png)
 * 5. Respaldo de datos completos (.json)
 * 6. LEEME_INSTRUCCIONES.txt
 */
export async function buildInterviewBackupZip(
  interviewId: string,
  storage: StorageReader
): Promise<{ buffer: Buffer; fileName: string }> {
  const interview = storage.getInterview(interviewId);
  if (!interview) {
    throw new Error('Entrevista no encontrada para exportación de respaldo.');
  }

  const participants = storage.getParticipantsForInterview(interviewId);
  const answers = storage.getAnswersForInterview(interviewId);
  const questions = storage.getQuestionsForVersion(interview.questionnaireVersionId);
  const photos = storage.getPhotosForInterview(interviewId);
  const audios = storage.getAudiosForInterview(interviewId);
  const manuscripts = storage.getManuscriptsForInterview(interviewId);

  const zip = new JSZip();

  // Create subfolders in ZIP
  const audiosFolder = zip.folder('audios');
  const photosFolder = zip.folder('fotos');

  // Map audio and photo IDs to clean, human-readable file paths inside the ZIP
  const audioFileNamesMap = new Map<string, string>();
  const photoFileNamesMap = new Map<string, string>();

  // 1. Pack Audio Files
  for (let i = 0; i < audios.length; i++) {
    const aud = audios[i];
    if (!aud) continue;
    const { buffer, ext } = decodeDataUrlToBuffer(aud.audioDataUrl, aud.mimeType || 'audio/webm');
    const sanitizedTitle = String(aud.questionText || 'audio')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .substring(0, 30);
    const fileName = `aud_${String(i + 1).padStart(2, '0')}_${sanitizedTitle}.${ext}`;

    if (audiosFolder && buffer.length > 0) {
      audiosFolder.file(fileName, buffer);
    }
    audioFileNamesMap.set(aud.id, `audios/${fileName}`);
  }

  // 2. Pack Photo Files
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    if (!photo) continue;
    const dataUrl = photo.dataUrl || '';
    const { buffer, ext } = decodeDataUrlToBuffer(dataUrl, photo.mimeType || 'image/jpeg');
    const sanitizedCaption = String(photo.caption || 'foto')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .substring(0, 30);
    const fileName = `foto_${String(i + 1).padStart(2, '0')}_${sanitizedCaption}.${ext}`;

    if (photosFolder && buffer.length > 0) {
      photosFolder.file(fileName, buffer);
    }
    photoFileNamesMap.set(photo.id, `fotos/${fileName}`);
  }

  // 3. Generate Q&A Compilations
  const qaMarkdown = generateQACompilationMarkdown({
    interview,
    participants,
    questions,
    answers,
    photos,
    audios,
    audioFileNamesMap,
    photoFileNamesMap,
  });

  const qaHtml = generateQACompilationHtml({
    interview,
    participants,
    questions,
    answers,
    photos,
    audios,
    audioFileNamesMap,
    photoFileNamesMap,
  });

  zip.file('2_COMPILADO_PREGUNTAS_Y_RESPUESTAS.html', qaHtml);
  zip.file('2_COMPILADO_PREGUNTAS_Y_RESPUESTAS.md', qaMarkdown);

  // 4. Generate & Include Latest Biographical Book Manuscript
  const latestManuscript = manuscripts.length > 0 ? manuscripts[0] : null;
  if (latestManuscript) {
    zip.file('1_LIBRO_HISTORIA_Y_LEGADO.md', latestManuscript.content);

    // Simple book HTML for standalone reading
    const bookHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(latestManuscript.title)} - Libro Biográfico</title>
  <style>
    body { font-family: Georgia, serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.8; color: #1a1a1a; background: #fffefb; }
    h1 { font-size: 2.2rem; color: #854d0e; text-align: center; margin-bottom: 0.5rem; }
    h2 { font-size: 1.5rem; color: #92400e; border-bottom: 2px solid #fef3c7; padding-bottom: 6px; margin-top: 2rem; }
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
    ${convertMarkdownToHtmlBasic(latestManuscript.content)}
  </div>
</body>
</html>`;
    zip.file('1_LIBRO_HISTORIA_Y_LEGADO.html', bookHtml);
  }

  // 5. Raw JSON Database Backup
  const fullJsonBackup = {
    exportedAt: new Date().toISOString(),
    system: 'YouForever',
    interview,
    participants,
    questions,
    answers,
    photosCount: photos.length,
    audiosCount: audios.length,
    photos: photos.map((p) => ({
      id: p.id,
      caption: p.caption,
      fileName: p.fileName,
      mimeType: p.mimeType,
      createdAt: p.createdAt,
    })),
    audios: audios.map((a) => ({
      id: a.id,
      questionId: a.questionId,
      questionText: a.questionText,
      durationSeconds: a.durationSeconds,
      mimeType: a.mimeType,
      transcription: a.transcription,
      createdAt: a.createdAt,
    })),
    manuscripts: manuscripts.map((m) => ({
      id: m.id,
      version: m.version,
      title: m.title,
      summary: m.summary,
      generatedAt: m.generatedAt,
      generatedBy: m.generatedBy,
    })),
  };
  zip.file('3_RESPALDO_DATOS_COMPLETOS.json', JSON.stringify(fullJsonBackup, null, 2));

  // 6. Readme Instructions
  const instructions = `====================================================================
RESPALDO INTEGRAL DE HISTORIA DE VIDA — FOREVERYOU
Obra: "${interview.title}"
Fecha de exportación: ${new Date().toISOString()}
====================================================================

CONTENIDO DE ESTE PAQUETE DE RESPALDO:

1. [1_LIBRO_HISTORIA_Y_LEGADO.html / .md]
   El libro biográfico completo y estructurado con la historia y el legado
   del entrevistado, listo para imprimir o enviar a imprenta.

2. [2_COMPILADO_PREGUNTAS_Y_RESPUESTAS.html]
   Dossier testimonial interactivo fuera de línea (offline).
   - Puedes abrirlo directamente con doble clic en cualquier navegador web
     (Chrome, Safari, Edge, Firefox) SIN necesidad de conexión a internet.
   - Contiene todas las preguntas y respuestas tal cual fueron respondidas.
   - Permite escuchar cada nota de voz directamente con el reproductor nativo.
   - Muestra todas las fotografías aportadas en alta resolución con su pie de foto.
   - Incluye botón para imprimir o guardar como PDF.

3. [2_COMPILADO_PREGUNTAS_Y_RESPUESTAS.md]
   El compilado testimonial en formato Markdown editable para documentación.

4. [3_RESPALDO_DATOS_COMPLETOS.json]
   Respaldo estructurado de todos los registros de la base de datos Firestore.

5. [Carpeta "audios/"]
   Contiene todos los archivos de grabación de voz originales (${audios.length} audios),
   identificados con su número y etapa de vida.

6. [Carpeta "fotos/"]
   Contiene todas las fotografías originales aportadas por el entrevistado (${photos.length} fotos).

====================================================================
Conservar este respaldo en un lugar seguro (disco duro, nube personal).
`;
  zip.file('LEEME_INSTRUCCIONES.txt', instructions);

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const sanitizedTitle = interview.title.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 40);
  const fileName = `respaldo_legado_${sanitizedTitle}_${new Date().toISOString().substring(0, 10)}.zip`;

  return { buffer, fileName };
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function convertMarkdownToHtmlBasic(md: string): string {
  return md
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
    .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*)\*/gim, '<em>$1</em>')
    .replace(/!\[(.*?)\]\((.*?)\)/gim, '<figure><img src="$2" alt="$1"><figcaption>$1</figcaption></figure>')
    .replace(/\n$/gim, '<br />');
}
