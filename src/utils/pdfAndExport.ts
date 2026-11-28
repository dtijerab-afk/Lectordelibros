import {
  DocumentAnalysis,
  ExtractedPage,
  PdfOutlineItem,
  QuizQuestion,
} from '../data/enamoratePreset';

interface PdfJsTextItem {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
  height?: number;
  width?: number;
}

interface PdfJsOutlineNode {
  title?: string;
  dest?: string | unknown[] | null;
  items?: PdfJsOutlineNode[];
}

interface PdfJsDocumentProxy {
  numPages: number;
  getPage: (pageNum: number) => Promise<{
    getTextContent: () => Promise<{
      items: PdfJsTextItem[];
    }>;
  }>;
  getOutline?: () => Promise<PdfJsOutlineNode[] | null>;
  getDestination?: (dest: string) => Promise<unknown[] | null>;
  getPageIndex?: (ref: unknown) => Promise<number>;
}

declare global {
  interface Window {
    pdfjsLib?: {
      GlobalWorkerOptions: { workerSrc: string };
      getDocument: (src: { data: ArrayBuffer } | string) => {
        promise: Promise<PdfJsDocumentProxy>;
      };
    };
  }
}

export interface ExtractedBookDocument {
  text: string;
  pageCount: number;
  pages: ExtractedPage[];
  outline: PdfOutlineItem[];
  readablePageCount: number;
  unreadablePages: number[];
  extractionWarnings: string[];
}

const MIN_READABLE_PAGE_CHARS = 25;

const HEADING_HINT_REGEX =
  /^(?:cap[ií]tulo|chapter|cap\.?|parte|part|secci[oó]n|section|unidad|unit|m[oó]dulo|module|lecci[oó]n|lesson|bloque|pr[oó]logo|prefacio|introducci[oó]n|ep[ií]logo|conclusi[oó]n|ap[eé]ndice|preface|prologue|introduction|epilogue|conclusion|appendix)\b/i;

function normalizeLineText(raw: string): string {
  return raw
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function reconstructStructuredPage(items: PdfJsTextItem[]): {
  text: string;
  headings: string[];
} {
  interface BuiltLine {
    text: string;
    fontSize: number;
    y: number;
    gapBefore: number;
  }

  const lines: BuiltLine[] = [];
  let currentParts: string[] = [];
  let currentFontSizes: number[] = [];
  let currentY: number | null = null;
  let lastY: number | null = null;
  let pendingGapBefore = 0;

  const flushLine = () => {
    const joined = normalizeLineText(currentParts.join(''));
    if (joined) {
      const avgFont =
        currentFontSizes.length > 0
          ? currentFontSizes.reduce((a, b) => a + b, 0) / currentFontSizes.length
          : 11;
      lines.push({
        text: joined,
        fontSize: avgFont,
        y: currentY ?? 0,
        gapBefore: pendingGapBefore,
      });
    }
    currentParts = [];
    currentFontSizes = [];
    pendingGapBefore = 0;
  };

  for (const item of items) {
    const str = item.str ?? '';
    const transform = Array.isArray(item.transform) ? item.transform : null;
    const itemY: number | null =
      transform && typeof transform[5] === 'number' ? transform[5] : currentY;
    const rawFontSize =
      (transform && typeof transform[3] === 'number' && Math.abs(transform[3])) ||
      (transform && typeof transform[0] === 'number' && Math.abs(transform[0])) ||
      (typeof item.height === 'number' && item.height > 0 ? item.height : 11);
    const fontSize = rawFontSize > 1 ? rawFontSize : 11;

    if (currentY !== null && itemY !== null) {
      const deltaY = Math.abs(itemY - currentY);
      const lineBreakThreshold = Math.max(fontSize * 0.45, 3.2);
      if (deltaY > lineBreakThreshold) {
        flushLine();
        pendingGapBefore = deltaY;
        lastY = currentY;
        currentY = itemY;
      }
    } else if (currentY === null && itemY !== null) {
      currentY = itemY;
      if (lastY !== null) {
        pendingGapBefore = Math.abs(itemY - lastY);
      }
    }

    if (str.length > 0) {
      if (
        currentParts.length > 0 &&
        !/\s$/.test(currentParts[currentParts.length - 1]) &&
        !/^\s/.test(str) &&
        !/^[,.;:!?)\]]/.test(str) &&
        !/[-–—(/[]$/.test(currentParts[currentParts.length - 1])
      ) {
        currentParts.push(' ');
      }
      currentParts.push(str);
      if (str.trim().length > 0) {
        currentFontSizes.push(fontSize);
      }
    }

    if (item.hasEOL) {
      lastY = currentY;
      flushLine();
      currentY = null;
    }
  }
  flushLine();

  if (lines.length === 0) {
    return { text: '', headings: [] };
  }

  // Median font size for heading detection
  const sortedFonts = [...lines].map((l) => l.fontSize).sort((a, b) => a - b);
  const medianFont = sortedFonts[Math.floor(sortedFonts.length / 2)] || 11;

  const outputLines: string[] = [];
  const headings: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isParagraphGap = i > 0 && line.gapBefore > Math.max(medianFont * 1.55, 16);
    if (isParagraphGap) {
      outputLines.push('');
    }
    outputLines.push(line.text);

    const isLargerFont = line.fontSize >= medianFont * 1.16 && line.text.length >= 3 && line.text.length <= 130;
    const isAllCapsHeading =
      line.text.length >= 4 &&
      line.text.length <= 90 &&
      /[A-ZÁÉÍÓÚÑ]/.test(line.text) &&
      line.text === line.text.toUpperCase() &&
      !/^\d+$/.test(line.text);
    const matchesHeadingHint = HEADING_HINT_REGEX.test(line.text) && line.text.length <= 140;

    if (isLargerFont || matchesHeadingHint || (isAllCapsHeading && i < 8)) {
      if (!headings.includes(line.text)) {
        headings.push(line.text);
      }
    }
  }

  const text = outputLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, headings };
}

