import {
  ChapterItem,
  ChapterSegment,
  CoverageReport,
  ExtractedPage,
  PdfOutlineItem,
  StructureDetectionMethod,
} from '../data/enamoratePreset';

export interface HeadingCandidate {
  pageNumber: number;
  title: string;
  source: 'pdf_outline' | 'heading_regex' | 'font_heading';
}

export interface StructureDigest {
  totalPages: number;
  readablePages: number;
  outline: PdfOutlineItem[];
  tocExcerpt: string;
  headingCandidates: HeadingCandidate[];
  pageSamples: Array<{ pageNumber: number; preview: string }>;
  localSegments: ChapterSegment[];
  localMethod: StructureDetectionMethod;
}

const FRONT_MATTER_NOISE_REGEX =
  /^(?:portada|cover|title\s*page|copyright|cr[eé]ditos|derechos|dedicatoria|dedication|agradecimientos|acknowledg(?:e)?ments|[ií]ndice|contenido|tabla\s+de\s+contenidos|table\s+of\s+contents|contents|sobre\s+el\s+autor|about\s+the\s+author|acerca\s+del\s+autor|bibliograf[ií]a|bibliography|referencias|references|notas|notes|colof[oó]n)$/i;

const EXPLICIT_CHAPTER_REGEX =
  /^(?:(?:cap[ií]tulo|chapter|cap\.?)\s+(?:\d{1,3}|[ivxlcdm]{1,6}|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|one|two|three|four|five|six|seven|eight|nine|ten)\b.*|(?:parte|part|secci[oó]n|section|unidad|unit|m[oó]dulo|module|lecci[oó]n|lesson|bloque|principio|ley|regla|h[aá]bito)\s+(?:\d{1,3}|[ivxlcdm]{1,6})\b.*|(?:pr[oó]logo|prefacio|introducci[oó]n|ep[ií]logo|conclusi[oó]n|conclusiones|ap[eé]ndice|preface|prologue|introduction|epilogue|conclusion|appendix)(?:\s*[:\-–—].{0,80})?)$/i;

const NUMBERED_TITLE_REGEX = /^(?:\d{1,2}|[IVXLCDM]{1,5})[\.\-:\)]\s+[A-ZÁÉÍÓÚÑ][^\n]{3,95}$/;

const TOC_HEADER_REGEX = /^(?:[ií]ndice|contenido|tabla\s+de\s+contenidos|sumario|table\s+of\s+contents|contents)\b/i;

function cleanHeadingTitle(raw: string): string {
  return raw
    .replace(/\s+\.{2,}\s*\d+\s*$/, '')
    .replace(/\s+\d+\s*$/, (m) => (raw.length > 20 ? '' : m))
    .replace(/\s+/g, ' ')
    .trim();
}

function isNoiseTitle(title: string): boolean {
  const clean = cleanHeadingTitle(title).toLowerCase();
  if (!clean || clean.length < 2) return true;
  if (FRONT_MATTER_NOISE_REGEX.test(clean)) return true;
  if (/^\d+$/.test(clean)) return true;
  return false;
}

function isLikelyTocPage(page: ExtractedPage): boolean {
  const lines = page.text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;

  const hasTocHeader = lines.slice(0, 4).some((l) => TOC_HEADER_REGEX.test(l));
  const chapterLikeLines = lines.filter(
    (l) => EXPLICIT_CHAPTER_REGEX.test(l) || /\.{3,}\s*\d+$/.test(l)
  ).length;

  return (hasTocHeader && chapterLikeLines >= 3) || chapterLikeLines >= 5;
}

