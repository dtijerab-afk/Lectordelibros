import { DocumentAnalysis, ChapterItem } from '../data/enamoratePreset';
import {
  ChapterMasteryStat,
  CompactBookDigest,
  CompactChapterDigest,
  ConceptMasteryStat,
  EvaluationAttemptRecord,
  Stage3EvaluationSet,
  Stage3OpenGrade,
  TokenUsageRecord,
} from '../types/stage3';

export interface Stage3EvaluationDraft {
  selectedOptions: Record<string, number>;
  selectedBooleans: Record<string, boolean>;
  openDrafts: Record<string, string>;
  openGrades: Record<string, Stage3OpenGrade>;
}

export interface Stage3BookCache {
  version: 1;
  bookFingerprint: string;
  bookTitle: string;
  updatedAt: string;
  evaluations: Record<string, Stage3EvaluationSet>;
  evaluationDrafts: Record<string, Stage3EvaluationDraft>;
  attempts: EvaluationAttemptRecord[];
  tokenLedger: TokenUsageRecord[];
}

const DB_NAME = 'LecturaVivaStage3DB';
const DB_VERSION = 1;
const STORE_NAME = 'stage3_cache';
const LS_PREFIX = 'lecturaviva_stage3_cache_v1_';

/**
 * Deterministic lightweight fingerprint of analyzed book content.
 * Ensures cached evaluations and tracking records are reused automatically while
 * the book's analyzed content remains unchanged, and invalidated cleanly if re-analyzed.
 */
export function computeBookFingerprint(analysis: DocumentAnalysis | null): string {
  if (!analysis) return 'empty-book';
  const chapterSig = (analysis.chapters || [])
    .map(
      (c) =>
        `${c.n}|${c.titulo}|${c.startPage ?? ''}-${c.endPage ?? ''}|${(c.idea || '').slice(0, 60)}|${
          c.status || ''
        }`
    )
    .join(';;');
  const raw = `${analysis.title || ''}::${analysis.authorOrSource || ''}::${
    (analysis.chapters || []).length
  }::${chapterSig}`;

  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `book-${(hash >>> 0).toString(16)}`;
}

export function createEmptyStage3Cache(bookFingerprint: string, bookTitle: string): Stage3BookCache {
  return {
    version: 1,
    bookFingerprint,
    bookTitle,
    updatedAt: new Date().toISOString(),
    evaluations: {},
    evaluationDrafts: {},
    attempts: [],
    tokenLedger: [],
  };
}

function openStage3Db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open Stage 3 IndexedDB'));
  });
}

export async function loadStage3Cache(
  bookFingerprint: string,
  bookTitle: string
): Promise<Stage3BookCache> {
  try {
    const db = await openStage3Db();
    const record = await new Promise<Stage3BookCache | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(bookFingerprint);
      req.onsuccess = () => resolve(req.result as Stage3BookCache | undefined);
      req.onerror = () => reject(req.error || new Error('Stage 3 read failed'));
    });
    db.close();
    if (record && record.version === 1 && record.bookFingerprint === bookFingerprint) {
      return {
        ...createEmptyStage3Cache(bookFingerprint, bookTitle),
        ...record,
      };
    }
  } catch {
    // Fallback to localStorage
  }

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(`${LS_PREFIX}${bookFingerprint}`);
      if (raw) {
        const parsed = JSON.parse(raw) as Stage3BookCache;
        if (parsed && parsed.version === 1 && parsed.bookFingerprint === bookFingerprint) {
          return {
            ...createEmptyStage3Cache(bookFingerprint, bookTitle),
            ...parsed,
          };
        }
      }
    }
  } catch {
    // Ignore corrupt fallback
  }

  return createEmptyStage3Cache(bookFingerprint, bookTitle);
}

export async function saveStage3Cache(cache: Stage3BookCache): Promise<boolean> {
  const payload: Stage3BookCache = {
    ...cache,
    updatedAt: new Date().toISOString(),
  };

  try {
    const db = await openStage3Db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(payload, payload.bookFingerprint);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Stage 3 write failed'));
    });
    db.close();
    return true;
  } catch {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const serialized = JSON.stringify(payload);
        if (serialized.length < 3_000_000) {
          window.localStorage.setItem(`${LS_PREFIX}${payload.bookFingerprint}`, serialized);
          return true;
        }
      }
    } catch {
      // Ignore storage quota errors
    }
    return false;
  }
}

/**
 * Builds a compact, token-efficient digest of a single chapter from ALREADY STORED
 * Etapa 1 analysis — never sending raw PDF text back to Gemini.
 */
export function buildCompactChapterDigest(
  chapter: ChapterItem,
  maxAnalysisChars = 1400
): CompactChapterDigest {
  return {
    n: String(chapter.n),
    titulo: chapter.titulo,
    startPage: chapter.startPage,
    endPage: chapter.endPage,
    idea: (chapter.idea || '').slice(0, 420),
    resumenAnalisis: (chapter.analisisDetallado || chapter.idea || '').slice(0, maxAnalysisChars),
    historiaBreve: (chapter.historia || '').slice(0, 500),
    conceptosClave: (chapter.conceptosClave || []).slice(0, 8).map((c) => ({
      termino: c.termino,
      definicion: (c.definicion || '').slice(0, 220),
    })),
    consejos: (chapter.consejos || []).slice(0, 5).map((t) => t.slice(0, 200)),
    citaCapitulo: chapter.citaCapitulo ? chapter.citaCapitulo.slice(0, 240) : undefined,
  };
}

