import express from 'express';
import type { Request, Response } from 'express';
import { GoogleGenAI, ThinkingLevel, type GenerateContentResponse } from '@google/genai';
import type {
  CompactBookDigest,
  CompactChapterDigest,
  ModelTier,
  OriginType,
  QuestionDimension,
  SourceProvenance,
  Stage3EvaluationSet,
  Stage3OpenGrade,
  Stage3Question,
  Stage3QuestionType,
  TokenUsageRecord,
} from '../src/types/stage3.ts';

const router = express.Router();

/**
 * Reference USD rates per 1M tokens for transparent cost estimation.
 * Token counts themselves come directly from Gemini API `usageMetadata`
 * (marked `usageSource: 'gemini_api'`); USD figures are always clearly labeled as estimates.
 */
const MODEL_PRICING_PER_1M_USD: Record<string, { input: number; output: number; tier: ModelTier }> = {
  'gemini-3.1-flash-lite': { input: 0.075, output: 0.30, tier: 'economic' },
  'gemini-4-hydrogen': { input: 0.15, output: 0.60, tier: 'capable' },
  'gemini-flash-latest': { input: 0.15, output: 0.60, tier: 'capable' },
};

const TIER_MODEL_CANDIDATES: Record<ModelTier, string[]> = {
  economic: ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'],
  capable: ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'],
};

function getAiClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function estimateCostUsd(model: string, inputTokens: number, outputAndThoughtTokens: number): number {
  const pricing = MODEL_PRICING_PER_1M_USD[model] || { input: 0.15, output: 0.60 };
  const cost =
    (inputTokens / 1_000_000) * pricing.input +
    (outputAndThoughtTokens / 1_000_000) * pricing.output;
  return Number(cost.toFixed(6));
}

function parseJsonSafe<T>(rawText: string | undefined, fallback: T): { data: T; ok: boolean } {
  if (!rawText) return { data: fallback, ok: false };
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return { data: JSON.parse(cleaned) as T, ok: true };
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return { data: JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T, ok: true };
      } catch {
        // ignore
      }
    }
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        return { data: JSON.parse(cleaned.slice(firstBracket, lastBracket + 1)) as T, ok: true };
      } catch {
        // ignore
      }
    }
    return { data: fallback, ok: false };
  }
}

function formatError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('PERMISSION_DENIED') || raw.includes('403') || raw.includes('API_KEY_INVALID')) {
    return {
      status: 403,
      message:
        'Error de permisos o clave de API inválida. Verifica la clave en Settings > Secrets de AI Studio.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return {
      status: 429,
      message: 'Límite de cuota alcanzado temporalmente (429). Intenta nuevamente en unos segundos.',
    };
  }
  return {
    status: 500,
    message: `Error al generar el recurso con Gemini: ${raw}`,
  };
}

interface CallResult {
  response: GenerateContentResponse;
  usage: TokenUsageRecord;
}

