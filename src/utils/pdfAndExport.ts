import { DocumentAnalysis, QuizQuestion } from '../data/enamoratePreset';

declare global {
  interface Window {
    pdfjsLib?: {
      GlobalWorkerOptions: { workerSrc: string };
      getDocument: (src: { data: ArrayBuffer } | string) => {
        promise: Promise<{
          numPages: number;
          getPage: (pageNum: number) => Promise<{
            getTextContent: () => Promise<{
              items: Array<{ str?: string }>;
            }>;
          }>;
        }>;
      };
    };
  }
}

export async function extractTextFromFile(
  file: File,
  onProgress?: (status: string, percent: number) => void
): Promise<{ text: string; pageCount: number }> {
  const fileNameLower = file.name.toLowerCase();

  if (file.type === 'application/pdf' || fileNameLower.endsWith('.pdf')) {
    if (!window.pdfjsLib) {
      throw new Error('El lector de archivos PDF aún no se ha inicializado en el navegador.');
    }

    if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    onProgress?.('Leyendo archivo PDF...', 15);
    const arrayBuffer = await file.arrayBuffer();

    onProgress?.('Analizando páginas del libro...', 25);
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const totalPages = pdf.numPages;
    const pagesText: string[] = [];

    for (let i = 1; i <= totalPages; i++) {
      const pct = Math.round(25 + (i / totalPages) * 65);
      onProgress?.(`Extrayendo contenido de la página ${i} de ${totalPages}...`, pct);
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((item) => item.str || '');
      pagesText.push(`--- Página ${i} ---\n${strings.join(' ')}`);
    }

    const fullText = pagesText.join('\n\n').trim();
    if (!fullText || fullText.length < 20) {
      throw new Error(
        'No se detectó texto seleccionable suficiente en el PDF (puede ser un libro escaneado sin texto digital).'
      );
    }

    onProgress?.('Lectura completada.', 100);
    return { text: fullText, pageCount: totalPages };
  }

  onProgress?.('Leyendo contenido del libro...', 50);
  const text = await file.text();
  if (!text || text.trim().length < 20) {
    throw new Error('El archivo está vacío o contiene menos de 20 caracteres.');
  }
  const estimatedPages = Math.max(1, Math.ceil(text.length / 2500));
  onProgress?.('Lectura completada.', 100);
  return { text: text.trim(), pageCount: estimatedPages };
}

