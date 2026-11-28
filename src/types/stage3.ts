/**
 * Shared TypeScript types for LecturaViva Etapa 3:
 * - Chapter & Integral Evaluations (Multiple Choice, True/False, Open)
 * - Learning Progress Tracking (strictly separated from PDF processing coverage)
 * - Traceability & Epistemic Provenance (Book Extracted vs AI Interpretation vs External Example)
 * - Token Usage, Model Tiering & Caching Telemetry
 */

export type OriginType = 'book_extracted' | 'ai_interpretation' | 'external_example';

export interface SourceProvenance {
  originType: OriginType;
  chapterNumber?: string;
  chapterTitle?: string;
  pageRange?: string;
  evidenceQuote?: string;
}

export const ORIGIN_TYPE_META: Record<
  OriginType,
  { label: string; shortLabel: string; description: string }
> = {
  book_extracted: {
    label: 'Extraído del libro',
    shortLabel: 'Libro',
    description: 'Concepto, cifra o afirmación fundamentada directamente en el texto analizado.',
  },
  ai_interpretation: {
    label: 'Interpretación IA',
    shortLabel: 'Síntesis IA',
    description: 'Conexión estructural, relación conceptual o síntesis inferida por IA a partir del libro.',
  },
  external_example: {
    label: 'Ejemplo externo',
    shortLabel: 'Externo',
    description: 'Ejemplo ilustrativo o analogía complementaria fuera del texto original.',
  },
};

/* ============================================================================
   1. EVALUATIONS (Chapter & Integral, MC + True/False + Open)
   ============================================================================ */

export type Stage3QuestionType = 'multiple_choice' | 'true_false' | 'open';

export type QuestionDimension =
  | 'fundamental_concept'
  | 'author_argument'
  | 'example'
  | 'practical_application'
  | 'concept_relation';

export const QUESTION_DIMENSION_LABELS: Record<QuestionDimension, string> = {
  fundamental_concept: 'Concepto fundamental',
  author_argument: 'Argumento del autor',
  example: 'Ejemplo del libro',
  practical_application: 'Aplicación práctica',
  concept_relation: 'Relación entre conceptos',
};

export interface Stage3Question {
  id: string;
  type: Stage3QuestionType;
  dimension: QuestionDimension;
  question: string;
  options?: string[];
  correctIndex?: number;
  correctBoolean?: boolean;
  explanation: string;
  referenceQuote?: string;
  rubricKeyPoints: string[];
  conceptsTested: string[];
  chapterNumbers: string[];
  isCrossChapter: boolean;
  provenance: SourceProvenance;
}

export interface Stage3EvaluationSet {
  id: string;
  scope: 'chapter' | 'integral';
  chapterNumber?: string;
  chapterTitle?: string;
  chaptersCovered: string[];
  difficulty: 'Básico' | 'Intermedio' | 'Avanzado';
  title: string;
  questions: Stage3Question[];
  generatedAt: string;
}

export interface Stage3OpenGrade {
  isCorrect: boolean;
  score: number;
  feedback: string;
  missingConcepts: string[];
  masteredConcepts: string[];
  weakConcepts: string[];
}

/* ============================================================================
   5. LEARNING PROGRESS TRACKING
   ============================================================================ */

export interface ConceptAssessmentOutcome {
  concept: string;
  chapterNumber: string;
  isCorrect: boolean;
}

export interface EvaluationAttemptRecord {
  id: string;
  evaluationId: string;
  scope: 'chapter' | 'integral';
  chapterNumber?: string;
  chapterTitle?: string;
  chaptersCovered: string[];
  difficulty: 'Básico' | 'Intermedio' | 'Avanzado';
  totalQuestions: number;
  answeredQuestions: number;
  correctCount: number;
  incorrectCount: number;
  comprehensionPercent: number;
  conceptOutcomes: ConceptAssessmentOutcome[];
  completedAt: string;
}

export interface ChapterMasteryStat {
  chapterNumber: string;
  chapterTitle: string;
  attempts: number;
  correct: number;
  incorrect: number;
  comprehensionPercent: number;
}

export interface ConceptMasteryStat {
  concept: string;
  chapterNumbers: string[];
  correct: number;
  total: number;
  accuracyPercent: number;
  status: 'mastered' | 'reinforce';
}

/* ============================================================================
   6. TOKEN OPTIMIZATION, MODEL TIERING & TELEMETRY
   ============================================================================ */

export type ModelTier = 'economic' | 'capable';

export interface TokenUsageRecord {
  id: string;
  operation:
    | 'eval_chapter'
    | 'eval_integral'
    | 'eval_open_grade';
  label: string;
  model: string;
  modelTier: ModelTier;
  inputTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
  usageSource: 'gemini_api' | 'estimated' | 'cache';
  latencyMs: number;
  estimatedCostUsd: number;
  cacheHit: boolean;
  timestamp: string;
}

/* ============================================================================
   7. COMPACT CHAPTER DIGEST (Token-Efficient Payload sent to Backend)
   ============================================================================ */

export interface CompactChapterDigest {
  n: string;
  titulo: string;
  startPage?: number;
  endPage?: number;
  idea: string;
  resumenAnalisis: string;
  historiaBreve: string;
  conceptosClave: Array<{ termino: string; definicion: string }>;
  consejos: string[];
  citaCapitulo?: string;
}

export interface CompactBookDigest {
  title: string;
  authorOrSource?: string;
  executiveSummary: string;
  objectives: string[];
  keyPoints: Array<{ heading: string; detail: string; category: string }>;
  keyMetrics: Array<{ label: string; value: string; context: string }>;
  conclusions: string[];
  chapters: CompactChapterDigest[];
}