async function callGeminiTiered(opts: {
  tier: ModelTier;
  operation: TokenUsageRecord['operation'];
  label: string;
  systemInstruction: string;
  prompt: string;
}): Promise<CallResult> {
  const ai = getAiClient();
  const candidates = TIER_MODEL_CANDIDATES[opts.tier];
  const startedAt = Date.now();
  let lastError: unknown;

  for (const model of candidates) {
    try {
      const config: Record<string, unknown> = {
        systemInstruction: opts.systemInstruction,
        responseMimeType: 'application/json',
      };
      if (model === 'gemini-4-hydrogen') {
        config.thinkingConfig = {
          thinkingLevel: opts.tier === 'capable' ? ThinkingLevel.LOW : ThinkingLevel.LOW,
        };
      }

      const response = await ai.models.generateContent({
        model,
        contents: opts.prompt,
        config,
      });

      const latencyMs = Date.now() - startedAt;
      const meta = response.usageMetadata as
        | {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
            thoughtsTokenCount?: number;
            totalTokenCount?: number;
          }
        | undefined;

      const hasRealMeta =
        typeof meta?.promptTokenCount === 'number' && typeof meta?.candidatesTokenCount === 'number';

      const inputTokens = hasRealMeta
        ? meta!.promptTokenCount!
        : Math.ceil((opts.systemInstruction.length + opts.prompt.length) / 4);
      const outputTokens = hasRealMeta
        ? meta!.candidatesTokenCount!
        : Math.ceil((response.text || '').length / 4);
      const thoughtsTokens = hasRealMeta && typeof meta?.thoughtsTokenCount === 'number'
        ? meta.thoughtsTokenCount
        : 0;
      const totalTokens =
        hasRealMeta && typeof meta?.totalTokenCount === 'number'
          ? meta.totalTokenCount
          : inputTokens + outputTokens + thoughtsTokens;

      const usage: TokenUsageRecord = {
        id: `tok-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        operation: opts.operation,
        label: opts.label,
        model,
        modelTier: MODEL_PRICING_PER_1M_USD[model]?.tier || opts.tier,
        inputTokens,
        outputTokens,
        thoughtsTokens,
        totalTokens,
        usageSource: hasRealMeta ? 'gemini_api' : 'estimated',
        latencyMs,
        estimatedCostUsd: estimateCostUsd(model, inputTokens, outputTokens + thoughtsTokens),
        cacheHit: false,
        timestamp: new Date().toISOString(),
      };

      return { response, usage };
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable =
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('429') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('404') ||
        msg.includes('NOT_FOUND') ||
        msg.includes('not found') ||
        msg.includes('500') ||
        msg.includes('INTERNAL');
      if (!retryable) throw err;
    }
  }
  throw lastError;
}

function normalizeOriginType(raw: unknown): OriginType {
  if (raw === 'book_extracted' || raw === 'ai_interpretation' || raw === 'external_example') {
    return raw;
  }
  return 'book_extracted';
}

function normalizeProvenance(
  raw: unknown,
  fallbackChapterNumber?: string,
  fallbackChapterTitle?: string,
  fallbackPageRange?: string
): SourceProvenance {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const chapterNumber =
    typeof obj.chapterNumber === 'string' && obj.chapterNumber.trim()
      ? obj.chapterNumber.trim()
      : fallbackChapterNumber;
  const chapterTitle =
    typeof obj.chapterTitle === 'string' && obj.chapterTitle.trim()
      ? obj.chapterTitle.trim()
      : fallbackChapterTitle;
  const pageRange =
    typeof obj.pageRange === 'string' && obj.pageRange.trim()
      ? obj.pageRange.trim()
      : fallbackPageRange;
  const evidenceQuote =
    typeof obj.evidenceQuote === 'string' && obj.evidenceQuote.trim()
      ? obj.evidenceQuote.trim().slice(0, 220)
      : undefined;

  return {
    originType: normalizeOriginType(obj.originType),
    chapterNumber,
    chapterTitle,
    pageRange,
    evidenceQuote,
  };
}

function formatChapterPageRange(ch?: CompactChapterDigest): string | undefined {
  if (!ch) return undefined;
  if (typeof ch.startPage === 'number' && typeof ch.endPage === 'number') {
    return ch.startPage === ch.endPage
      ? `pág. ${ch.startPage}`
      : `págs. ${ch.startPage}–${ch.endPage}`;
  }
  return undefined;
}

function serializeChapterContext(ch: CompactChapterDigest): string {
  const pages = formatChapterPageRange(ch);
  const concepts = (ch.conceptosClave || [])
    .map((c) => `- ${c.termino}: ${c.definicion}`)
    .join('\n');
  const tips = (ch.consejos || []).map((t) => `- ${t}`).join('\n');
  return [
    `CAPÍTULO ${ch.n}: ${ch.titulo}${pages ? ` (${pages})` : ''}`,
    `Idea rectora: ${ch.idea}`,
    ch.resumenAnalisis ? `Análisis: ${ch.resumenAnalisis}` : '',
    ch.historiaBreve ? `Casos/Ejemplos: ${ch.historiaBreve}` : '',
    concepts ? `Conceptos clave:\n${concepts}` : '',
    tips ? `Reglas prácticas:\n${tips}` : '',
    ch.citaCapitulo ? `Cita: "${ch.citaCapitulo}"` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function serializeBookContext(book: CompactBookDigest): string {
  const metricsText = (book.keyMetrics || [])
    .map((m) => `- ${m.label}: ${m.value} (${m.context})`)
    .join('\n');
  const keyPointsText = (book.keyPoints || [])
    .map((kp) => `- [${kp.category}] ${kp.heading}: ${kp.detail}`)
    .join('\n');
  const chaptersText = (book.chapters || []).map((ch) => serializeChapterContext(ch)).join('\n\n---\n\n');

  return [
    `OBRA: ${book.title}${book.authorOrSource ? ` — ${book.authorOrSource}` : ''}`,
    `Resumen ejecutivo: ${book.executiveSummary}`,
    book.objectives.length > 0 ? `Objetivos: ${book.objectives.join(' | ')}` : '',
    keyPointsText ? `Ideas clave:\n${keyPointsText}` : '',
    metricsText ? `Cifras y principios clave:\n${metricsText}` : '',
    book.conclusions.length > 0 ? `Conclusiones: ${book.conclusions.join(' | ')}` : '',
    `\nCAPÍTULOS PROCESADOS (${book.chapters.length}):\n${chaptersText}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

const PROVENANCE_RULES = `REGLAS ESTRICTAS DE TRAZABILIDAD Y HONESTIDAD EPISTÉMICA:
1. Cada nodo, relación, ítem o pregunta DEBE incluir el objeto "provenance":
   {
     "originType": "book_extracted" | "ai_interpretation" | "external_example",
     "chapterNumber": "número de capítulo si aplica",
     "chapterTitle": "título del capítulo si aplica",
     "pageRange": "rango de páginas exacto tomado del contexto (ej. 'págs. 12–24') si existe",
     "evidenceQuote": "breve fragmento o dato de respaldo del contexto"
   }
2. Usa "book_extracted" cuando el dato, concepto o cifra aparece explícitamente en el análisis del libro.
3. Usa "ai_interpretation" cuando sea una relación transversal, síntesis o clasificación inferida por ti al conectar capítulos.
4. Usa "external_example" únicamente si incluyes una aplicación o ejemplo externo ilustrativo.
5. Nunca inventes números de página ni cifras cuantitativas que no aparezcan en el material suministrado.
6. Responde exclusivamente en JSON válido y en español claro y profesional.`;

/* ============================================================================
   GET /api/stage3/models — Transparent Model Tiering & Pricing Reference
   ============================================================================ */
router.get('/models', (_req: Request, res: Response) => {
  res.json({
    tiers: {
      economic: {
        models: TIER_MODEL_CANDIDATES.economic,
        useCases: [
          'Evaluaciones por capítulo',
          'Calificación de respuestas abiertas',
        ],
      },
      capable: {
        models: TIER_MODEL_CANDIDATES.capable,
        useCases: [
          'Evaluación integral multi-capítulo',
        ],
      },
    },
    pricingReferencePer1MUsd: MODEL_PRICING_PER_1M_USD,
  });
});

/* ============================================================================
   POST /api/stage3/evaluation — Chapter & Integral All-Chapter Evaluations
   ============================================================================ */
router.post('/evaluation', async (req: Request, res: Response) => {
  try {
    const {
      scope,
      difficulty = 'Intermedio',
      questionCount,
      bookDigest,
      chapterDigest,
    } = req.body as {
      scope?: 'chapter' | 'integral';
      difficulty?: 'Básico' | 'Intermedio' | 'Avanzado';
      questionCount?: number;
      bookDigest?: CompactBookDigest;
      chapterDigest?: CompactChapterDigest;
    };

    const resolvedScope: 'chapter' | 'integral' =
      scope === 'chapter' && chapterDigest ? 'chapter' : 'integral';

    if (resolvedScope === 'integral' && !bookDigest) {
      res.status(400).json({ error: 'Se requiere el resumen compacto del libro para la evaluación integral.' });
      return;
    }
    if (resolvedScope === 'chapter' && !chapterDigest) {
      res.status(400).json({ error: 'Se requiere el análisis del capítulo.' });
      return;
    }

    const totalChapters = resolvedScope === 'integral' ? bookDigest!.chapters.length : 1;
    const defaultCount =
      resolvedScope === 'chapter'
        ? 6
        : Math.min(12, Math.max(8, totalChapters + 2));
    const safeCount = Math.min(14, Math.max(5, Number(questionCount) || defaultCount));

    const tier: ModelTier = resolvedScope === 'chapter' ? 'economic' : 'capable';
    const contextText =
      resolvedScope === 'chapter'
        ? serializeChapterContext(chapterDigest!)
        : serializeBookContext(bookDigest!);

    const allChapterNumbers =
      resolvedScope === 'integral'
        ? bookDigest!.chapters.map((c) => c.n)
        : [chapterDigest!.n];

    const prompt = `Genera una evaluación pedagógica de alta calidad en JSON para ${
      resolvedScope === 'chapter'
        ? `el Capítulo ${chapterDigest!.n}: "${chapterDigest!.titulo}"`
        : `el LIBRO COMPLETO "${bookDigest!.title}" cubriendo TODOS sus ${totalChapters} capítulos (${allChapterNumbers.join(', ')})`
    }.
Nivel de dificultad: ${difficulty}.
Cantidad exacta de preguntas: ${safeCount}.

REQUISITOS OBLIGATORIOS DE FORMATO Y COBERTURA:
1. Combina OBLIGATORIAMENTE los 3 tipos de preguntas:
   - "multiple_choice": 4 opciones plausibles (options: string[4], correctIndex: 0..3).
   - "true_false": afirmación verificable según el libro (correctBoolean: true | false).
   - "open": pregunta abierta de análisis o aplicación (rubricKeyPoints: string[] con 2-4 criterios clave).
   Distribución sugerida: ~50% multiple_choice, ~25% true_false, ~25% open (al menos 1 de cada tipo).
2. Cubre las 5 dimensiones cognitivas ("dimension"):
   - "fundamental_concept" (conceptos fundamentales)
   - "author_argument" (argumentos del autor)
   - "example" (ejemplos y casos del libro)
   - "practical_application" (aplicaciones prácticas)
   - "concept_relation" (relaciones entre conceptos)
3. ${
      resolvedScope === 'integral'
        ? `EVALUACIÓN INTEGRAL MULTI-CAPÍTULO: Distribuye las preguntas a lo largo de TODOS los capítulos del libro (${allChapterNumbers.join(', ')}), asegurando presencia de capítulos iniciales, intermedios y FINALES (nunca concentres las preguntas solo en los primeros capítulos). Incluye al menos 2 preguntas con "isCrossChapter": true que relacionen explícitamente conceptos de 2 o más capítulos distintos (indicando todos en "chapterNumbers").`
        : `Todas las preguntas deben evaluar a fondo el Capítulo ${chapterDigest!.n} indicando "chapterNumbers": ["${chapterDigest!.n}"].`
    }

ESTRUCTURA JSON REQUERIDA:
{
  "title": "Título de la evaluación",
  "questions": [
    {
      "id": "q1",
      "type": "multiple_choice" | "true_false" | "open",
      "dimension": "fundamental_concept" | "author_argument" | "example" | "practical_application" | "concept_relation",
      "question": "Enunciado claro y preciso",
      "options": ["Opción A", "Opción B", "Opción C", "Opción D"],
      "correctIndex": 0,
      "correctBoolean": true,
      "explanation": "Retroalimentación pedagógica fundamentada en el libro",
      "referenceQuote": "Referencia o pasaje de respaldo",
      "rubricKeyPoints": ["Punto clave 1", "Punto clave 2"],
      "conceptsTested": ["Concepto 1", "Concepto 2"],
      "chapterNumbers": ["1"],
      "isCrossChapter": false,
      "provenance": {
        "originType": "book_extracted" | "ai_interpretation" | "external_example",
        "chapterNumber": "1",
        "chapterTitle": "Título del capítulo",
        "pageRange": "págs. X–Y",
        "evidenceQuote": "Breve evidencia"
      }
    }
  ]
}

MATERIAL ANALIZADO DEL LIBRO (reutilizado sin reenviar PDF):
${contextText}`;

    const { response, usage } = await callGeminiTiered({
      tier,
      operation: resolvedScope === 'chapter' ? 'eval_chapter' : 'eval_integral',
      label:
        resolvedScope === 'chapter'
          ? `Evaluación Cap. ${chapterDigest!.n} (${difficulty})`
          : `Evaluación integral (${difficulty})`,
      systemInstruction: `Eres un diseñador experto de evaluaciones académicas de comprensión lectora para LecturaViva.\n${PROVENANCE_RULES}`,
      prompt,
    });

    const parsed = parseJsonSafe<Record<string, unknown>>(response.text, {});
    const fallbackChNum = resolvedScope === 'chapter' ? chapterDigest!.n : undefined;
    const fallbackChTitle = resolvedScope === 'chapter' ? chapterDigest!.titulo : undefined;
    const fallbackPages = resolvedScope === 'chapter' ? formatChapterPageRange(chapterDigest) : undefined;

    const validTypes: Stage3QuestionType[] = ['multiple_choice', 'true_false', 'open'];
    const validDimensions: QuestionDimension[] = [
      'fundamental_concept',
      'author_argument',
      'example',
      'practical_application',
      'concept_relation',
    ];

    const rawQuestions = Array.isArray(parsed.data.questions) ? parsed.data.questions : [];
    const questions: Stage3Question[] = rawQuestions
      .map((item, idx) => {
        const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        const qType: Stage3QuestionType = validTypes.includes(obj.type as Stage3QuestionType)
          ? (obj.type as Stage3QuestionType)
          : 'multiple_choice';
        const dimension: QuestionDimension = validDimensions.includes(obj.dimension as QuestionDimension)
          ? (obj.dimension as QuestionDimension)
          : 'fundamental_concept';

        const chapterNumsRaw = Array.isArray(obj.chapterNumbers)
          ? obj.chapterNumbers.map((c) => String(c).trim()).filter(Boolean)
          : [];
        const provenance = normalizeProvenance(
          obj.provenance,
          chapterNumsRaw[0] || fallbackChNum,
          fallbackChTitle,
          fallbackPages
        );
        const chapterNumbers =
          chapterNumsRaw.length > 0
            ? chapterNumsRaw
            : provenance.chapterNumber
            ? [provenance.chapterNumber]
            : fallbackChNum
            ? [fallbackChNum]
            : ['1'];

        const conceptsTested = Array.isArray(obj.conceptsTested)
          ? obj.conceptsTested.map((c) => String(c).trim()).filter(Boolean)
          : [];

        const options =
          qType === 'multiple_choice' && Array.isArray(obj.options)
            ? obj.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 4)
            : undefined;

        return {
          id: typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : `s3q-${idx + 1}`,
          type: qType,
          dimension,
          question: typeof obj.question === 'string' ? obj.question.trim() : '',
          options,
          correctIndex:
            qType === 'multiple_choice' && typeof obj.correctIndex === 'number'
              ? Math.max(0, Math.min((options?.length || 1) - 1, Math.floor(obj.correctIndex)))
              : qType === 'multiple_choice'
              ? 0
              : undefined,
          correctBoolean:
            qType === 'true_false'
              ? typeof obj.correctBoolean === 'boolean'
                ? obj.correctBoolean
                : true
              : undefined,
          explanation: typeof obj.explanation === 'string' ? obj.explanation.trim() : '',
          referenceQuote:
            typeof obj.referenceQuote === 'string' && obj.referenceQuote.trim()
              ? obj.referenceQuote.trim()
              : provenance.evidenceQuote,
          rubricKeyPoints: Array.isArray(obj.rubricKeyPoints)
            ? obj.rubricKeyPoints.map((r) => String(r).trim()).filter(Boolean)
            : [],
          conceptsTested: conceptsTested.length > 0 ? conceptsTested : [dimension],
          chapterNumbers,
          isCrossChapter: Boolean(obj.isCrossChapter) || chapterNumbers.length > 1,
          provenance,
        };
      })
      .filter((q) => q.question);

    const chaptersCovered = Array.from(
      new Set(questions.flatMap((q) => q.chapterNumbers))
    ).sort((a, b) => Number(a) - Number(b));

    const evaluationSet: Stage3EvaluationSet = {
      id: `eval-${resolvedScope}-${fallbackChNum || 'all'}-${difficulty}-${Date.now()}`,
      scope: resolvedScope,
      chapterNumber: fallbackChNum,
      chapterTitle: fallbackChTitle,
      chaptersCovered,
      difficulty,
      title:
        typeof parsed.data.title === 'string' && parsed.data.title.trim()
          ? parsed.data.title.trim()
          : resolvedScope === 'chapter'
          ? `Evaluación · Capítulo ${chapterDigest!.n}`
          : `Evaluación Integral · ${bookDigest!.title}`,
      questions,
      generatedAt: new Date().toISOString(),
    };

    res.json({ evaluation: evaluationSet, usage });
  } catch (err) {
    const { status, message } = formatError(err);
    res.status(status).json({ error: message });
  }
});

/* ============================================================================
   POST /api/stage3/evaluate-open — Economic Open-Answer Grading (No PDF Re-Send)
   ============================================================================ */
router.post('/evaluate-open', async (req: Request, res: Response) => {
  try {
    const { question, userAnswer, rubricKeyPoints, conceptsTested, referenceExplanation, chapterContext } =
      req.body as {
        question?: string;
        userAnswer?: string;
        rubricKeyPoints?: string[];
        conceptsTested?: string[];
        referenceExplanation?: string;
        chapterContext?: string;
      };

    if (!question || !userAnswer || !userAnswer.trim()) {
      res.status(400).json({ error: 'Se requiere la pregunta y la respuesta del lector.' });
      return;
    }

    const prompt = `Evalúa la respuesta abierta del lector usando únicamente la rúbrica y el resumen de referencia (sin requerir el libro completo).

PREGUNTA: ${question}
RESPUESTA DEL LECTOR: ${userAnswer.trim().slice(0, 1800)}
CONCEPTOS EVALUADOS: ${(conceptsTested || []).join(', ')}
PUNTOS ESPERADOS (RÚBRICA): ${(rubricKeyPoints || []).join(' | ')}
EXPLICACIÓN MODELO DEL LIBRO: ${(referenceExplanation || '').slice(0, 900)}
${chapterContext ? `CONTEXTO DEL CAPÍTULO:\n${chapterContext.slice(0, 1200)}` : ''}

Devuelve exclusivamente este JSON:
{
  "isCorrect": true | false,
  "score": 0..100,
  "feedback": "Retroalimentación constructiva y específica (2-4 líneas)",
  "missingConcepts": ["Idea que faltó mencionar"],
  "masteredConcepts": ["Concepto que el lector demostró dominar"],
  "weakConcepts": ["Concepto que necesita refuerzo"]
}`;

    const { response, usage } = await callGeminiTiered({
      tier: 'economic',
      operation: 'eval_open_grade',
      label: 'Calificación de respuesta abierta',
      systemInstruction:
        'Eres un evaluador pedagógico justo, preciso y constructivo en español. Considera isCorrect=true cuando score >= 70. Responde solo en JSON válido.',
      prompt,
    });

    const parsed = parseJsonSafe<Record<string, unknown>>(response.text, {});
    const score =
      typeof parsed.data.score === 'number'
        ? Math.max(0, Math.min(100, Math.round(parsed.data.score)))
        : 0;
    const isCorrect = typeof parsed.data.isCorrect === 'boolean' ? parsed.data.isCorrect : score >= 70;

    const grade: Stage3OpenGrade = {
      isCorrect,
      score,
      feedback:
        typeof parsed.data.feedback === 'string' && parsed.data.feedback.trim()
          ? parsed.data.feedback.trim()
          : 'Respuesta evaluada con base en los criterios del libro.',
      missingConcepts: Array.isArray(parsed.data.missingConcepts)
        ? parsed.data.missingConcepts.map((s) => String(s)).filter(Boolean)
        : [],
      masteredConcepts: Array.isArray(parsed.data.masteredConcepts)
        ? parsed.data.masteredConcepts.map((s) => String(s)).filter(Boolean)
        : isCorrect
        ? conceptsTested || []
        : [],
      weakConcepts: Array.isArray(parsed.data.weakConcepts)
        ? parsed.data.weakConcepts.map((s) => String(s)).filter(Boolean)
        : !isCorrect
        ? conceptsTested || []
        : [],
    };

    res.json({ grade, usage });
  } catch (err) {
    const { status, message } = formatError(err);
    res.status(status).json({ error: message });
  }
});

export default router;
