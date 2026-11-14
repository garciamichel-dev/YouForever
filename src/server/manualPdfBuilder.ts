import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsPDF } from 'jspdf';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedManualPdfBuffer: Buffer | null = null;

interface ManualStepSpec {
  stepNumber: string;
  title: string;
  description: string;
  imageFile: string;
  imageAspectRatio: number; // width / height
}

function loadManualScreenshotDataUrl(fileName: string): string | null {
  try {
    const candidates = [
      path.resolve(__dirname, '..', 'assets', 'manual', fileName),
      path.join(process.cwd(), 'src', 'assets', 'manual', fileName),
    ];
    const filePath = candidates.find((p) => fs.existsSync(p));
    if (!filePath) return null;
    const buf = fs.readFileSync(filePath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

function drawStepSection(
  doc: jsPDF,
  spec: ManualStepSpec,
  startY: number,
  maxImageHeightMm: number
): void {
  const pageWidth = 210;
  const marginX = 15;
  const contentWidth = pageWidth - marginX * 2;

  // Step number badge
  doc.setFillColor(180, 83, 9); // amber-700
  doc.roundedRect(marginX, startY, 10, 7, 1.5, 1.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(spec.stepNumber, marginX + 5, startY + 4.9, { align: 'center' });

  // Step heading
  doc.setTextColor(28, 25, 23); // stone-900
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(spec.title, marginX + 13, startY + 5);

  // Description lines
  doc.setTextColor(68, 64, 60); // stone-700
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.2);
  const descLines = doc.splitTextToSize(spec.description, contentWidth);
  const textY = startY + 11.5;
  doc.text(descLines, marginX, textY, { lineHeightFactor: 1.35 });

  const imageTopY = textY + descLines.length * 4.3 + 2.5;
  const imgDataUrl = loadManualScreenshotDataUrl(spec.imageFile);

  if (imgDataUrl) {
    let imgH = maxImageHeightMm;
    let imgW = imgH * spec.imageAspectRatio;
    if (imgW > contentWidth - 4) {
      imgW = contentWidth - 4;
      imgH = imgW / spec.imageAspectRatio;
    }
    const imgX = marginX + (contentWidth - imgW) / 2;

    // Subtle frame around screenshot
    doc.setFillColor(250, 250, 249);
    doc.setDrawColor(214, 211, 209); // stone-300
    doc.setLineWidth(0.35);
    doc.roundedRect(imgX - 1.5, imageTopY - 1.5, imgW + 3, imgH + 3, 2, 2, 'FD');

    doc.addImage(imgDataUrl, 'PNG', imgX, imageTopY, imgW, imgH, undefined, 'FAST');
  } else {
    doc.setFillColor(245, 245, 244);
    doc.roundedRect(marginX, imageTopY, contentWidth, 45, 2, 2, 'F');
    doc.setTextColor(120, 113, 108);
    doc.setFontSize(9);
    doc.text('Captura de interfaz no disponible.', marginX + contentWidth / 2, imageTopY + 23, {
      align: 'center',
    });
  }
}

export function buildUserManualPdfBuffer(forceRebuild = false): Buffer {
  if (cachedManualPdfBuffer && !forceRebuild) {
    return cachedManualPdfBuffer;
  }

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const drawPageFooter = (pageNum: number, totalPages: number) => {
    doc.setDrawColor(231, 229, 228);
    doc.setLineWidth(0.3);
    doc.line(15, 283, 195, 283);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 113, 108);
    doc.text(
      'YouForever • Manual Breve de Uso para Entrevistados • Soporte: youforever.team@gmail.com',
      15,
      288.5
    );
    doc.text(`Página ${pageNum} de ${totalPages}`, 195, 288.5, { align: 'right' });
  };

  // === PAGE 1: Cover Banner + Step 1 & Step 2 ===
  doc.setFillColor(28, 25, 23); // stone-900
  doc.rect(0, 0, 210, 29, 'F');

  doc.setTextColor(251, 191, 36); // amber-400
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('YOUFOREVER • GUÍA RÁPIDA DEL PARTICIPANTE', 15, 10);

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16.5);
  doc.text('Manual breve para crear tu libro autobiográfico', 15, 18.5);

  doc.setTextColor(214, 211, 209);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.8);
  doc.text(
    'Ingresa, responde por voz o por escrito, añade fotografías, cierra tu entrevista y descarga tu libro en PDF.',
    15,
    24.5
  );

  drawStepSection(
    doc,
    {
      stepNumber: '1',
      title: 'Ingresar y retomar tu entrevista en cualquier momento',
      description:
        'Abre el enlace directo que recibiste o entra al Portal del Participante, escribe tu Código de Acceso (ejemplo: YF-XXXX) en el campo «Código de Acceso o Enlace de Invitación» y pulsa «Entrar a la Entrevista». Tu progreso se guarda automáticamente pregunta por pregunta para que puedas salir cuando quieras y retomar exactamente donde te quedaste usando el mismo código o enlace.',
      imageFile: '01-ingreso.png',
      imageAspectRatio: 1280 / 860,
    },
    34,
    80
  );

  drawStepSection(
    doc,
    {
      stepNumber: '2',
      title: 'Responder por voz o por escrito y navegar entre preguntas',
      description:
        'Toca el botón circular «Toca para hablar» para grabar tu recuerdo con el micrófono: YouForever transcribe tu voz automáticamente al español y guarda audio y texto juntos (puede mostrar una pregunta de profundización si aplica). Si prefieres escribir, pulsa «O si lo prefieres, escribe tu respuesta con el teclado» y avanza con «Guardar y Continuar», o usa «No lo recuerdo» / «Omitir y continuar». En la barra superior puedes abrir «Mis Respuestas» para consultar o editar lo guardado, y «Añadir información adicional» para sumar recuerdos libres.',
      imageFile: '02-respuesta-voz-texto.png',
      imageAspectRatio: 1280 / 900,
    },
    156,
    84
  );

  drawPageFooter(1, 3);

  // === PAGE 2: Step 3 & Step 4 ===
  doc.addPage();
  doc.setFillColor(28, 25, 23);
  doc.rect(0, 0, 210, 14, 'F');
  doc.setTextColor(251, 191, 36);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('YOUFOREVER • FOTOGRAFÍAS Y CIERRE DE ENTREVISTA', 15, 9);

  drawStepSection(
    doc,
    {
      stepNumber: '3',
      title: 'Añadir fotografías a tus recuerdos',
      description:
        'Debajo de la grabación de voz o del cuadro de texto, pulsa «Añadir fotografía» para abrir el selector de imágenes (.jpg, .png o .webp). Puedes adjuntar una o varias fotos en cada pregunta y escribir una breve descripción o contexto para que el libro integre cada fotografía en la etapa correspondiente de tu historia.',
      imageFile: '03-anadir-foto.png',
      imageAspectRatio: 1280 / 900,
    },
    22,
    88
  );

  drawStepSection(
    doc,
    {
      stepNumber: '4',
      title: 'Finalizar la entrevista cuando estés listo',
      description:
        'Al completar el cuestionario o cuando decidas concluir anticipadamente, abre el menú del ícono de engrane arriba a la derecha y selecciona «He terminado mi historia». Se abrirá el cuadro de confirmación donde puedes escribir una dedicatoria o motivo de cierre opcional y pulsar «Confirmar Cierre y Maquetar». Tus respuestas quedarán protegidas en modo de solo lectura y se habilitará el Estudio Editorial.',
      imageFile: '04-finalizar-entrevista.png',
      imageAspectRatio: 1280 / 900,
    },
    152,
    88
  );

  drawPageFooter(2, 3);

  // === PAGE 3: Step 5 & Step 6 ===
  doc.addPage();
  doc.setFillColor(28, 25, 23);
  doc.rect(0, 0, 210, 14, 'F');
  doc.setTextColor(251, 191, 36);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('YOUFOREVER • MAQUETACIÓN Y DESCARGA DEL LIBRO EN PDF', 15, 9);

  drawStepSection(
    doc,
    {
      stepNumber: '5',
      title: 'Configurar el estilo y diseño de tu libro en Maquetación',
      description:
        'En «Configura la Maquetación de tu Libro», elige primero una opción en «1. Estilo Literario (3)» para generar tu muestra inicial de páginas. Después se desbloquearán «2. Portada (5)», «3. Diseño Interior (5)», «4. Formato Físico (3)» y «5. Título y Metadatos» para personalizar título, subtítulo, autor(es), dedicatoria y texto de cierre antes de generar la versión completa en PDF.',
      imageFile: '05-maquetacion-libro.png',
      imageAspectRatio: 1280 / 960,
    },
    21,
    92
  );

  drawStepSection(
    doc,
    {
      stepNumber: '6',
      title: 'Visualizar versiones generadas y descargar tu libro en PDF',
      description:
        'Una vez generado, tu libro queda guardado en «Mis Libros» («Tu Libro Autobiográfico en PDF»). Puedes previsualizarlo en «Modo Libro» o «Modo Lector PDF», descargar el archivo PDF completo directamente a tu dispositivo y, si cuentas con ediciones disponibles, pulsar «Modificar maquetación» para ajustar el diseño y crear una nueva versión.',
      imageFile: '06-descargar-libro.png',
      imageAspectRatio: 1280 / 900,
    },
    155,
    86
  );

  drawPageFooter(3, 3);

  const arrayBuffer = doc.output('arraybuffer');
  cachedManualPdfBuffer = Buffer.from(arrayBuffer);
  return cachedManualPdfBuffer;
}