/**
 * Builds a compact, token-efficient book-wide digest covering ALL chapters
 * proportionally so integral evaluations cover the entire book
 * without re-sending the raw PDF.
 */
export function buildCompactBookDigest(analysis: DocumentAnalysis): CompactBookDigest {
  const chapters = analysis.chapters || [];
  // Scale per-chapter snippet inversely with chapter count to keep token budget predictable
  const perChapterAnalysisBudget =
    chapters.length <= 6 ? 650 : chapters.length <= 15 ? 360 : 220;

  return {
    title: analysis.title,
    authorOrSource: analysis.authorOrSource,
    executiveSummary: (analysis.executiveSummary || '').slice(0, 1400),
    objectives: (analysis.objectives || []).slice(0, 6),
    keyPoints: (analysis.keyPoints || []).slice(0, 14).map((kp) => ({
      heading: kp.heading,
      detail: (kp.detail || '').slice(0, 260),
      category: kp.category,
    })),
    keyMetrics: (analysis.keyMetrics || []).slice(0, 14).map((m) => ({
      label: m.label,
      value: m.value,
      context: (m.context || '').slice(0, 200),
    })),
    conclusions: (analysis.conclusions || []).slice(0, 8),
    chapters: chapters.map((ch) => buildCompactChapterDigest(ch, perChapterAnalysisBudget)),
  };
}

/**
 * Computes per-chapter comprehension stats, mastered concepts vs concepts needing
 * reinforcement, and overall comprehension percentage (distinct from PDF coverage %).
 */