function extractChapterLabel(title: string, fallbackIndex: number): { n: string; titulo: string } {
  const cleaned = cleanHeadingTitle(title);
  const capMatch = cleaned.match(
    /^(?:cap[ií]tulo|chapter|cap\.?)\s+(\d{1,3}|[ivxlcdm]{1,6})(?:\s*[:.\-–—]\s*(.*))?$/i
  );
  if (capMatch) {
    const n = capMatch[1].toUpperCase();
    const rest = (capMatch[2] || '').trim();
    return { n, titulo: rest || cleaned };
  }

  const numPrefix = cleaned.match(/^(\d{1,2})\s*[\.\-:\)]\s+(.+)$/);
  if (numPrefix) {
    return { n: numPrefix[1], titulo: numPrefix[2].trim() };
  }

  return { n: String(fallbackIndex), titulo: cleaned };
}

export function normalizeAndValidateSegments(
  rawCandidates: Array<{ n?: string; titulo: string; startPage: number; endPage?: number }>,
  pages: ExtractedPage[],
  method: StructureDetectionMethod
): ChapterSegment[] {
  const totalPages = pages.length;
  if (totalPages === 0) return [];

  const pageMap = new Map<number, ExtractedPage>();
  pages.forEach((p) => pageMap.set(p.pageNumber, p));

  const minPage = pages[0].pageNumber;
  const maxPage = pages[pages.length - 1].pageNumber;

  const cleaned = rawCandidates
    .map((c) => ({
      n: (c.n || '').trim(),
      titulo: cleanHeadingTitle(c.titulo || ''),
      startPage: Math.max(minPage, Math.min(maxPage, Math.round(Number(c.startPage) || minPage))),
    }))
    .filter((c) => c.titulo.length >= 2)
    .sort((a, b) => a.startPage - b.startPage);

  // Deduplicate entries starting on the same page (keep the first meaningful one)
  const deduped: Array<{ n: string; titulo: string; startPage: number }> = [];
  for (const item of cleaned) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.startPage === item.startPage) {
      if (item.titulo.length > prev.titulo.length && prev.titulo.length < 18) {
        prev.titulo = item.titulo;
      }
      continue;
    }
    deduped.push(item);
  }

  // Fallback to equitable page blocks when <= 1 segment was detected on a multi-page book
  const readablePagesCount = pages.filter((p) => p.isReadable).length;
  if (deduped.length === 0 || (deduped.length === 1 && readablePagesCount >= 12)) {
    const targetBlockPages =
      readablePagesCount <= 24 ? 6 : readablePagesCount <= 80 ? 12 : readablePagesCount <= 200 ? 18 : 24;
    const blockCount = Math.max(2, Math.min(18, Math.ceil(totalPages / targetBlockPages)));
    const pagesPerBlock = Math.ceil(totalPages / blockCount);
    const blocks: ChapterSegment[] = [];

    for (let b = 0; b < blockCount; b++) {
      const startIdx = b * pagesPerBlock;
      if (startIdx >= totalPages) break;
      const endIdx = Math.min(totalPages - 1, (b + 1) * pagesPerBlock - 1);
      const slice = pages.slice(startIdx, endIdx + 1);
      const charCount = slice.reduce((acc, p) => acc + p.charCount, 0);
      const readableInSlice = slice.filter((p) => p.isReadable).length;
      const firstHint = slice.find((p) => p.headings.length > 0)?.headings[0];
      blocks.push({
        n: String(b + 1),
        titulo: firstHint
          ? cleanHeadingTitle(firstHint).slice(0, 90)
          : `Sección ${b + 1} (Págs. ${slice[0].pageNumber}–${slice[slice.length - 1].pageNumber})`,
        startPage: slice[0].pageNumber,
        endPage: slice[slice.length - 1].pageNumber,
        charCount,
        readablePagesCount: readableInSlice,
        source: 'page_blocks',
      });
    }
    return blocks;
  }

  // Check if substantial readable text exists before the first detected chapter
  if (deduped[0].startPage > minPage) {
    const leadingPages = pages.filter(
      (p) => p.pageNumber >= minPage && p.pageNumber < deduped[0].startPage && p.isReadable
    );
    const leadingChars = leadingPages.reduce((sum, p) => sum + p.charCount, 0);
    if (leadingChars >= 700 && leadingPages.length >= 2) {
      deduped.unshift({
        n: '0',
        titulo: 'Introducción y Preliminares',
        startPage: leadingPages[0].pageNumber,
      });
    } else if (leadingPages.length > 0) {
      deduped[0].startPage = leadingPages[0].pageNumber;
    }
  }

  // Assign contiguous endPage ranges covering through the very last page of the book
  const segments: ChapterSegment[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const curr = deduped[i];
    const next = deduped[i + 1];
    const startPage = curr.startPage;
    const endPage = next ? Math.max(startPage, next.startPage - 1) : maxPage;

    const slice = pages.filter((p) => p.pageNumber >= startPage && p.pageNumber <= endPage);
    const charCount = slice.reduce((acc, p) => acc + p.charCount, 0);
    const readableInSlice = slice.filter((p) => p.isReadable).length;

    const extracted = extractChapterLabel(curr.titulo, i + 1);
    segments.push({
      n: curr.n || extracted.n,
      titulo: extracted.titulo,
      startPage,
      endPage,
      charCount,
      readablePagesCount: readableInSlice,
      source: method,
    });
  }

  // Merge empty/tiny segments (< 150 chars) into neighbors so we don't analyze blank divider pages
  const nonEmpty: ChapterSegment[] = [];
  for (const seg of segments) {
    if (seg.charCount < 150 && nonEmpty.length > 0) {
      const prev = nonEmpty[nonEmpty.length - 1];
      prev.endPage = seg.endPage;
      prev.charCount += seg.charCount;
      prev.readablePagesCount += seg.readablePagesCount;
    } else {
      nonEmpty.push(seg);
    }
  }

  return nonEmpty.map((s, idx) => ({
    ...s,
    n: s.n || String(idx + 1),
  }));
}