export function generateMarkdownReport(
  fileName: string,
  analysis: DocumentAnalysis,
  questions: QuizQuestion[],
  userAnswers: Record<string, number | string>
): string {
  const dateStr = new Date().toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const lines: string[] = [
    `# Guía de Lectura y Resumen — ${analysis.title}`,
    ``,
    ...(analysis.authorOrSource ? [`- **Autor / Fuente:** ${analysis.authorOrSource}`] : []),
    `- **Documento base:** ${fileName}`,
    `- **Fecha:** ${dateStr}`,
    ``,
    `---`,
    ``,
    `## 1. Sinopsis Ejecutiva`,
    ``,
    analysis.executiveSummary,
    ``,
    `## 2. Propósitos y Tesis de la Obra`,
    ``,
    ...(analysis.objectives || []).map((obj, idx) => `${idx + 1}. ${obj}`),
    ``,
    `## 3. Ideas Principales`,
    ``,
    ...(analysis.keyPoints || []).map(
      (kp) => `- **[${kp.category}] ${kp.heading}:** ${kp.detail}`
    ),
    ``,
  ];

  if (Array.isArray(analysis.chapters) && analysis.chapters.length > 0) {
    lines.push(`## 4. Estudio Exhaustivo por Capítulos`);
    lines.push(``);
    analysis.chapters.forEach((cap) => {
      lines.push(`### Capítulo ${cap.n}: ${cap.titulo}`);
      if (cap.subtitulo) {
        lines.push(`*${cap.subtitulo}*`);
        lines.push(``);
      }
      lines.push(`**Tesis central:** ${cap.idea}`);
      lines.push(``);
      if (cap.analisisDetallado) {
        lines.push(`#### Análisis y Desarrollo Exhaustivo`);
        lines.push(cap.analisisDetallado);
        lines.push(``);
      }
      lines.push(`#### Casos, Ejemplos y Contexto Narrativo`);
      lines.push(`${cap.historia}`);
      lines.push(``);
      if (Array.isArray(cap.conceptosClave) && cap.conceptosClave.length > 0) {
        lines.push(`#### Conceptos y Términos Clave del Capítulo`);
        cap.conceptosClave.forEach((c) => {
          lines.push(`- **${c.termino}:** ${c.definicion}`);
        });
        lines.push(``);
      }
      if (cap.citaCapitulo) {
        lines.push(`> “${cap.citaCapitulo}”`);
        lines.push(``);
      }
      if (Array.isArray(cap.consejos) && cap.consejos.length > 0) {
        lines.push(`#### Aprendizajes y Reglas de Acción`);
        cap.consejos.forEach((c) => lines.push(`- ${c}`));
        lines.push(``);
      }
      if (Array.isArray(cap.preguntasReflexion) && cap.preguntasReflexion.length > 0) {
        lines.push(`#### Preguntas de Aplicación Práctica`);
        cap.preguntasReflexion.forEach((q, qIdx) => lines.push(`${qIdx + 1}. ${q}`));
        lines.push(``);
      }
      if (cap.adaptacionMundoActual) {
        const ad = cap.adaptacionMundoActual;
        lines.push(`#### Adaptación al Mundo Actual (${ad.ambito}): ${ad.tituloCaso}`);
        lines.push(`- **Escenario real / actual:** ${ad.escenarioActual}`);
        lines.push(`- **Paralelo con el libro:** ${ad.paraleloConElLibro}`);
        if (Array.isArray(ad.planDeAccion) && ad.planDeAccion.length > 0) {
          lines.push(`- **Plan de acción ejecutivo:**`);
          ad.planDeAccion.forEach((step, sIdx) => lines.push(`  ${sIdx + 1}. ${step}`));
        }
        if (ad.errorComunEvitar) {
          lines.push(`- **Error común a evitar:** ${ad.errorComunEvitar}`);
        }
        if (ad.indicadorExito) {
          lines.push(`- **Indicador de éxito (KPI):** ${ad.indicadorExito}`);
        }
        lines.push(``);
      }
    });
  }

  if (Array.isArray(analysis.quotes) && analysis.quotes.length > 0) {
    lines.push(`## 5. Citas Destacadas`);
    lines.push(``);
    analysis.quotes.forEach((q) => {
      lines.push(`> “${q.texto}” — *${q.autor}*`);
      lines.push(``);
    });
  }

  lines.push(
    `## 6. Conclusiones y Lecciones Prácticas`,
    ``,
    ...(analysis.conclusions || []).map((c) => `- ${c}`),
    ``,
    `---`,
    ``,
    `## 7. Cuestionario de Comprensión (${questions.length} preguntas)`,
    ``
  );

  questions.forEach((q, idx) => {
    lines.push(
      `### Pregunta ${idx + 1} (${q.type === 'multiple_choice' ? 'Opción Múltiple' : 'Respuesta Abierta'})`
    );
    lines.push(`**${q.question}**`);
    lines.push(``);

    if (q.type === 'multiple_choice' && q.options.length > 0) {
      q.options.forEach((opt, optIdx) => {
        const isCorrect = optIdx === q.correctIndex;
        const userSelected = userAnswers[q.id] === optIdx;
        const marker = isCorrect ? '[CORRECTA]' : userSelected ? '[TU ELECCIÓN]' : '';
        lines.push(`- (${String.fromCharCode(65 + optIdx)}) ${opt} ${marker}`);
      });
      lines.push(``);
    } else if (q.type === 'open') {
      const ua = userAnswers[q.id];
      if (typeof ua === 'string' && ua.trim()) {
        lines.push(`- **Respuesta registrada:** ${ua}`);
      }
      lines.push(`- **Puntos clave:** ${(q.rubricKeyPoints || []).join(' · ')}`);
      lines.push(``);
    }

    lines.push(`> **Explicación:** ${q.explanation}`);
    if (q.referenceQuote) {
      lines.push(`> *Referencia:* ${q.referenceQuote}`);
    }
    lines.push(``);
  });

  return lines.join('\n');
}

export function downloadTextFile(
  content: string,
  filename: string,
  mimeType = 'text/markdown;charset=utf-8'
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