export function computeLearningAnalytics(
  attempts: EvaluationAttemptRecord[],
  chapters: ChapterItem[]
): {
  overallComprehensionPercent: number | null;
  totalAttempts: number;
  totalCorrect: number;
  totalIncorrect: number;
  chapterStats: ChapterMasteryStat[];
  masteredConcepts: ConceptMasteryStat[];
  reinforceConcepts: ConceptMasteryStat[];
  evolutionSeries: Array<{
    attemptNumber: number;
    label: string;
    scope: 'chapter' | 'integral';
    comprehensionPercent: number;
    completedAt: string;
  }>;
} {
  if (attempts.length === 0) {
    return {
      overallComprehensionPercent: null,
      totalAttempts: 0,
      totalCorrect: 0,
      totalIncorrect: 0,
      chapterStats: chapters.map((ch) => ({
        chapterNumber: String(ch.n),
        chapterTitle: ch.titulo,
        attempts: 0,
        correct: 0,
        incorrect: 0,
        comprehensionPercent: 0,
      })),
      masteredConcepts: [],
      reinforceConcepts: [],
      evolutionSeries: [],
    };
  }

  let totalCorrect = 0;
  let totalIncorrect = 0;

  const chapterTitleMap = new Map<string, string>();
  chapters.forEach((ch) => chapterTitleMap.set(String(ch.n), ch.titulo));

  const chapterAccum = new Map<
    string,
    { attempts: Set<string>; correct: number; incorrect: number }
  >();
  chapters.forEach((ch) =>
    chapterAccum.set(String(ch.n), { attempts: new Set(), correct: 0, incorrect: 0 })
  );

  const conceptAccum = new Map<
    string,
    { display: string; chapters: Set<string>; correct: number; total: number }
  >();

  attempts.forEach((att) => {
    totalCorrect += att.correctCount;
    totalIncorrect += att.incorrectCount;

    if (att.conceptOutcomes.length > 0) {
      att.conceptOutcomes.forEach((co) => {
        const chKey = String(co.chapterNumber || att.chapterNumber || '1');
        if (!chapterAccum.has(chKey)) {
          chapterAccum.set(chKey, { attempts: new Set(), correct: 0, incorrect: 0 });
        }
        const entry = chapterAccum.get(chKey)!;
        entry.attempts.add(att.id);
        if (co.isCorrect) entry.correct += 1;
        else entry.incorrect += 1;

        const normConcept = co.concept.trim().toLowerCase();
        if (normConcept) {
          if (!conceptAccum.has(normConcept)) {
            conceptAccum.set(normConcept, {
              display: co.concept.trim(),
              chapters: new Set(),
              correct: 0,
              total: 0,
            });
          }
          const cEntry = conceptAccum.get(normConcept)!;
          cEntry.chapters.add(chKey);
          cEntry.total += 1;
          if (co.isCorrect) cEntry.correct += 1;
        }
      });
    } else if (att.chapterNumber) {
      const chKey = String(att.chapterNumber);
      if (!chapterAccum.has(chKey)) {
        chapterAccum.set(chKey, { attempts: new Set(), correct: 0, incorrect: 0 });
      }
      const entry = chapterAccum.get(chKey)!;
      entry.attempts.add(att.id);
      entry.correct += att.correctCount;
      entry.incorrect += att.incorrectCount;
    }
  });

  const chapterStats: ChapterMasteryStat[] = Array.from(chapterAccum.entries()).map(
    ([chapterNumber, data]) => {
      const total = data.correct + data.incorrect;
      return {
        chapterNumber,
        chapterTitle: chapterTitleMap.get(chapterNumber) || `Capítulo ${chapterNumber}`,
        attempts: data.attempts.size,
        correct: data.correct,
        incorrect: data.incorrect,
        comprehensionPercent: total > 0 ? Math.round((data.correct / total) * 100) : 0,
      };
    }
  );

  const allConcepts: ConceptMasteryStat[] = Array.from(conceptAccum.values()).map((c) => {
    const accuracyPercent = c.total > 0 ? Math.round((c.correct / c.total) * 100) : 0;
    return {
      concept: c.display,
      chapterNumbers: Array.from(c.chapters),
      correct: c.correct,
      total: c.total,
      accuracyPercent,
      status: accuracyPercent >= 75 ? 'mastered' : 'reinforce',
    };
  });

  const masteredConcepts = allConcepts
    .filter((c) => c.status === 'mastered')
    .sort((a, b) => b.accuracyPercent - a.accuracyPercent || b.total - a.total);

  const reinforceConcepts = allConcepts
    .filter((c) => c.status === 'reinforce')
    .sort((a, b) => a.accuracyPercent - b.accuracyPercent || b.total - a.total);

  const totalAnsweredAll = totalCorrect + totalIncorrect;
  const overallComprehensionPercent =
    totalAnsweredAll > 0 ? Math.round((totalCorrect / totalAnsweredAll) * 100) : null;

  const sortedAttempts = [...attempts].sort(
    (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
  );

  const evolutionSeries = sortedAttempts.map((att, idx) => ({
    attemptNumber: idx + 1,
    label: att.scope === 'integral' ? 'Integral' : `Cap. ${att.chapterNumber || '?'}`,
    scope: att.scope,
    comprehensionPercent: att.comprehensionPercent,
    completedAt: att.completedAt,
  }));

  return {
    overallComprehensionPercent,
    totalAttempts: attempts.length,
    totalCorrect,
    totalIncorrect,
    chapterStats,
    masteredConcepts,
    reinforceConcepts,
    evolutionSeries,
  };
}

export function summarizeTokenLedger(ledger: TokenUsageRecord[]) {
  let apiCalls = 0;
  let cacheHits = 0;
  let realInputTokens = 0;
  let realOutputTokens = 0;
  let realThoughtsTokens = 0;
  let estimatedInputTokens = 0;
  let estimatedOutputTokens = 0;
  let totalEstimatedCostUsd = 0;

  const byOperation: Record<
    string,
    {
      label: string;
      apiCalls: number;
      cacheHits: number;
      totalTokens: number;
      estimatedCostUsd: number;
    }
  > = {};

  const byModel: Record<
    string,
    {
      calls: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
    }
  > = {};

  for (const rec of ledger) {
    if (!byOperation[rec.operation]) {
      byOperation[rec.operation] = {
        label: rec.label,
        apiCalls: 0,
        cacheHits: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      };
    }

    if (rec.cacheHit || rec.usageSource === 'cache') {
      cacheHits += 1;
      byOperation[rec.operation].cacheHits += 1;
      continue;
    }

    apiCalls += 1;
    totalEstimatedCostUsd += rec.estimatedCostUsd;
    byOperation[rec.operation].apiCalls += 1;
    byOperation[rec.operation].totalTokens += rec.totalTokens;
    byOperation[rec.operation].estimatedCostUsd += rec.estimatedCostUsd;

    if (rec.usageSource === 'gemini_api') {
      realInputTokens += rec.inputTokens;
      realOutputTokens += rec.outputTokens;
      realThoughtsTokens += rec.thoughtsTokens;
    } else {
      estimatedInputTokens += rec.inputTokens;
      estimatedOutputTokens += rec.outputTokens;
    }

    if (!byModel[rec.model]) {
      byModel[rec.model] = {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      };
    }
    byModel[rec.model].calls += 1;
    byModel[rec.model].inputTokens += rec.inputTokens;
    byModel[rec.model].outputTokens += rec.outputTokens;
    byModel[rec.model].totalTokens += rec.totalTokens;
    byModel[rec.model].estimatedCostUsd += rec.estimatedCostUsd;
  }

  return {
    apiCalls,
    cacheHits,
    realInputTokens,
    realOutputTokens,
    realThoughtsTokens,
    estimatedInputTokens,
    estimatedOutputTokens,
    totalTokens:
      realInputTokens +
      realOutputTokens +
      realThoughtsTokens +
      estimatedInputTokens +
      estimatedOutputTokens,
    totalEstimatedCostUsd,
    byOperation,
    byModel,
  };
}