export function detectLocalChapterCandidates(
  pages: ExtractedPage[],
  outline: PdfOutlineItem[]
): StructureDigest {
  const totalPages = pages.length;
  const readablePages = pages.filter((p) => p.isReadable).length;
  const tocLines: string[] = [];
  const headingCandidates: HeadingCandidate[] = [];

  // 1. Evaluate native PDF outline
  const meaningfulOutline = outline.filter((o) => !isNoiseTitle(o.title));
  const level0Outline = meaningfulOutline.filter((o) => o.level === 0);
  const chosenOutline = level0Outline.length >= 2 ? level0Outline : meaningfulOutline;

  if (chosenOutline.length >= 2) {
    for (const item of chosenOutline) {
      headingCandidates.push({
        pageNumber: item.pageNumber,
        title: cleanHeadingTitle(item.title),
        source: 'pdf_outline',
      });
    }
  }

  // 2. Scan ALL pages for TOC pages and structural chapter headings
  const regexCandidates: HeadingCandidate[] = [];
  for (const page of pages) {
    if (!page.isReadable) continue;

    if (page.pageNumber <= 15 && isLikelyTocPage(page)) {
      tocLines.push(`--- Índice (Página ${page.pageNumber}) ---\n${page.text.slice(0, 2800)}`);
      continue;
    }

    const lines = page.text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    // Inspect top lines of the page (where chapters start) + font-detected headings
    const candidateLines = new Set<string>([...lines.slice(0, 12), ...page.headings]);

    for (const line of candidateLines) {
      if (line.length < 3 || line.length > 140) continue;
      if (isNoiseTitle(line)) continue;

      if (EXPLICIT_CHAPTER_REGEX.test(line)) {
        // Combine with next line if current line is just "CAPÍTULO 1" or "CHAPTER 2"
        let fullTitle = line;
        const lineIdx = lines.indexOf(line);
        if (
          /^(?:cap[ií]tulo|chapter|cap\.?|parte|part|secci[oó]n|unidad|m[oó]dulo)\s+(?:\d{1,3}|[ivxlcdm]{1,6})\s*[:.\-–—]?$/i.test(
            line
          ) &&
          lineIdx >= 0 &&
          lineIdx + 1 < lines.length
        ) {
          const nextLine = lines[lineIdx + 1];
          if (nextLine && nextLine.length >= 3 && nextLine.length <= 100) {
            fullTitle = `${line}: ${nextLine}`;
          }
        }
        regexCandidates.push({
          pageNumber: page.pageNumber,
          title: cleanHeadingTitle(fullTitle),
          source: 'heading_regex',
        });
        break; // At most 1 primary chapter start per page
      } else if (page.headings.includes(line) && NUMBERED_TITLE_REGEX.test(line)) {
        regexCandidates.push({
          pageNumber: page.pageNumber,
          title: cleanHeadingTitle(line),
          source: 'font_heading',
        });
        break;
      }
    }
  }

  // Combine candidates cleanly
  let localSegments: ChapterSegment[];
  let localMethod: StructureDetectionMethod;

  if (chosenOutline.length >= 2) {
    localMethod = 'pdf_outline';
    localSegments = normalizeAndValidateSegments(
      chosenOutline.map((o, idx) => ({
        ...extractChapterLabel(o.title, idx + 1),
        startPage: o.pageNumber,
      })),
      pages,
      'pdf_outline'
    );
  } else if (regexCandidates.length >= 2) {
    localMethod = 'heading_detection';
    localSegments = normalizeAndValidateSegments(
      regexCandidates.map((c, idx) => ({
        ...extractChapterLabel(c.title, idx + 1),
        startPage: c.pageNumber,
      })),
      pages,
      'heading_detection'
    );
  } else {
    localMethod = 'page_blocks';
    localSegments = normalizeAndValidateSegments([], pages, 'page_blocks');
  }

  const allCandidates = [...headingCandidates, ...regexCandidates].slice(0, 120);

  // Build lightweight page samples covering page 1 through totalPages
  const maxSamples = 45;
  const step = Math.max(1, Math.floor(totalPages / maxSamples));
  const samplePageNums = new Set<number>();
  for (let i = 0; i < totalPages; i += step) {
    samplePageNums.add(pages[i].pageNumber);
  }
  if (totalPages > 0) {
    samplePageNums.add(pages[0].pageNumber);
    samplePageNums.add(pages[totalPages - 1].pageNumber);
  }
  allCandidates.forEach((c) => samplePageNums.add(c.pageNumber));

  const pageSamples = [...samplePageNums]
    .sort((a, b) => a - b)
    .slice(0, 70)
    .map((pNum) => {
      const page = pages.find((p) => p.pageNumber === pNum);
      const preview = page
        ? page.text
            .split('\n')
            .slice(0, 5)
            .join(' | ')
            .slice(0, 240)
        : '';
      return { pageNumber: pNum, preview };
    })
    .filter((s) => s.preview.length > 0);

  return {
    totalPages,
    readablePages,
    outline: chosenOutline.slice(0, 80),
    tocExcerpt: tocLines.join('\n\n').slice(0, 6000),
    headingCandidates: allCandidates,
    pageSamples,
    localSegments,
    localMethod,
  };
}

