import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  RotateCcw,
  BookOpen,
  Layers,
  TrendingUp,
  Award,
  Save,
  MessageSquare,
  Sparkles,
  Check,
} from 'lucide-react';
import { CoverageReport, DocumentAnalysis } from '../data/enamoratePreset';
import {
  ConceptAssessmentOutcome,
  EvaluationAttemptRecord,
  QUESTION_DIMENSION_LABELS,
  Stage3EvaluationSet,
  Stage3OpenGrade,
  Stage3Question,
  TokenUsageRecord,
} from '../types/stage3';
import {
  Stage3BookCache,
  Stage3EvaluationDraft,
  buildCompactBookDigest,
  buildCompactChapterDigest,
  computeLearningAnalytics,
} from '../utils/stage3Storage';
import { apiUrl, readApiJson } from '../utils/api';
import { ProvenanceBadge, ProvenanceLegend } from './ProvenanceBadge';

type EvalSubTab = 'chapter' | 'integral' | 'tracking';

interface Stage3EvaluationStudioProps {
  analysis: DocumentAnalysis;
  coverageReport: CoverageReport | null;
  cache: Stage3BookCache;
  onUpdateCache: (updater: (prev: Stage3BookCache) => Stage3BookCache) => void;
  onJumpToChapter: (chapterNumber: string) => void;
  onAskInChat: (question: string) => void;
}

const EMPTY_DRAFT: Stage3EvaluationDraft = {
  selectedOptions: {},
  selectedBooleans: {},
  openDrafts: {},
  openGrades: {},
};