function stripRepetitiveHeadersFooters(pages: ExtractedPage[]): ExtractedPage[] {
  if (pages.length < 6) return pages;

  const firstLineCounts = new Map<string, number>();
  const lastLineCounts = new Map<string, number>();

  const normalizeKey = (line: string) =>
    line
      .replace(/\d+/g, '#')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  for (const p of pages) {
    const rawLines = p.text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (rawLines.length < 3) continue;
    const first = rawLines[0];
    const last = rawLines[rawLines.length - 1];
    if (first.length <= 85 && !HEADING_HINT_REGEX.test(first)) {
      const k = normalizeKey(first);
      firstLineCounts.set(k, (firstLineCounts.get(k) || 0) + 1);
    }
    if (last.length <= 85 && !HEADING_HINT_REGEX.test(last)) {
      const k = normalizeKey(last);
      lastLineCounts.set(k, (lastLineCounts.get(k) || 0) + 1);
    }
  }

  const threshold = Math.max(4, Math.floor(pages.length * 0.35));

  return pages.map((p) => {
    const rawLines = p.text.split('\n');
    if (rawLines.length < 3) return p;

    let start = 0;
    let end = rawLines.length - 1;

    while (start < end && !rawLines[start].trim()) start++;
    while (end > start && !rawLines[end].trim()) end--;

    const firstTrimmed = rawLines[start]?.trim() || '';
    const lastTrimmed = rawLines[end]?.trim() || '';

    const isStandalonePageNum = (s: string) => /^[-–—\s]*\d{1,4}[-–—\s]*$/.test(s);

    if (
      firstTrimmed &&
      (isStandalonePageNum(firstTrimmed) ||
        (firstTrimmed.length <= 85 &&
          !HEADING_HINT_REGEX.test(firstTrimmed) &&
          (firstLineCounts.get(normalizeKey(firstTrimmed)) || 0) >= threshold))
    ) {
      start++;
    }

    if (
      end > start &&
      lastTrimmed &&
      (isStandalonePageNum(lastTrimmed) ||
        (lastTrimmed.length <= 85 &&
          !HEADING_HINT_REGEX.test(lastTrimmed) &&
          (lastLineCounts.get(normalizeKey(lastTrimmed)) || 0) >= threshold))
    ) {
      end--;
    }

    const cleanedText = rawLines.slice(start, end + 1).join('\n').trim();
    return {
      ...p,
      text: cleanedText,
      charCount: cleanedText.length,
      isReadable: cleanedText.length >= MIN_READABLE_PAGE_CHARS,
    };
  });
}