export function getChapterRawText(
  pages: ExtractedPage[],
  startPage: number,
  endPage: number
): string {
  return pages
    .filter((p) => p.pageNumber >= startPage && p.pageNumber <= endPage && p.text.trim().length > 0)
    .map((p) => `--- Página ${p.pageNumber} ---\n${p.text}`)
    .join('\n\n');
}

export function computeCoverageReport(
  pages: ExtractedPage[],
  chapters: ChapterItem[],
  detectionMethod: StructureDetectionMethod
): CoverageReport {
  const totalPages = pages.length;
  const readablePageList = pages.filter((p) => p.isReadable);
  const readablePages = readablePageList.length;
  const unreadablePages = pages.filter((p) => !p.isReadable).map((p) => p.pageNumber);

  const detectedChapters = chapters.length;
  const processedChapters = chapters.filter(
    (c) => (c.status ?? 'completed') === 'completed'
  ).length;
  const failedChapters = chapters.filter((c) => c.status === 'error').length;
  const pendingChapters = chapters.filter(
    (c) => c.status === 'pending' || c.status === 'processing'
  ).length;

  const coveredReadableSet = new Set<number>();
  for (const ch of chapters) {
    if ((ch.status ?? 'completed') !== 'completed') continue;
    const sp = ch.startPage;
    const ep = ch.endPage;
    if (typeof sp === 'number' && typeof ep === 'number') {
      for (const p of readablePageList) {
        if (p.pageNumber >= sp && p.pageNumber <= ep) {
          coveredReadableSet.add(p.pageNumber);
        }
      }
    }
  }

  // Fallback for legacy chapters that had no page ranges attached
  const chaptersHavePageRanges = chapters.some(
    (c) => typeof c.startPage === 'number' && typeof c.endPage === 'number'
  );
  if (!chaptersHavePageRanges && processedChapters > 0 && detectedChapters > 0) {
    const ratio = processedChapters / detectedChapters;
    const estCount = Math.floor(readablePages * ratio);
    for (let i = 0; i < estCount; i++) {
      coveredReadableSet.add(readablePageList[i].pageNumber);
    }
  }

  const coveredPages = coveredReadableSet.size;
  const uncoveredReadablePages = readablePageList
    .map((p) => p.pageNumber)
    .filter((pNum) => !coveredReadableSet.has(pNum));

  const hasFullCoverage =
    totalPages > 0 &&
    unreadablePages.length === 0 &&
    uncoveredReadablePages.length === 0 &&
    pendingChapters === 0 &&
    failedChapters === 0 &&
    detectedChapters > 0 &&
    processedChapters === detectedChapters;

  const rawTotalPct = totalPages > 0 ? Math.round((coveredPages / totalPages) * 100) : 0;
  const rawReadablePct = readablePages > 0 ? Math.round((coveredPages / readablePages) * 100) : 0;

  // STRICT RULE: Never declare 100% if any page is unreadable, uncovered, or any chapter is pending/failed
  const realCoveragePercent = hasFullCoverage ? 100 : Math.min(99, rawTotalPct);
  const readableCoveragePercent =
    uncoveredReadablePages.length === 0 && pendingChapters === 0 && failedChapters === 0 && detectedChapters > 0
      ? 100
      : Math.min(99, rawReadablePct);

  const warnings: string[] = [];
  if (unreadablePages.length > 0) {
    const sample = unreadablePages.slice(0, 6).join(', ');
    const more = unreadablePages.length > 6 ? ` (+${unreadablePages.length - 6})` : '';
    warnings.push(
      `${unreadablePages.length} página(s) sin texto digital legible (págs. ${sample}${more}).`
    );
  }
  if (pendingChapters > 0) {
    warnings.push(`${pendingChapters} capítulo(s) aún pendientes de análisis.`);
  }
  if (failedChapters > 0) {
    warnings.push(`${failedChapters} capítulo(s) con error; puedes reintentarlos individualmente.`);
  }
  if (uncoveredReadablePages.length > 0 && pendingChapters === 0 && failedChapters === 0) {
    warnings.push(
      `${uncoveredReadablePages.length} página(s) con texto quedaron fuera de capítulos completados.`
    );
  }

  return {
    totalPages,
    readablePages,
    unreadablePages,
    coveredPages,
    uncoveredReadablePages,
    detectedChapters,
    processedChapters,
    failedChapters,
    pendingChapters,
    realCoveragePercent,
    readableCoveragePercent,
    detectionMethod,
    hasFullCoverage,
    warnings,
  };
}