export function Stage3EvaluationStudio({
  analysis,
  coverageReport,
  cache,
  onUpdateCache,
  onJumpToChapter,
  onAskInChat,
}: Stage3EvaluationStudioProps) {
  const chapters = analysis.chapters || [];
  const [subTab, setSubTab] = useState<EvalSubTab>('chapter');
  const [selectedChapterIdx, setSelectedChapterIdx] = useState<number>(0);
  const [difficulty, setDifficulty] = useState<'Básico' | 'Intermedio' | 'Avanzado'>('Intermedio');

  const [isGenerating, setIsGenerating] = useState(false);
  const [gradingQuestionId, setGradingQuestionId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [savedNoticeId, setSavedNoticeId] = useState<string | null>(null);

  const safeChapterIdx = Math.min(Math.max(0, selectedChapterIdx), Math.max(0, chapters.length - 1));
  const activeChapter = chapters[safeChapterIdx];

  const evalKey =
    subTab === 'chapter' && activeChapter
      ? `chapter-${activeChapter.n}-${difficulty}`
      : `integral-${difficulty}`;

  const currentEvaluation: Stage3EvaluationSet | undefined = cache.evaluations[evalKey];
  const currentDraft: Stage3EvaluationDraft =
    (currentEvaluation && cache.evaluationDrafts[currentEvaluation.id]) || EMPTY_DRAFT;

  const learningStats = useMemo(
    () => computeLearningAnalytics(cache.attempts, chapters),
    [cache.attempts, chapters]
  );

  const updateDraft = (
    evalId: string,
    updater: (prev: Stage3EvaluationDraft) => Stage3EvaluationDraft
  ) => {
    onUpdateCache((prev) => ({
      ...prev,
      evaluationDrafts: {
        ...prev.evaluationDrafts,
        [evalId]: updater(prev.evaluationDrafts[evalId] || EMPTY_DRAFT),
      },
    }));
  };

  /* -------------------------------------------------------------------------
     ON-DEMAND GENERATION (Chapter or All-Chapter Integral)
     ------------------------------------------------------------------------- */
  const handleGenerateEvaluation = async (
    targetScope: 'chapter' | 'integral',
    forceRegenerate = false
  ) => {
    const key =
      targetScope === 'chapter' && activeChapter
        ? `chapter-${activeChapter.n}-${difficulty}`
        : `integral-${difficulty}`;

    if (!forceRegenerate && cache.evaluations[key]) {
      const rec: TokenUsageRecord = {
        id: `cache-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        operation: targetScope === 'chapter' ? 'eval_chapter' : 'eval_integral',
        label: `Evaluación ${targetScope === 'chapter' ? `Cap. ${activeChapter?.n}` : 'Integral'} (caché)`,
        model: 'cache-local',
        modelTier: targetScope === 'chapter' ? 'economic' : 'capable',
        inputTokens: 0,
        outputTokens: 0,
        thoughtsTokens: 0,
        totalTokens: 0,
        usageSource: 'cache',
        latencyMs: 1,
        estimatedCostUsd: 0,
        cacheHit: true,
        timestamp: new Date().toISOString(),
      };
      onUpdateCache((prev) => ({
        ...prev,
        tokenLedger: [...prev.tokenLedger.slice(-149), rec],
      }));
      return;
    }

    setErrorMsg('');
    setSavedNoticeId(null);
    setIsGenerating(true);

    try {
      const payload =
        targetScope === 'chapter' && activeChapter
          ? {
              scope: 'chapter',
              difficulty,
              questionCount: 6,
              chapterDigest: buildCompactChapterDigest(activeChapter),
            }
          : {
              scope: 'integral',
              difficulty,
              questionCount: Math.min(12, Math.max(8, chapters.length + 2)),
              bookDigest: buildCompactBookDigest(analysis),
            };

      const res = await fetch(apiUrl('/api/stage3/evaluation'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await readApiJson<{ evaluation: Stage3EvaluationSet; usage: TokenUsageRecord }>(
        res
      );

      onUpdateCache((prev) => ({
        ...prev,
        evaluations: { ...prev.evaluations, [key]: data.evaluation },
        evaluationDrafts: { ...prev.evaluationDrafts, [data.evaluation.id]: EMPTY_DRAFT },
        tokenLedger: [...prev.tokenLedger.slice(-149), data.usage],
      }));
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo generar la evaluación.');
    } finally {
      setIsGenerating(false);
    }
  };

  /* -------------------------------------------------------------------------
     GRADE OPEN-ENDED QUESTION (Economic tier, compact context, no full PDF)
     ------------------------------------------------------------------------- */
  const handleGradeOpen = async (evaluation: Stage3EvaluationSet, q: Stage3Question) => {
    const answer = (currentDraft.openDrafts[q.id] || '').trim();
    if (!answer) {
      setErrorMsg('Escribe una respuesta antes de calificar.');
      return;
    }

    setErrorMsg('');
    setGradingQuestionId(q.id);
    try {
      const targetCh = chapters.find((c) => q.chapterNumbers.includes(String(c.n)));
      const chapterContext = targetCh
        ? `Cap. ${targetCh.n} (${targetCh.titulo}): ${targetCh.idea}. ${(targetCh.analisisDetallado || '').slice(0, 700)}`
        : analysis.executiveSummary.slice(0, 700);

      const res = await fetch(apiUrl('/api/stage3/evaluate-open'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q.question,
          userAnswer: answer,
          rubricKeyPoints: q.rubricKeyPoints,
          conceptsTested: q.conceptsTested,
          referenceExplanation: q.explanation,
          chapterContext,
        }),
      });
      const data = await readApiJson<{ grade: Stage3OpenGrade; usage: TokenUsageRecord }>(res);

      onUpdateCache((prev) => {
        const existingDraft = prev.evaluationDrafts[evaluation.id] || EMPTY_DRAFT;
        return {
          ...prev,
          evaluationDrafts: {
            ...prev.evaluationDrafts,
            [evaluation.id]: {
              ...existingDraft,
              openGrades: { ...existingDraft.openGrades, [q.id]: data.grade },
            },
          },
          tokenLedger: [...prev.tokenLedger.slice(-149), data.usage],
        };
      });
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo calificar la respuesta.');
    } finally {
      setGradingQuestionId(null);
    }
  };

  /* -------------------------------------------------------------------------
     LIVE SCORE FOR ACTIVE EVALUATION SET
     ------------------------------------------------------------------------- */
  const activeScoreSummary = useMemo(() => {
    if (!currentEvaluation) {
      return { total: 0, answered: 0, correct: 0, incorrect: 0, percent: 0 };
    }
    let answered = 0;
    let correct = 0;
    for (const q of currentEvaluation.questions) {
      if (q.type === 'multiple_choice') {
        const choice = currentDraft.selectedOptions[q.id];
        if (choice !== undefined) {
          answered += 1;
          if (choice === q.correctIndex) correct += 1;
        }
      } else if (q.type === 'true_false') {
        const choice = currentDraft.selectedBooleans[q.id];
        if (choice !== undefined) {
          answered += 1;
          if (choice === q.correctBoolean) correct += 1;
        }
      } else if (q.type === 'open') {
        const grade = currentDraft.openGrades[q.id];
        if (grade) {
          answered += 1;
          if (grade.isCorrect) correct += 1;
        }
      }
    }
    const incorrect = answered - correct;
    const percent = answered > 0 ? Math.round((correct / answered) * 100) : 0;
    return {
      total: currentEvaluation.questions.length,
      answered,
      correct,
      incorrect,
      percent,
    };
  }, [currentEvaluation, currentDraft]);

  /* -------------------------------------------------------------------------
     SAVE COMPLETED / PARTIAL ATTEMPT INTO LEARNING PROGRESS TRACKER
     ------------------------------------------------------------------------- */
  const handleSaveAttempt = (evaluation: Stage3EvaluationSet) => {
    if (activeScoreSummary.answered === 0) {
      setErrorMsg('Responde al menos una pregunta antes de registrar tu resultado.');
      return;
    }

    const conceptOutcomes: ConceptAssessmentOutcome[] = [];

    for (const q of evaluation.questions) {
      let isAnswered = false;
      let isCorrect = false;
      let masteredList: string[] = [];
      let weakList: string[] = [];

      if (q.type === 'multiple_choice') {
        const choice = currentDraft.selectedOptions[q.id];
        if (choice !== undefined) {
          isAnswered = true;
          isCorrect = choice === q.correctIndex;
        }
      } else if (q.type === 'true_false') {
        const choice = currentDraft.selectedBooleans[q.id];
        if (choice !== undefined) {
          isAnswered = true;
          isCorrect = choice === q.correctBoolean;
        }
      } else if (q.type === 'open') {
        const grade = currentDraft.openGrades[q.id];
        if (grade) {
          isAnswered = true;
          isCorrect = grade.isCorrect;
          masteredList = grade.masteredConcepts || [];
          weakList = grade.weakConcepts || [];
        }
      }

      if (!isAnswered) continue;

      const chNum = q.chapterNumbers[0] || evaluation.chapterNumber || '1';
      if (q.type === 'open' && (masteredList.length > 0 || weakList.length > 0)) {
        masteredList.forEach((c) => conceptOutcomes.push({ concept: c, chapterNumber: chNum, isCorrect: true }));
        weakList.forEach((c) => conceptOutcomes.push({ concept: c, chapterNumber: chNum, isCorrect: false }));
      } else {
        const tested = q.conceptsTested.length > 0 ? q.conceptsTested : [QUESTION_DIMENSION_LABELS[q.dimension]];
        tested.forEach((c) =>
          conceptOutcomes.push({
            concept: c,
            chapterNumber: chNum,
            isCorrect,
          })
        );
      }
    }

    const attempt: EvaluationAttemptRecord = {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      evaluationId: evaluation.id,
      scope: evaluation.scope,
      chapterNumber: evaluation.chapterNumber,
      chapterTitle: evaluation.chapterTitle,
      chaptersCovered: evaluation.chaptersCovered,
      difficulty: evaluation.difficulty,
      totalQuestions: activeScoreSummary.total,
      answeredQuestions: activeScoreSummary.answered,
      correctCount: activeScoreSummary.correct,
      incorrectCount: activeScoreSummary.incorrect,
      comprehensionPercent: activeScoreSummary.percent,
      conceptOutcomes,
      completedAt: new Date().toISOString(),
    };

    onUpdateCache((prev) => ({
      ...prev,
      attempts: [...prev.attempts, attempt],
    }));
    setSavedNoticeId(attempt.id);
  };

  /* -------------------------------------------------------------------------
     RENDER QUESTIONS (MC + TRUE/FALSE + OPEN)
     ------------------------------------------------------------------------- */
  const renderEvaluationView = (scope: 'chapter' | 'integral') => (
    <div className="space-y-4 sm:space-y-5">
      {/* Controls Card */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <div className="text-xs font-medium text-orange-600 dark:text-orange-400 mb-0.5">
              {scope === 'chapter'
                ? 'Evaluación Focalizada por Capítulo · Modelo Económico'
                : `Evaluación Integral Multi-Capítulo (${chapters.length} capítulos del libro)`}
            </div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
              {currentEvaluation
                ? currentEvaluation.title
                : scope === 'chapter' && activeChapter
                ? `Evaluación · Cap. ${activeChapter.n}: ${activeChapter.titulo}`
                : `Evaluación Integral · ${analysis.title}`}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Combina selección múltiple, verdadero/falso y preguntas abiertas sobre conceptos, argumentos, ejemplos, aplicación y relaciones.
            </p>
          </div>

          {currentEvaluation && (
            <div className="flex items-center justify-between md:justify-end gap-3 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 shrink-0">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Comprensión en este intento
                </div>
                <div className="text-sm sm:text-base font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {activeScoreSummary.correct}/{activeScoreSummary.answered} aciertos (
                  {activeScoreSummary.percent}%)
                </div>
              </div>
              {activeScoreSummary.answered > 0 && (
                <button
                  type="button"
                  onClick={() => updateDraft(currentEvaluation.id, () => EMPTY_DRAFT)}
                  className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  title="Reiniciar respuestas de esta evaluación"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Selectors & Generate CTA */}
        <div className="flex flex-wrap items-center justify-between gap-3 no-print">
          <div className="flex flex-wrap items-center gap-2.5">
            {scope === 'chapter' && chapters.length > 0 && (
              <select
                value={safeChapterIdx}
                onChange={(e) => {
                  setSelectedChapterIdx(Number(e.target.value));
                  setSavedNoticeId(null);
                }}
                aria-label="Seleccionar capítulo a evaluar"
                className="px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 max-w-[260px]"
              >
                {chapters.map((ch, idx) => (
                  <option key={`${ch.n}-${idx}`} value={idx}>
                    Cap. {ch.n}: {ch.titulo}
                  </option>
                ))}
              </select>
            )}

            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs">
              {(['Básico', 'Intermedio', 'Avanzado'] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => {
                    setDifficulty(lvl);
                    setSavedNoticeId(null);
                  }}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                    difficulty === lvl
                      ? 'bg-blue-700 dark:bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:text-blue-700 dark:hover:text-blue-300'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {currentEvaluation && activeScoreSummary.answered > 0 && (
              <button
                type="button"
                onClick={() => handleSaveAttempt(currentEvaluation)}
                className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Guardar en Seguimiento</span>
              </button>
            )}

            <button
              type="button"
              disabled={isGenerating}
              onClick={() => handleGenerateEvaluation(scope, Boolean(currentEvaluation))}
              className="px-3.5 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-orange-300" />
                  <span>Generando evaluación...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-orange-300" />
                  <span>
                    {currentEvaluation
                      ? 'Regenerar Preguntas'
                      : scope === 'chapter'
                      ? 'Generar Evaluación del Capítulo'
                      : 'Generar Evaluación Integral'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Chapters Covered Badge for Integral Evaluations */}
        {currentEvaluation && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Capítulos evaluados:
              </span>
              {currentEvaluation.chaptersCovered.map((chNum) => (
                <span
                  key={chNum}
                  className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800 font-mono font-semibold"
                >
                  Cap. {chNum}
                </span>
              ))}
              {currentEvaluation.questions.some((q) => q.isCrossChapter) && (
                <span className="px-2 py-0.5 rounded-md bg-orange-50 dark:bg-orange-950/50 text-orange-800 dark:text-orange-200 border border-orange-200 dark:border-orange-800 font-semibold">
                  Incluye relaciones entre capítulos
                </span>
              )}
            </div>
            <ProvenanceLegend />
          </div>
        )}

        {savedNoticeId && (
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-medium">
              <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              Resultado registrado en Seguimiento del Aprendizaje.
            </span>
            <button
              type="button"
              onClick={() => setSubTab('tracking')}
              className="font-bold underline cursor-pointer"
            >
              Ver evolución →
            </button>
          </div>
        )}
      </section>

      {/* Empty On-Demand Prompt or Question Cards */}
      {!currentEvaluation ? (
        <div className="p-6 sm:p-8 rounded-2xl bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700 text-center space-y-3">
          <Award className="w-8 h-8 mx-auto text-blue-600 dark:text-blue-400" />
          <div className="max-w-lg mx-auto space-y-1">
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              {scope === 'chapter'
                ? 'Evaluación por capítulo lista bajo demanda'
                : 'Evaluación integral de toda la obra lista bajo demanda'}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {scope === 'chapter'
                ? 'Se construye únicamente con el análisis almacenado del capítulo seleccionado (sin reenviar el PDF) e incluye selección múltiple, verdadero/falso y preguntas abiertas.'
                : `Distribuye preguntas a lo largo de los ${chapters.length} capítulos del libro e incluye preguntas integradoras que conectan conceptos de distintos capítulos.`}
            </p>
          </div>
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => handleGenerateEvaluation(scope, false)}
            className="px-4 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
          >
            {scope === 'chapter' ? 'Crear Evaluación del Capítulo' : 'Crear Evaluación Integral'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {currentEvaluation.questions.map((q, idx) => {
            const typeBadge =
              q.type === 'multiple_choice'
                ? 'Selección Múltiple'
                : q.type === 'true_false'
                ? 'Verdadero / Falso'
                : 'Pregunta Abierta';

            return (
              <article
                key={q.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4"
              >
                {/* Question Metadata Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono tabular-nums font-bold text-orange-600 dark:text-orange-400">
                      {String(idx + 1).padStart(2, '0')}.
                    </span>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      {typeBadge}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{QUESTION_DIMENSION_LABELS[q.dimension]}</span>
                    {q.isCrossChapter && (
                      <span className="px-2 py-0.5 rounded-md bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800 font-semibold text-[11px]">
                        Inter-capítulo ({q.chapterNumbers.map((n) => `Cap. ${n}`).join(' + ')})
                      </span>
                    )}
                  </div>
                  <ProvenanceBadge provenance={q.provenance} compact />
                </div>

                {/* Question Prompt */}
                <h4 className="reading-heading font-bold text-slate-900 dark:text-white">
                  {q.question}
                </h4>

                {/* TYPE 1: MULTIPLE CHOICE */}
                {q.type === 'multiple_choice' && (
                  <div className="space-y-2">
                    {(q.options || []).map((opt, optIdx) => {
                      const chosen = currentDraft.selectedOptions[q.id];
                      const hasAnswered = chosen !== undefined;
                      const isThisSelected = chosen === optIdx;
                      const isThisCorrect = q.correctIndex === optIdx;

                      let cls =
                        'border-slate-200 dark:border-slate-700 hover:border-blue-500 bg-slate-50/70 dark:bg-slate-800/60 text-slate-800 dark:text-slate-200';
                      if (hasAnswered) {
                        if (isThisCorrect) {
                          cls =
                            'border-emerald-600 dark:border-emerald-500 bg-emerald-50 dark:bg-emerald-950/45 text-emerald-950 dark:text-emerald-100 font-medium';
                        } else if (isThisSelected) {
                          cls =
                            'border-rose-500 bg-rose-50 dark:bg-rose-950/45 text-rose-950 dark:text-rose-100';
                        } else {
                          cls =
                            'border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/50 text-slate-400 dark:text-slate-500';
                        }
                      }

                      return (
                        <button
                          key={optIdx}
                          type="button"
                          onClick={() =>
                            updateDraft(currentEvaluation.id, (prev) => ({
                              ...prev,
                              selectedOptions: { ...prev.selectedOptions, [q.id]: optIdx },
                            }))
                          }
                          className={`w-full text-left px-4 py-3 rounded-xl border reading-content transition-colors flex items-start justify-between gap-3 cursor-pointer ${cls}`}
                        >
                          <div className="flex items-start gap-2.5">
                            <span className="font-mono text-xs font-bold mt-1 tabular-nums text-orange-600 dark:text-orange-400">
                              {String.fromCharCode(65 + optIdx)}.
                            </span>
                            <span>{opt}</span>
                          </div>
                          {hasAnswered && isThisCorrect && (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-1" />
                          )}
                          {hasAnswered && isThisSelected && !isThisCorrect && (
                            <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-1" />
                          )}
                        </button>
                      );
                    })}

                    {currentDraft.selectedOptions[q.id] !== undefined && (
                      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2 mt-2">
                        <div className="text-xs font-bold text-slate-900 dark:text-white">
                          Retroalimentación fundamentada:
                        </div>
                        <p className="reading-content-sm text-slate-700 dark:text-slate-300">
                          {q.explanation}
                        </p>
                        <ProvenanceBadge provenance={q.provenance} showQuote />
                      </div>
                    )}
                  </div>
                )}

                {/* TYPE 2: TRUE / FALSE */}
                {q.type === 'true_false' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { val: true, label: 'Verdadero' },
                        { val: false, label: 'Falso' },
                      ].map((choiceObj) => {
                        const chosen = currentDraft.selectedBooleans[q.id];
                        const hasAnswered = chosen !== undefined;
                        const isThisSelected = chosen === choiceObj.val;
                        const isThisCorrect = q.correctBoolean === choiceObj.val;

                        let cls =
                          'border-slate-200 dark:border-slate-700 hover:border-blue-500 bg-slate-50/70 dark:bg-slate-800/60 text-slate-800 dark:text-slate-200';
                        if (hasAnswered) {
                          if (isThisCorrect) {
                            cls =
                              'border-emerald-600 dark:border-emerald-500 bg-emerald-50 dark:bg-emerald-950/45 text-emerald-950 dark:text-emerald-100';
                          } else if (isThisSelected) {
                            cls =
                              'border-rose-500 bg-rose-50 dark:bg-rose-950/45 text-rose-950 dark:text-rose-100';
                          } else {
                            cls =
                              'border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/50 text-slate-400 dark:text-slate-500';
                          }
                        }

                        return (
                          <button
                            key={String(choiceObj.val)}
                            type="button"
                            onClick={() =>
                              updateDraft(currentEvaluation.id, (prev) => ({
                                ...prev,
                                selectedBooleans: {
                                  ...prev.selectedBooleans,
                                  [q.id]: choiceObj.val,
                                },
                              }))
                            }
                            className={`px-4 py-3 rounded-xl border text-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer ${cls}`}
                          >
                            <span>{choiceObj.label}</span>
                            {hasAnswered && isThisCorrect && (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            )}
                            {hasAnswered && isThisSelected && !isThisCorrect && (
                              <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {currentDraft.selectedBooleans[q.id] !== undefined && (
                      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2">
                        <div className="text-xs font-bold text-slate-900 dark:text-white">
                          Respuesta correcta: {q.correctBoolean ? 'Verdadero' : 'Falso'}
                        </div>
                        <p className="reading-content-sm text-slate-700 dark:text-slate-300">
                          {q.explanation}
                        </p>
                        <ProvenanceBadge provenance={q.provenance} showQuote />
                      </div>
                    )}
                  </div>
                )}

                {/* TYPE 3: OPEN-ENDED */}
                {q.type === 'open' && (
                  <div className="space-y-3">
                    <textarea
                      rows={3}
                      value={currentDraft.openDrafts[q.id] || ''}
                      onChange={(e) =>
                        updateDraft(currentEvaluation.id, (prev) => ({
                          ...prev,
                          openDrafts: { ...prev.openDrafts, [q.id]: e.target.value },
                        }))
                      }
                      placeholder="Redacta tu análisis o aplicación práctica basándote en el libro..."
                      className="w-full p-3.5 text-sm rounded-xl bg-slate-50/70 dark:bg-slate-800/70 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-600"
                    />

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        Conceptos clave: {q.conceptsTested.join(' · ')}
                      </span>
                      <button
                        type="button"
                        disabled={gradingQuestionId === q.id}
                        onClick={() => handleGradeOpen(currentEvaluation, q)}
                        className="px-3.5 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        {gradingQuestionId === q.id ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-orange-300" />
                            <span>Calificando...</span>
                          </>
                        ) : (
                          <span>Calificar Respuesta</span>
                        )}
                      </button>
                    </div>

                    {currentDraft.openGrades[q.id] && (
                      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2">
                        <div className="flex items-center justify-between text-xs font-bold">
                          <span
                            className={
                              currentDraft.openGrades[q.id].isCorrect
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-orange-600 dark:text-orange-400'
                            }
                          >
                            {currentDraft.openGrades[q.id].isCorrect
                              ? 'Comprensión lograda'
                              : 'Comprensión parcial — Recomendado reforzar'}
                          </span>
                          <span className="font-mono tabular-nums text-slate-900 dark:text-white">
                            {currentDraft.openGrades[q.id].score} / 100
                          </span>
                        </div>
                        <p className="reading-content-sm text-slate-700 dark:text-slate-300">
                          {currentDraft.openGrades[q.id].feedback}
                        </p>
                        {currentDraft.openGrades[q.id].missingConcepts.length > 0 && (
                          <div className="text-xs text-slate-600 dark:text-slate-300">
                            <span className="font-semibold text-slate-900 dark:text-white">
                              Para reforzar:{' '}
                            </span>
                            {currentDraft.openGrades[q.id].missingConcepts.join('; ')}
                          </div>
                        )}
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-700 reading-content-sm text-slate-600 dark:text-slate-400">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            Síntesis de referencia:{' '}
                          </span>
                          {q.explanation}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Top Mode Switcher: Chapter Eval | Integral Book Eval | Learning Tracking */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 sm:p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => {
              setSubTab('chapter');
              setErrorMsg('');
            }}
            className={`px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
              subTab === 'chapter'
                ? 'bg-blue-700 dark:bg-blue-600 border-blue-700 text-white'
                : 'bg-slate-50 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-blue-500'
            }`}
          >
            <BookOpen className="w-4 h-4 shrink-0" />
            <span>Evaluación por Capítulo</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSubTab('integral');
              setErrorMsg('');
            }}
            className={`px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
              subTab === 'integral'
                ? 'bg-blue-700 dark:bg-blue-600 border-blue-700 text-white'
                : 'bg-slate-50 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-blue-500'
            }`}
          >
            <Layers className="w-4 h-4 shrink-0" />
            <span>Evaluación Integral ({chapters.length} caps)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSubTab('tracking');
              setErrorMsg('');
            }}
            className={`px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
              subTab === 'tracking'
                ? 'bg-blue-700 dark:bg-blue-600 border-blue-700 text-white'
                : 'bg-slate-50 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-blue-500'
            }`}
          >
            <TrendingUp className="w-4 h-4 shrink-0" />
            <span>Seguimiento ({cache.attempts.length})</span>
          </button>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-900 dark:text-rose-200 flex items-center justify-between gap-2"
          >
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              {errorMsg}
            </span>
            <button
              type="button"
              onClick={() => setErrorMsg('')}
              className="font-semibold underline cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        )}
      </section>

      {subTab === 'chapter' && renderEvaluationView('chapter')}
      {subTab === 'integral' && renderEvaluationView('integral')}

      {/* =====================================================================
          SUB-TAB 3: SEGUIMIENTO DEL APRENDIZAJE
          (Explicitly distinguishes Processing Coverage vs Comprehension Mastery)
          ===================================================================== */}
      {subTab === 'tracking' && (
        <div className="space-y-4 sm:space-y-6">
          {/* Metric Separation Card: Processing Coverage != Comprehension Mastery */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
            <div>
              <div className="text-xs font-medium text-orange-600 dark:text-orange-400 mb-0.5">
                Seguimiento del Aprendizaje · Métricas Independientes
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Progreso de Comprensión vs Cobertura de Procesamiento
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                El porcentaje de páginas procesadas mide cuánto del PDF fue analizado; el porcentaje de comprensión mide exclusivamente tus resultados en evaluaciones completadas.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Comprehension Metric */}
              <div className="p-4 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/80 space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-bold text-blue-900 dark:text-blue-200">
                    Nivel de Comprensión Demostrada
                  </span>
                  <span className="text-2xl font-bold font-mono tabular-nums text-blue-700 dark:text-blue-300">
                    {learningStats.overallComprehensionPercent !== null
                      ? `${learningStats.overallComprehensionPercent}%`
                      : 'Sin evaluar'}
                  </span>
                </div>
                <div className="w-full h-2.5 bg-white/80 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-700 dark:bg-blue-400 rounded-full transition-all"
                    style={{ width: `${learningStats.overallComprehensionPercent || 0}%` }}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                  <span>{learningStats.totalAttempts} evaluaciones guardadas</span>
                  <span>
                    {learningStats.totalCorrect} aciertos · {learningStats.totalIncorrect} errores
                  </span>
                </div>
              </div>

              {/* Processing Coverage Metric (Strictly separate) */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    Cobertura de Procesamiento del PDF (Etapa 1)
                  </span>
                  <span className="text-2xl font-bold font-mono tabular-nums text-slate-800 dark:text-slate-100">
                    {coverageReport ? `${coverageReport.realCoveragePercent}%` : '—'}
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 dark:bg-emerald-500 rounded-full"
                    style={{ width: `${coverageReport ? coverageReport.realCoveragePercent : 0}%` }}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  <span>
                    {coverageReport
                      ? `${coverageReport.coveredPages}/${coverageReport.totalPages} págs procesadas`
                      : `${chapters.length} capítulos cargados`}
                  </span>
                  <span>Métrica técnica de lectura</span>
                </div>
              </div>
            </div>
          </section>

          {learningStats.totalAttempts === 0 ? (
            <div className="p-6 sm:p-8 rounded-2xl bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700 text-center space-y-3">
              <TrendingUp className="w-8 h-8 mx-auto text-orange-500" />
              <p className="text-sm font-bold text-slate-900 dark:text-white">
                Aún no hay resultados registrados en Seguimiento
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Completa una Evaluación por Capítulo o una Evaluación Integral y haz clic en{' '}
                <strong>Guardar en Seguimiento</strong> para ver tu desempeño por capítulo, conceptos dominados y evolución.
              </p>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setSubTab('chapter')}
                  className="px-3.5 py-2 rounded-lg bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                >
                  Ir a Evaluación por Capítulo
                </button>
                <button
                  type="button"
                  onClick={() => setSubTab('integral')}
                  className="px-3.5 py-2 rounded-lg bg-orange-600 text-white text-xs font-semibold cursor-pointer"
                >
                  Ir a Evaluación Integral
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Per-Chapter Results */}
              <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
                <h4 className="text-base font-bold text-slate-900 dark:text-white">
                  Resultados de Comprensión por Capítulo
                </h4>
                <div className="space-y-3">
                  {learningStats.chapterStats.map((st) => {
                    const hasData = st.correct + st.incorrect > 0;
                    return (
                      <div
                        key={st.chapterNumber}
                        className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-1.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <button
                            type="button"
                            onClick={() => onJumpToChapter(st.chapterNumber)}
                            className="font-bold text-slate-900 dark:text-white hover:text-blue-700 dark:hover:text-blue-300 text-left cursor-pointer"
                          >
                            Cap. {st.chapterNumber}: {st.chapterTitle}
                          </button>
                          <span className="font-mono tabular-nums font-bold text-slate-700 dark:text-slate-200">
                            {hasData
                              ? `${st.comprehensionPercent}% (${st.correct} ✓ · ${st.incorrect} ✗)`
                              : 'Pendiente de evaluar'}
                          </span>
                        </div>
                        <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              !hasData
                                ? 'bg-slate-300 dark:bg-slate-600'
                                : st.comprehensionPercent >= 75
                                ? 'bg-emerald-600 dark:bg-emerald-500'
                                : 'bg-orange-500 dark:bg-orange-400'
                            }`}
                            style={{ width: `${hasData ? st.comprehensionPercent : 0}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Mastered Concepts vs Concepts Needing Reinforcement */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Conceptos Dominados ({learningStats.masteredConcepts.length})</span>
                  </div>
                  {learningStats.masteredConcepts.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Los conceptos con ≥ 75% de aciertos aparecerán aquí.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {learningStats.masteredConcepts.map((c) => (
                        <div
                          key={c.concept}
                          className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/70 flex items-center justify-between gap-2 text-xs"
                        >
                          <div>
                            <div className="font-bold text-slate-900 dark:text-white">{c.concept}</div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                              Cap. {c.chapterNumbers.join(', ')}
                            </div>
                          </div>
                          <span className="font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                            {c.accuracyPercent}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-orange-600 dark:text-orange-400">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Conceptos por Reforzar ({learningStats.reinforceConcepts.length})</span>
                  </div>
                  {learningStats.reinforceConcepts.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      ¡Excelente! No hay conceptos pendientes de refuerzo por ahora.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {learningStats.reinforceConcepts.map((c) => (
                        <div
                          key={c.concept}
                          className="p-3 rounded-xl bg-orange-50/70 dark:bg-orange-950/35 border border-orange-200 dark:border-orange-800/70 space-y-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div className="font-bold text-slate-900 dark:text-white">
                                {c.concept}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                                Cap. {c.chapterNumbers.join(', ')} · {c.correct}/{c.total} aciertos
                              </div>
                            </div>
                            <span className="font-mono font-bold tabular-nums text-orange-600 dark:text-orange-400">
                              {c.accuracyPercent}%
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {c.chapterNumbers[0] && (
                              <button
                                type="button"
                                onClick={() => onJumpToChapter(c.chapterNumbers[0])}
                                className="px-2 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-blue-700 dark:text-blue-300 cursor-pointer"
                              >
                                Repasar Cap. {c.chapterNumbers[0]}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                onAskInChat(
                                  `Necesito reforzar el concepto "${c.concept}" del libro. Explícamelo con claridad y un ejemplo concreto del texto.`
                                )
                              }
                              className="px-2 py-1 rounded-md bg-blue-700 text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                            >
                              <MessageSquare className="w-3 h-3 text-orange-300" />
                              <span>Reforzar en Chat</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              {/* Chronological Evolution of Evaluations */}
              <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
                <h4 className="text-base font-bold text-slate-900 dark:text-white">
                  Evolución de las Evaluaciones
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {learningStats.evolutionSeries.map((ev) => (
                    <div
                      key={ev.attemptNumber}
                      className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono font-bold text-blue-700 dark:text-blue-300">
                          Intento #{ev.attemptNumber} · {ev.label}
                        </span>
                        <span className="font-mono font-bold tabular-nums text-orange-600 dark:text-orange-400">
                          {ev.comprehensionPercent}%
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            ev.comprehensionPercent >= 75
                              ? 'bg-emerald-600 dark:bg-emerald-500'
                              : 'bg-orange-500 dark:bg-orange-400'
                          }`}
                          style={{ width: `${ev.comprehensionPercent}%` }}
                        />
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {new Date(ev.completedAt).toLocaleString('es-ES', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
