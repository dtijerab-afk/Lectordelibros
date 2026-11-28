import { ChapterItem, ExtractedPage } from '../data/enamoratePreset';

const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a', 'en', 'con',
  'por', 'para', 'sobre', 'entre', 'hacia', 'desde', 'hasta', 'sin', 'que', 'cual', 'quien',
  'como', 'cuando', 'donde', 'pero', 'mas', 'porque', 'aunque', 'si', 'no', 'ni', 'o', 'u',
  'y', 'e', 'es', 'son', 'fue', 'fueron', 'ser', 'esta', 'estan', 'este', 'esta', 'estos',
  'estas', 'ese', 'esa', 'esos', 'esas', 'su', 'sus', 'mi', 'mis', 'tu', 'tus', 'se', 'lo',
  'le', 'les', 'me', 'te', 'nos', 'muy', 'ya', 'hay', 'todo', 'toda', 'todos', 'todas',
  'libro', 'capitulo', 'texto', 'pagina', 'paginas', 'dice', 'habla', 'explica', 'resumen',
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'about', 'what',
]);

function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  return normalizeForSearch(text)
    .split(' ')
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function findChapterLabelForPage(pageNumber: number, chapters: ChapterItem[]): string {
  for (const ch of chapters) {
    if (
      typeof ch.startPage === 'number' &&
      typeof ch.endPage === 'number' &&
      pageNumber >= ch.startPage &&
      pageNumber <= ch.endPage
    ) {
      return `Cap. ${ch.n}: ${ch.titulo}`;
    }
  }
  return '';
}

export function buildChapterDirectory(chapters: ChapterItem[]): string {
  if (!Array.isArray(chapters) || chapters.length === 0) return '';
  return chapters
    .map((ch) => {
      const range =
        typeof ch.startPage === 'number' && typeof ch.endPage === 'number'
          ? ` (Págs. ${ch.startPage}–${ch.endPage})`
          : '';
      const idea = ch.idea ? ` — ${ch.idea.slice(0, 220)}` : '';
      return `• Capítulo ${ch.n}: ${ch.titulo}${range}${idea}`;
    })
    .join('\n');
}