async function extractPdfOutline(pdf: PdfJsDocumentProxy): Promise<PdfOutlineItem[]> {
  if (typeof pdf.getOutline !== 'function') return [];
  try {
    const rawOutline = await pdf.getOutline();
    if (!Array.isArray(rawOutline) || rawOutline.length === 0) return [];

    const results: PdfOutlineItem[] = [];
    const seen = new Set<string>();

    const resolvePageNumber = async (dest: string | unknown[] | null | undefined): Promise<number | null> => {
      if (!dest) return null;
      let destArray: unknown[] | null = null;
      if (typeof dest === 'string') {
        if (typeof pdf.getDestination === 'function') {
          destArray = await pdf.getDestination(dest).catch(() => null);
        }
      } else if (Array.isArray(dest)) {
        destArray = dest;
      }
      if (!destArray || destArray.length === 0) return null;
      const ref = destArray[0];
      if (typeof ref === 'number') {
        return ref + 1;
      }
      if (ref && typeof pdf.getPageIndex === 'function') {
        try {
          const idx = await pdf.getPageIndex(ref);
          if (typeof idx === 'number' && idx >= 0 && idx < pdf.numPages) {
            return idx + 1;
          }
        } catch {
          return null;
        }
      }
      return null;
    };

    const walk = async (nodes: PdfJsOutlineNode[], level: number) => {
      for (const node of nodes) {
        const title = normalizeLineText(node.title || '');
        const pageNumber = await resolvePageNumber(node.dest);
        if (title && pageNumber !== null && pageNumber >= 1 && pageNumber <= pdf.numPages) {
          const key = `${pageNumber}::${title.toLowerCase()}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({ title, pageNumber, level });
          }
        }
        if (Array.isArray(node.items) && node.items.length > 0 && level < 2) {
          await walk(node.items, level + 1);
        }
      }
    };

    await walk(rawOutline, 0);
    return results.sort((a, b) => a.pageNumber - b.pageNumber || a.level - b.level);
  } catch {
    return [];
  }
}

export function buildStructuredDocumentFromText(rawText: string): ExtractedBookDocument {
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized || normalized.length < 20) {
    throw new Error('El texto está vacío o contiene menos de 20 caracteres.');
  }

  // If text already contains explicit "--- Página N ---" markers, respect them
  const explicitPageRegex = /^---\s*P[áa]gina\s+(\d+)\s*---$/gim;
  const pageMatches = [...normalized.matchAll(explicitPageRegex)];
  const pages: ExtractedPage[] = [];

  if (pageMatches.length >= 2) {
    for (let i = 0; i < pageMatches.length; i++) {
      const match = pageMatches[i];
      const pageNum = Number(match[1]) || i + 1;
      const startIdx = (match.index ?? 0) + match[0].length;
      const endIdx = i + 1 < pageMatches.length ? pageMatches[i + 1].index ?? normalized.length : normalized.length;
      const pageText = normalized.slice(startIdx, endIdx).trim();
      const headings = pageText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length >= 3 && l.length <= 130 && HEADING_HINT_REGEX.test(l));
      pages.push({
        pageNumber: pageNum,
        text: pageText,
        charCount: pageText.length,
        isReadable: pageText.length >= MIN_READABLE_PAGE_CHARS,
        headings,
      });
    }
  } else {
    // Split cleanly into virtual pages (~2,600 chars) respecting paragraphs and chapter headings
    const TARGET_PAGE_CHARS = 2600;
    const paragraphs = normalized.split(/\n\n+/);
    let currentBuf = '';
    let pageNum = 1;

    const pushVirtualPage = (content: string) => {
      const clean = content.trim();
      if (!clean) return;
      const headings = clean
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length >= 3 && l.length <= 130 && HEADING_HINT_REGEX.test(l));
      pages.push({
        pageNumber: pageNum++,
        text: clean,
        charCount: clean.length,
        isReadable: clean.length >= MIN_READABLE_PAGE_CHARS,
        headings,
      });
    };

    for (const para of paragraphs) {
      const trimmedPara = para.trim();
      if (!trimmedPara) continue;
      const firstLine = trimmedPara.split('\n')[0].trim();
      const startsNewHeading = HEADING_HINT_REGEX.test(firstLine) && currentBuf.length >= 400;

      if (startsNewHeading || (currentBuf.length + trimmedPara.length > TARGET_PAGE_CHARS && currentBuf.length >= 900)) {
        pushVirtualPage(currentBuf);
        currentBuf = trimmedPara;
      } else {
        currentBuf = currentBuf ? `${currentBuf}\n\n${trimmedPara}` : trimmedPara;
      }
    }
    if (currentBuf.trim()) {
      pushVirtualPage(currentBuf);
    }
  }

  const unreadablePages = pages.filter((p) => !p.isReadable).map((p) => p.pageNumber);
  const readablePageCount = pages.length - unreadablePages.length;
  const fullText = pages.map((p) => `--- Página ${p.pageNumber} ---\n${p.text}`).join('\n\n');

  return {
    text: fullText,
    pageCount: pages.length,
    pages,
    outline: [],
    readablePageCount,
    unreadablePages,
    extractionWarnings:
      unreadablePages.length > 0
        ? [`Se detectaron ${unreadablePages.length} páginas sin texto legible suficiente.`]
        : [],
  };
}

export async function extractTextFromFile(
  file: File,
  onProgress?: (status: string, percent: number) => void
): Promise<ExtractedBookDocument> {
  const fileNameLower = file.name.toLowerCase();

  if (file.type === 'application/pdf' || fileNameLower.endsWith('.pdf')) {
    if (!window.pdfjsLib) {
      throw new Error('El lector de archivos PDF aún no se ha inicializado en el navegador.');
    }

    if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    onProgress?.('Leyendo archivo PDF...', 10);
    const arrayBuffer = await file.arrayBuffer();

    onProgress?.('Abriendo estructura e índice del libro...', 20);
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const totalPages = pdf.numPages;

    const outline = await extractPdfOutline(pdf);
    const rawPages: ExtractedPage[] = [];

    for (let i = 1; i <= totalPages; i++) {
      const pct = Math.round(22 + (i / totalPages) * 68);
      if (i === 1 || i === totalPages || i % 3 === 0 || totalPages <= 25) {
        onProgress?.(`Extrayendo texto estructurado de la página ${i} de ${totalPages}...`, pct);
      }
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const { text, headings } = reconstructStructuredPage(content.items || []);
      rawPages.push({
        pageNumber: i,
        text,
        charCount: text.length,
        isReadable: text.length >= MIN_READABLE_PAGE_CHARS,
        headings,
      });
    }

    onProgress?.('Limpiando encabezados repetitivos y verificando páginas...', 94);
    const cleanedPages = stripRepetitiveHeadersFooters(rawPages);
    const unreadablePages = cleanedPages.filter((p) => !p.isReadable).map((p) => p.pageNumber);
    const readablePageCount = cleanedPages.length - unreadablePages.length;

    const fullText = cleanedPages
      .map((p) => `--- Página ${p.pageNumber} ---\n${p.text}`)
      .join('\n\n')
      .trim();

    if (readablePageCount === 0 || fullText.length < 20) {
      throw new Error(
        'No se detectó texto seleccionable suficiente en el PDF (puede ser un libro escaneado sin texto digital).'
      );
    }

    const extractionWarnings: string[] = [];
    if (unreadablePages.length > 0) {
      const sample = unreadablePages.slice(0, 8).join(', ');
      const extra = unreadablePages.length > 8 ? ` y ${unreadablePages.length - 8} más` : '';
      extractionWarnings.push(
        `${unreadablePages.length} de ${totalPages} páginas no contienen texto digital legible (portadas, imágenes o páginas escaneadas: págs. ${sample}${extra}).`
      );
    }

    onProgress?.('Extracción estructurada completada.', 100);
    return {
      text: fullText,
      pageCount: totalPages,
      pages: cleanedPages,
      outline,
      readablePageCount,
      unreadablePages,
      extractionWarnings,
    };
  }

  onProgress?.('Leyendo contenido estructurado del libro...', 50);
  const text = await file.text();
  const structured = buildStructuredDocumentFromText(text);
  onProgress?.('Lectura completada.', 100);
  return structured;
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

  const cov = analysis.coverageReport;
  const coverageLines = cov
    ? [
        `- **Cobertura real verificada:** ${cov.realCoveragePercent}% (${cov.coveredPages}/${cov.totalPages} páginas; ${cov.processedChapters}/${cov.detectedChapters} capítulos procesados)`,
        ...(cov.unreadablePages.length > 0
          ? [`- **Páginas sin texto legible:** ${cov.unreadablePages.length} (${cov.unreadablePages.slice(0, 12).join(', ')})`]
          : []),
      ]
    : [];

  const lines: string[] = [
    `# Guía de Lectura y Resumen — ${analysis.title}`,
    ``,
    ...(analysis.authorOrSource ? [`- **Autor / Fuente:** ${analysis.authorOrSource}`] : []),
    `- **Documento base:** ${fileName}`,
    ...coverageLines,
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
      const pageRange =
        cap.startPage && cap.endPage ? ` (Págs. ${cap.startPage}–${cap.endPage})` : '';
      lines.push(`### Capítulo ${cap.n}: ${cap.titulo}${pageRange}`);
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