export function retrieveRelevantPassages(
  pages: ExtractedPage[],
  chapters: ChapterItem[],
  query: string,
  options?: { maxChars?: number; topK?: number }
): string {
  const maxChars = options?.maxChars ?? 42000;
  const topK = options?.topK ?? 22;

  if (!Array.isArray(pages) || pages.length === 0) return '';

  const readablePages = pages.filter((p) => p.text.trim().length > 0);
  if (readablePages.length === 0) return '';

  // If the entire book fits comfortably inside maxChars, return all pages directly!
  const totalBookChars = readablePages.reduce((sum, p) => sum + p.text.length, 0);
  if (totalBookChars <= maxChars) {
    return readablePages
      .map((p) => {
        const chLabel = findChapterLabelForPage(p.pageNumber, chapters);
        const header = chLabel
          ? `[Página ${p.pageNumber} | ${chLabel}]`
          : `[Página ${p.pageNumber}]`;
        return `${header}\n${p.text}`;
      })
      .join('\n\n');
  }

  const normalizedQuery = normalizeForSearch(query);
  const queryTokens = tokenize(query);

  // Detect explicit positional intent (e.g., "últimas páginas", "final del libro", "página 180", "capítulo 9")
  const asksAboutEnding =
    /\b(ultim[ao]s?|final|conclusion|conclusiones|epilogo|cierre|termina|acaba|desenlace)\b/.test(
      normalizedQuery
    );
  const asksAboutBeginning =
    /\b(primer[ao]s?|inicio|comienzo|prologo|prefacio|introduccion|empieza)\b/.test(
      normalizedQuery
    );

  const explicitPages = new Set<number>();
  for (const m of normalizedQuery.matchAll(/\b(?:pagina|paginas|pag|pags|p)\s*(\d{1,4})\b/g)) {
    const pNum = Number(m[1]);
    if (pNum >= 1) {
      explicitPages.add(pNum);
      explicitPages.add(pNum - 1);
      explicitPages.add(pNum + 1);
    }
  }

  const explicitChapterPages = new Set<number>();
  for (const m of normalizedQuery.matchAll(/\b(?:capitulo|cap|chapter)\s*(\d{1,3})\b/g)) {
    const targetN = m[1];
    const found = chapters.find(
      (c) => String(c.n).trim().toLowerCase() === targetN.toLowerCase()
    );
    if (found && typeof found.startPage === 'number' && typeof found.endPage === 'number') {
      for (let p = found.startPage; p <= found.endPage; p++) {
        explicitChapterPages.add(p);
      }
    }
  }

  // Split pages into searchable chunks (~1,200 chars)
  interface Chunk {
    pageNumber: number;
    chapterLabel: string;
    text: string;
    tokens: string[];
    normText: string;
    orderIdx: number;
  }

  const chunks: Chunk[] = [];
  let orderIdx = 0;

  for (const page of readablePages) {
    const chapterLabel = findChapterLabelForPage(page.pageNumber, chapters);
    const raw = page.text.trim();
    if (raw.length <= 1500) {
      chunks.push({
        pageNumber: page.pageNumber,
        chapterLabel,
        text: raw,
        tokens: tokenize(raw),
        normText: normalizeForSearch(raw),
        orderIdx: orderIdx++,
      });
    } else {
      const paras = raw.split(/\n\n+/);
      let buf = '';
      for (const para of paras) {
        if (buf.length + para.length > 1300 && buf.length > 350) {
          chunks.push({
            pageNumber: page.pageNumber,
            chapterLabel,
            text: buf.trim(),
            tokens: tokenize(buf),
            normText: normalizeForSearch(buf),
            orderIdx: orderIdx++,
          });
          buf = para;
        } else {
          buf = buf ? `${buf}\n\n${para}` : para;
        }
      }
      if (buf.trim()) {
        chunks.push({
          pageNumber: page.pageNumber,
          chapterLabel,
          text: buf.trim(),
          tokens: tokenize(buf),
          normText: normalizeForSearch(buf),
          orderIdx: orderIdx++,
        });
      }
    }
  }

  // Compute IDF across chunks
  const docFreq = new Map<string, number>();
  for (const ch of chunks) {
    const unique = new Set(ch.tokens);
    for (const t of unique) {
      docFreq.set(t, (docFreq.get(t) || 0) + 1);
    }
  }

  const totalChunks = chunks.length;
  const maxPageNum = readablePages[readablePages.length - 1].pageNumber;
  const minPageNum = readablePages[0].pageNumber;
  const tailStartPage = Math.max(minPageNum, maxPageNum - Math.max(5, Math.floor(readablePages.length * 0.1)));

  const scored = chunks.map((chunk) => {
    let score = 0;

    // BM25-like lexical scoring
    if (queryTokens.length > 0 && chunk.tokens.length > 0) {
      const tfMap = new Map<string, number>();
      for (const t of chunk.tokens) {
        tfMap.set(t, (tfMap.get(t) || 0) + 1);
      }
      const uniqueMatched = new Set<string>();
      for (const qt of queryTokens) {
        const tf = tfMap.get(qt) || 0;
        if (tf > 0) {
          uniqueMatched.add(qt);
          const df = docFreq.get(qt) || 1;
          const idf = Math.log(1 + (totalChunks - df + 0.5) / (df + 0.5));
          score += idf * ((tf * 2.2) / (tf + 1.2));
        } else if (qt.length >= 5 && chunk.normText.includes(qt)) {
          // Prefix/substring match for Spanish inflections
          uniqueMatched.add(qt);
          score += 0.9;
        }
      }
      // Coverage bonus for matching multiple distinct query keywords
      score += uniqueMatched.size * 1.4;
    }

    // Explicit page/chapter/positional boosts
    if (explicitPages.has(chunk.pageNumber)) {
      score += 40;
    }
    if (explicitChapterPages.has(chunk.pageNumber)) {
      score += 22;
    }
    if (asksAboutEnding && chunk.pageNumber >= tailStartPage) {
      score += 28 + ((chunk.pageNumber - tailStartPage) / Math.max(1, maxPageNum - tailStartPage)) * 12;
    }
    if (asksAboutBeginning && chunk.pageNumber <= minPageNum + 5) {
      score += 22;
    }

    return { chunk, score };
  });

  scored.sort((a, b) => b.score - a.score || a.chunk.orderIdx - b.chunk.orderIdx);

  const selected: Chunk[] = [];
  const selectedIds = new Set<number>();
  let usedChars = 0;

  for (const item of scored) {
    if (selected.length >= topK) break;
    if (usedChars + item.chunk.text.length > maxChars && selected.length >= 4) continue;
    selected.push(item.chunk);
    selectedIds.add(item.chunk.orderIdx);
    usedChars += item.chunk.text.length;
  }

  // Always guarantee at least 1 anchor passage from the final pages if budget allows and ending wasn't already covered
  if (usedChars < maxChars - 1800) {
    const lastChunk = chunks[chunks.length - 1];
    if (lastChunk && !selectedIds.has(lastChunk.orderIdx)) {
      selected.push(lastChunk);
      selectedIds.add(lastChunk.orderIdx);
    }
  }

  // Return passages sorted in reading order for coherent LLM reasoning
  selected.sort((a, b) => a.orderIdx - b.orderIdx);

  return selected
    .map((c) => {
      const header = c.chapterLabel
        ? `[Página ${c.pageNumber} | ${c.chapterLabel}]`
        : `[Página ${c.pageNumber}]`;
      return `${header}\n${c.text}`;
    })
    .join('\n\n');
}

export function buildBalancedBookQuizContext(
  pages: ExtractedPage[],
  chapters: ChapterItem[],
  maxChars = 75000
): string {
  if (!Array.isArray(chapters) || chapters.length === 0) {
    // Even without chapters, sample evenly from start, middle, and end pages
    const readable = pages.filter((p) => p.text.trim().length > 0);
    if (readable.length === 0) return '';
    const perPageBudget = Math.max(400, Math.floor(maxChars / readable.length));
    return readable
      .map((p) => `[Página ${p.pageNumber}]\n${p.text.slice(0, perPageBudget)}`)
      .join('\n\n')
      .slice(0, maxChars);
  }

  const perChapterBudget = Math.max(1600, Math.floor(maxChars / chapters.length));
  const parts: string[] = [];

  for (const ch of chapters) {
    const range =
      typeof ch.startPage === 'number' && typeof ch.endPage === 'number'
        ? `Págs. ${ch.startPage}–${ch.endPage}`
        : '';

    const summaryLines = [
      `=== CAPÍTULO ${ch.n}: ${ch.titulo} ${range ? `(${range})` : ''} ===`,
      ch.idea ? `Tesis: ${ch.idea}` : '',
      ch.analisisDetallado ? `Análisis: ${ch.analisisDetallado.slice(0, 1200)}` : '',
      ch.historia ? `Casos/Ejemplos: ${ch.historia.slice(0, 700)}` : '',
      Array.isArray(ch.conceptosClave) && ch.conceptosClave.length > 0
        ? `Conceptos: ${ch.conceptosClave.map((c) => `${c.termino}: ${c.definicion}`).join(' | ').slice(0, 700)}`
        : '',
    ].filter(Boolean);

    let block = summaryLines.join('\n');

    // Add raw text excerpt from this chapter's actual pages (including its closing pages)
    if (typeof ch.startPage === 'number' && typeof ch.endPage === 'number') {
      const chPages = pages.filter(
        (p) => p.pageNumber >= ch.startPage! && p.pageNumber <= ch.endPage! && p.text.trim().length > 0
      );
      const remaining = perChapterBudget - block.length;
      if (remaining > 400 && chPages.length > 0) {
        const firstP = chPages[0];
        const lastP = chPages[chPages.length - 1];
        const rawSnippet =
          firstP.pageNumber === lastP.pageNumber
            ? `[Pág. ${firstP.pageNumber}] ${firstP.text.slice(0, remaining - 80)}`
            : `[Pág. ${firstP.pageNumber}] ${firstP.text.slice(0, Math.floor(remaining * 0.45))}\n[Pág. ${lastP.pageNumber}] ${lastP.text.slice(0, Math.floor(remaining * 0.45))}`;
        block += `\nExtractos textuales:\n${rawSnippet}`;
      }
    }

    parts.push(block.slice(0, perChapterBudget));
  }

  return parts.join('\n\n').slice(0, maxChars);
}
