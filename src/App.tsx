/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Download,
  Send,
  RefreshCw,
  BookOpen,
  HelpCircle,
  MessageSquare,
  Printer,
  RotateCcw,
  FileUp,
  Trash2,
  Compass,
  Layers,
  Award,
  Quote,
  ArrowRight,
  FileText,
  BookMarked,
  Sparkles,
  Briefcase,
  Target,
  BarChart3,
} from 'lucide-react';
import {
  ChapterItem,
  DocumentAnalysis,
  ExtractedPage,
  PdfOutlineItem,
  QuizQuestion,
  RealWorldAdaptationItem,
  StructureDetectionMethod,
} from './data/enamoratePreset';
import {
  ActiveTab,
  PRIMARY_NAV_SECTIONS,
  UPCOMING_NAV_SLOTS,
} from './config/navigation';
import {
  ReadingPreferences,
  applyReadingPreferencesToDom,
  loadReadingPreferences,
  saveReadingPreferences,
} from './utils/readingPreferences';
import {
  ReadingControlsStrip,
  ReadingSettingsModal,
} from './components/ReadingSettingsPanel';
import {
  buildStructuredDocumentFromText,
  downloadTextFile,
  extractTextFromFile,
  generateMarkdownReport,
} from './utils/pdfAndExport';
import {
  computeCoverageReport,
  detectLocalChapterCandidates,
  getChapterRawText,
  normalizeAndValidateSegments,
} from './utils/bookSegmentation';
import {
  buildBalancedBookQuizContext,
  buildChapterDirectory,
  retrieveRelevantPassages,
} from './utils/bookRetrieval';
import {
  clearBookSession,
  loadBookSession,
  saveBookSession,
} from './utils/bookPersistence';
import ExplainerVideoStudio, {
  GeneratedExplainerVideo,
} from './components/ExplainerVideoStudio';
import { Stage3EvaluationStudio } from './components/Stage3EvaluationStudio';
import {
  Stage3BookCache,
  computeBookFingerprint,
  createEmptyStage3Cache,
  loadStage3Cache,
  saveStage3Cache,
} from './utils/stage3Storage';
import { apiUrl, readApiJson } from './utils/api';

import heroIllustrationUrl from './assets/images/editorial_reading_studio_hero_1794091696482.jpg';
import synthesisIllustrationUrl from './assets/images/schema_book_synthesis_art_1794091697552.jpg';
import compassIllustrationUrl from './assets/images/schema_chapter_compass_art_1794091699649.jpg';
import quizIllustrationUrl from './assets/images/schema_quiz_mastery_art_1794091699280.jpg';

const HERO_ILLUSTRATION = heroIllustrationUrl;
const SYNTHESIS_ILLUSTRATION = synthesisIllustrationUrl;
const COMPASS_ILLUSTRATION = compassIllustrationUrl;
const QUIZ_ILLUSTRATION = quizIllustrationUrl;

interface OpenEvaluationResult {
  isCorrect: boolean;
  score: number;
  feedback: string;
  missingConcepts: string[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: string[];
  groundingStatus?: string;
  timestamp: string;
}

const CATEGORY_COLORS = [
  {
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    border: 'border-blue-200 dark:border-blue-800/70',
    text: 'text-blue-900 dark:text-blue-200',
    bar: 'bg-blue-600 dark:bg-blue-400',
  },
  {
    bg: 'bg-orange-50 dark:bg-orange-950/35',
    border: 'border-orange-200 dark:border-orange-800/70',
    text: 'text-orange-900 dark:text-orange-200',
    bar: 'bg-orange-500 dark:bg-orange-400',
  },
  {
    bg: 'bg-emerald-50 dark:bg-emerald-950/35',
    border: 'border-emerald-200 dark:border-emerald-800/70',
    text: 'text-emerald-900 dark:text-emerald-200',
    bar: 'bg-emerald-600 dark:bg-emerald-400',
  },
  {
    bg: 'bg-sky-50 dark:bg-sky-950/35',
    border: 'border-sky-200 dark:border-sky-800/70',
    text: 'text-sky-900 dark:text-sky-200',
    bar: 'bg-sky-600 dark:bg-sky-400',
  },
  {
    bg: 'bg-slate-100 dark:bg-slate-800/70',
    border: 'border-slate-300 dark:border-slate-700',
    text: 'text-slate-900 dark:text-slate-200',
    bar: 'bg-slate-600 dark:bg-slate-400',
  },
];

const REAL_WORLD_DOMAINS = [
  'Negocios y Estrategia Empresarial',
  'Liderazgo y Gestión de Equipos',
  'Startups, Innovación y Producto',
  'Ventas, Marketing y Clientes',
  'Operaciones y Cultura Organizacional',
  'Carrera Profesional y Toma de Decisiones',
] as const;

export default function App() {
  // Navigation state
  const [activeTab, setActiveTab] = useState<ActiveTab>('summary');

  // Reading Experience & Personalization state (Etapa 2: Dark Mode, 6 Fonts, A-/A+ Scale)
  const [readingPrefs, setReadingPrefs] = useState<ReadingPreferences>(() =>
    loadReadingPreferences()
  );
  const [showReadingSettings, setShowReadingSettings] = useState<boolean>(false);

  useEffect(() => {
    applyReadingPreferencesToDom(readingPrefs);
    saveReadingPreferences(readingPrefs);
  }, [readingPrefs]);

  // Book / Document state (starts clean without any pre-loaded book)
  const [fileName, setFileName] = useState<string>('');
  const [pageCount, setPageCount] = useState<number>(0);
  const [extractedPages, setExtractedPages] = useState<ExtractedPage[]>([]);
  const [pdfOutline, setPdfOutline] = useState<PdfOutlineItem[]>([]);
  const [detectionMethod, setDetectionMethod] = useState<StructureDetectionMethod>('heading_detection');
  const [documentText, setDocumentText] = useState<string>('');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [showManualTextModal, setShowManualTextModal] = useState<boolean>(false);
  const [manualTitleDraft, setManualTitleDraft] = useState<string>('');
  const [manualTextDraft, setManualTextDraft] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('Todas');

  // Analysis & Quiz state
  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, number>>({});
  const [openAnswersDraft, setOpenAnswersDraft] = useState<Record<string, string>>({});
  const [openEvaluations, setOpenEvaluations] = useState<Record<string, OpenEvaluationResult>>({});
  const [evaluatingQuestionId, setEvaluatingQuestionId] = useState<string | null>(null);

  // Quiz generator settings
  const [quizDifficulty, setQuizDifficulty] = useState<'Básico' | 'Intermedio' | 'Avanzado'>('Intermedio');
  const [quizMode, setQuizMode] = useState<'mixed' | 'multiple_choice' | 'open'>('mixed');
  const [quizCount, setQuizCount] = useState<number>(6);
  const [evalViewMode, setEvalViewMode] = useState<'stage3' | 'quick'>('stage3');

  // Etapa 3: Persistent on-demand visual & evaluation cache (separate IndexedDB from Etapa 1)
  const [stage3Cache, setStage3Cache] = useState<Stage3BookCache | null>(null);

  // Chapter Explorer & Reading Progress state
  const [activeChapterIdx, setActiveChapterIdx] = useState<number>(0);
  const [exploredChapters, setExploredChapters] = useState<Record<number, boolean>>({});
  const [retryingChapterIdx, setRetryingChapterIdx] = useState<number | null>(null);

  // Real-World Adaptation Module state (Negocios, Liderazgo, Empresa, etc.)
  const [selectedAdaptationDomain, setSelectedAdaptationDomain] = useState<string>(
    REAL_WORLD_DOMAINS[0]
  );
  const [customAdaptationContext, setCustomAdaptationContext] = useState<string>('');
  const [customChapterAdaptations, setCustomChapterAdaptations] = useState<
    Record<number, RealWorldAdaptationItem>
  >({});
  const [isAdaptingChapter, setIsAdaptingChapter] = useState<boolean>(false);

  // Cached AI-narrated explanatory videos (keyed by book or chapter)
  const [generatedVideos, setGeneratedVideos] = useState<
    Record<string, GeneratedExplainerVideo>
  >({});

  // Reading Assistant Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);

  // Loading & Error Feedback state
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const pipelineRunIdRef = useRef<number>(0);
  const hasHydratedPersistenceRef = useRef<boolean>(false);

  const hasLoadedBook = Boolean(analysis && documentText.trim().length >= 20);

  // Restore persisted book analysis & progress from IndexedDB on initial mount
  useEffect(() => {
    let cancelled = false;
    loadBookSession()
      .then((saved) => {
        if (cancelled) return;
        if (saved && saved.analysis && saved.documentText?.trim().length >= 20) {
          const restoredPages =
            Array.isArray(saved.pages) && saved.pages.length > 0
              ? saved.pages
              : buildStructuredDocumentFromText(saved.documentText).pages;
          const restoredMethod =
            saved.analysis.coverageReport?.detectionMethod || 'heading_detection';
          const normalizedChapters = Array.isArray(saved.analysis.chapters)
            ? saved.analysis.chapters.map((ch) =>
                ch.status === 'processing' ? { ...ch, status: 'pending' as const } : ch
              )
            : [];
          const recomputedCoverage = computeCoverageReport(
            restoredPages,
            normalizedChapters,
            restoredMethod
          );

          setFileName(saved.fileName || saved.analysis.title || 'Libro');
          setPageCount(saved.pageCount || restoredPages.length);
          setExtractedPages(restoredPages);
          setPdfOutline(Array.isArray(saved.outline) ? saved.outline : []);
          setDetectionMethod(restoredMethod);
          setDocumentText(saved.documentText);
          setAnalysis({
            ...saved.analysis,
            chapters: normalizedChapters,
            coverageReport: recomputedCoverage,
          });
          setQuestions(Array.isArray(saved.questions) ? saved.questions : []);
          setSelectedOptions(saved.selectedOptions || {});
          setOpenAnswersDraft(saved.openAnswersDraft || {});
          setOpenEvaluations(saved.openEvaluations || {});
          setExploredChapters(saved.exploredChapters || { 0: true });
          setCustomChapterAdaptations(saved.customChapterAdaptations || {});
          setChatMessages(Array.isArray(saved.chatMessages) ? saved.chatMessages : []);
          setActiveChapterIdx(
            typeof saved.activeChapterIdx === 'number' ? saved.activeChapterIdx : 0
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          hasHydratedPersistenceRef.current = true;
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced auto-save to IndexedDB whenever active book analysis or user progress changes
  useEffect(() => {
    if (!hasHydratedPersistenceRef.current) return;
    if (!analysis || documentText.trim().length < 20) return;

    const timer = window.setTimeout(() => {
      saveBookSession({
        version: 1,
        savedAt: new Date().toISOString(),
        fileName: fileName || analysis.title || 'Libro',
        pageCount: pageCount || extractedPages.length,
        pages: extractedPages,
        outline: pdfOutline,
        documentText,
        analysis,
        questions,
        selectedOptions,
        openAnswersDraft,
        openEvaluations,
        exploredChapters,
        customChapterAdaptations,
        chatMessages,
        activeChapterIdx,
      }).catch(() => {});
    }, 450);

    return () => window.clearTimeout(timer);
  }, [
    analysis,
    fileName,
    pageCount,
    extractedPages,
    pdfOutline,
    documentText,
    questions,
    selectedOptions,
    openAnswersDraft,
    openEvaluations,
    exploredChapters,
    customChapterAdaptations,
    chatMessages,
    activeChapterIdx,
  ]);

  // Etapa 3: Compute stable fingerprint for the loaded book and hydrate its visual/evaluation cache
  const stage3BookFingerprint = analysis ? computeBookFingerprint(analysis) : '';

  useEffect(() => {
    if (!analysis || !stage3BookFingerprint) {
      setStage3Cache(null);
      return;
    }
    let cancelled = false;
    const bookTitle = analysis.title || fileName || 'Libro';
    loadStage3Cache(stage3BookFingerprint, bookTitle)
      .then((loaded) => {
        if (!cancelled) {
          setStage3Cache(loaded);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStage3Cache(createEmptyStage3Cache(stage3BookFingerprint, bookTitle));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [stage3BookFingerprint, analysis?.title, fileName]);

  const handleUpdateStage3Cache = (
    updater: (prev: Stage3BookCache) => Stage3BookCache
  ) => {
    if (!analysis || !stage3BookFingerprint) return;
    const bookTitle = analysis.title || fileName || 'Libro';
    setStage3Cache((prev) => {
      const base = prev || createEmptyStage3Cache(stage3BookFingerprint, bookTitle);
      const next = updater(base);
      saveStage3Cache(next).catch(() => {});
      return next;
    });
  };

  // Navigate to a tab and scroll smoothly to the top of the workspace
  const handleNavigateTab = (tab: ActiveTab) => {
    if (tab === 'explorer' && analysis?.chapters?.length) {
      setExploredChapters((prev) => ({ ...prev, [activeChapterIdx]: true }));
    }
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Navigate to a specific chapter and mark it as explored/completed
  const handleSelectAndExploreChapter = (idx: number, switchToExplorer = true) => {
    setActiveChapterIdx(idx);
    setExploredChapters((prev) => ({ ...prev, [idx]: true }));
    if (switchToExplorer) {
      setActiveTab('explorer');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Jump to chapter by its chapter number string (e.g. "03", "3", "Cap. 3") from Stage 3 evaluations
  const handleJumpToChapterNumber = (chapterNumber: string) => {
    const list = Array.isArray(analysis?.chapters) ? analysis.chapters : [];
    if (list.length === 0) return;
    const targetDigits = String(chapterNumber || '').replace(/[^0-9]/g, '');
    const targetClean = String(chapterNumber || '').trim().toLowerCase();
    let idx = list.findIndex((ch) => {
      const chClean = String(ch.n || '').trim().toLowerCase();
      const chDigits = chClean.replace(/[^0-9]/g, '');
      return (
        chClean === targetClean ||
        (targetDigits.length > 0 && Number(chDigits) === Number(targetDigits))
      );
    });
    if (idx < 0 && targetDigits) {
      const num = Number(targetDigits);
      if (num >= 1 && num <= list.length) idx = num - 1;
    }
    if (idx >= 0) {
      handleSelectAndExploreChapter(idx, true);
    }
  };

  // Open Dialogar con el Libro with a pre-filled question from Stage 3 reinforcement list
  const handleAskInChatFromStage3 = (question: string) => {
    setActiveTab('chat');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
      handleSendChatQuestion(question);
    }, 60);
  };

  // Toggle completion status of a chapter manually
  const handleToggleChapterCompleted = (idx: number) => {
    setExploredChapters((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  };

  // Adapt the currently active chapter to a chosen real-world domain or custom case
  const handleAdaptChapterToRealWorld = async (domainOverride?: string) => {
    const currentChapters = Array.isArray(analysis?.chapters) ? analysis.chapters : [];
    const cap = currentChapters[activeChapterIdx] || currentChapters[0];
    if (!cap) return;

    const targetDomain = domainOverride || selectedAdaptationDomain;
    if (domainOverride) {
      setSelectedAdaptationDomain(domainOverride);
    }

    setErrorMessage('');
    setIsAdaptingChapter(true);

    try {
      const res = await fetch(apiUrl('/api/adapt-chapter'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookTitle: analysis?.title || fileName,
          chapterNumber: cap.n,
          chapterTitle: cap.titulo,
          chapterIdea: cap.idea,
          chapterAnalysis: cap.analisisDetallado || '',
          chapterStory: cap.historia || '',
          chapterConcepts: cap.conceptosClave || [],
          chapterTips: cap.consejos || [],
          targetDomain,
          customContext: customAdaptationContext,
        }),
      });

      const data = await readApiJson<RealWorldAdaptationItem & { error?: string }>(res);
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo generar la adaptación al mundo actual.');
      }

      setCustomChapterAdaptations((prev) => ({
        ...prev,
        [activeChapterIdx]: data,
      }));

      // Also sync into analysis state so Markdown export includes this adapted case
      setAnalysis((prev) => {
        if (!prev || !Array.isArray(prev.chapters)) return prev;
        const updatedChapters = prev.chapters.map((ch, idx) =>
          idx === activeChapterIdx ? { ...ch, adaptacionMundoActual: data } : ch
        );
        return { ...prev, chapters: updatedChapters };
      });
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Error al adaptar el capítulo al caso de la vida real.'
      );
    } finally {
      setIsAdaptingChapter(false);
    }
  };

  // Clear current book and return to clean empty state
  const handleClearBook = () => {
    pipelineRunIdRef.current += 1;
    clearBookSession().catch(() => {});
    setFileName('');
    setPageCount(0);
    setExtractedPages([]);
    setPdfOutline([]);
    setDocumentText('');
    setAnalysis(null);
    setQuestions([]);
    setSelectedOptions({});
    setOpenAnswersDraft({});
    setOpenEvaluations({});
    setChatMessages([]);
    setCategoryFilter('Todas');
    setActiveChapterIdx(0);
    setExploredChapters({});
    setCustomChapterAdaptations({});
    setCustomAdaptationContext('');
    setGeneratedVideos({});
    setErrorMessage('');
    setLoadingMessage('');
    setLoadingProgress(0);
    setActiveTab('summary');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Helper: Analyze a single chapter by index (used by progressive pipeline & manual retry)
  const analyzeSingleChapterRequest = async (params: {
    bookTitle: string;
    authorOrSource: string;
    chapter: ChapterItem;
    pages: ExtractedPage[];
  }): Promise<ChapterItem> => {
    const { bookTitle, authorOrSource, chapter, pages } = params;
    const sp = chapter.startPage ?? 1;
    const ep = chapter.endPage ?? pages.length;
    const chapterText = getChapterRawText(pages, sp, ep);

    if (!chapterText || chapterText.trim().length < 20) {
      throw new Error(
        `Las páginas ${sp}–${ep} del Capítulo ${chapter.n} no contienen texto digital legible.`
      );
    }

    const res = await fetch(apiUrl('/api/analyze-chapter'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookTitle,
        authorOrSource,
        chapterNumber: chapter.n,
        chapterTitle: chapter.titulo,
        startPage: sp,
        endPage: ep,
        chapterText,
      }),
    });

    const data = await readApiJson<ChapterItem & { error?: string }>(res);
    if (!res.ok) {
      throw new Error(data.error || `Error al analizar el Capítulo ${chapter.n}.`);
    }

    return {
      ...chapter,
      ...data,
      startPage: sp,
      endPage: ep,
      charCount: chapterText.length,
      status: 'completed',
      errorMessage: undefined,
    };
  };

  // Retry a single failed or pending chapter on demand
  const handleRetryChapter = async (idx: number) => {
    if (!analysis || !Array.isArray(analysis.chapters) || !analysis.chapters[idx]) return;
    const targetChapter = analysis.chapters[idx];
    const activePages =
      extractedPages.length > 0
        ? extractedPages
        : buildStructuredDocumentFromText(documentText).pages;

    setRetryingChapterIdx(idx);
    setErrorMessage('');

    setAnalysis((prev) => {
      if (!prev) return prev;
      const updated = prev.chapters.map((ch, i) =>
        i === idx ? { ...ch, status: 'processing' as const, errorMessage: undefined } : ch
      );
      return {
        ...prev,
        chapters: updated,
        coverageReport: computeCoverageReport(activePages, updated, detectionMethod),
      };
    });

    try {
      const completed = await analyzeSingleChapterRequest({
        bookTitle: analysis.title || fileName,
        authorOrSource: analysis.authorOrSource || 'Autor del libro',
        chapter: targetChapter,
        pages: activePages,
      });

      setAnalysis((prev) => {
        if (!prev) return prev;
        const updated = prev.chapters.map((ch, i) => (i === idx ? completed : ch));
        return {
          ...prev,
          chapters: updated,
          coverageReport: computeCoverageReport(activePages, updated, detectionMethod),
        };
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al reintentar el capítulo.';
      setAnalysis((prev) => {
        if (!prev) return prev;
        const updated = prev.chapters.map((ch, i) =>
          i === idx ? { ...ch, status: 'error' as const, errorMessage: msg } : ch
        );
        return {
          ...prev,
          chapters: updated,
          coverageReport: computeCoverageReport(activePages, updated, detectionMethod),
        };
      });
    } finally {
      setRetryingChapterIdx(null);
    }
  };

  // Run Stage 1 Integral AI Pipeline:
  // 1) Structured pages + outline -> 2) Full chapter structure detection ->
  // 3) Progressive chapter-by-chapter deep analysis -> 4) Global synthesis from ALL chapters -> 5) Balanced Quiz
  const runFullAiPipeline = async (
    textToAnalyze: string,
    nameOfBook: string,
    pagesInput?: ExtractedPage[],
    outlineInput?: PdfOutlineItem[]
  ) => {
    if (!textToAnalyze || textToAnalyze.trim().length < 20) {
      setErrorMessage('Por favor adjunta un libro con contenido válido antes de analizar.');
      return;
    }

    const runId = ++pipelineRunIdRef.current;
    const isCancelled = () => pipelineRunIdRef.current !== runId;

    setErrorMessage('');
    setLoadingMessage(`Identificando estructura y capítulos completos de "${nameOfBook}"...`);
    setLoadingProgress(38);

    try {
      const structured =
        pagesInput && pagesInput.length > 0
          ? { pages: pagesInput, outline: outlineInput || [] }
          : buildStructuredDocumentFromText(textToAnalyze);

      const activePages = structured.pages;
      const activeOutline = structured.outline;
      setExtractedPages(activePages);
      setPdfOutline(activeOutline);
      setPageCount(activePages.length);

      // Phase 2: Local structural scan + AI verification of ALL chapters across page 1..N
      const digest = detectLocalChapterCandidates(activePages, activeOutline);
      let resolvedTitle = nameOfBook;
      let resolvedAuthor = 'Autor del libro';
      let chosenMethod: StructureDetectionMethod = digest.localMethod;
      let finalSegments = digest.localSegments;

      try {
        const structRes = await fetch(apiUrl('/api/detect-structure'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: nameOfBook,
            totalPages: digest.totalPages,
            readablePages: digest.readablePages,
            outline: digest.outline,
            tocExcerpt: digest.tocExcerpt,
            headingCandidates: digest.headingCandidates,
            pageSamples: digest.pageSamples,
          }),
        });

        if (structRes.ok) {
          const structData = await readApiJson<{
            title?: string;
            authorOrSource?: string;
            chapters?: Array<{ n?: string; titulo: string; startPage: number; endPage?: number }>;
          }>(structRes);

          if (structData.title) resolvedTitle = structData.title;
          if (structData.authorOrSource) resolvedAuthor = structData.authorOrSource;

          const aiChapters = Array.isArray(structData.chapters) ? structData.chapters : [];
          // Trust AI chapter structure if it detects multiple chapters (or matches a short single-section doc)
          // and never downgrade if local outline/headings already found substantially more valid chapters
          const shouldUseAi =
            aiChapters.length >= 2 ||
            (aiChapters.length === 1 && digest.readablePages <= 10 && digest.localSegments.length <= 1);

          if (shouldUseAi && aiChapters.length >= Math.min(2, digest.localSegments.length)) {
            chosenMethod = digest.outline.length >= 2 ? 'pdf_outline' : 'ai_structure';
            finalSegments = normalizeAndValidateSegments(aiChapters, activePages, chosenMethod);
          }
        }
      } catch {
        // Safe fallback to deterministic local segments
      }

      if (isCancelled()) return;

      setDetectionMethod(chosenMethod);

      // Build initial chapter skeleton so ALL detected chapters appear immediately
      const workingChapters: ChapterItem[] = finalSegments.map((seg) => ({
        n: seg.n,
        titulo: seg.titulo,
        subtitulo: `Páginas ${seg.startPage}–${seg.endPage}`,
        idea: 'En cola para análisis profundo capítulo por capítulo...',
        analisisDetallado: '',
        historia: '',
        conceptosClave: [],
        citaCapitulo: '',
        consejos: [],
        preguntasReflexion: [],
        startPage: seg.startPage,
        endPage: seg.endPage,
        charCount: seg.charCount,
        status: 'pending',
      }));

      const initialCoverage = computeCoverageReport(activePages, workingChapters, chosenMethod);

      const initialAnalysis: DocumentAnalysis = {
        title: resolvedTitle,
        authorOrSource: resolvedAuthor,
        executiveSummary: `Se detectaron ${workingChapters.length} capítulos a lo largo de ${activePages.length} páginas (${initialCoverage.readablePages} con texto digital legible). Procesando cada capítulo de forma progresiva para construir la síntesis integral del libro...`,
        objectives: [],
        keyPoints: [],
        keyMetrics: [],
        chapters: [...workingChapters],
        quotes: [],
        conclusions: [],
        suggestedQuestions: [],
        coverageReport: initialCoverage,
      };

      setAnalysis(initialAnalysis);
      setGeneratedVideos({});
      setCategoryFilter('Todas');
      setActiveChapterIdx(0);
      setExploredChapters({ 0: true });
      setActiveTab('summary');
      setLoadingProgress(45);
      setLoadingMessage(
        `Estructura detectada (${workingChapters.length} capítulos en ${activePages.length} págs.). Analizando capítulo 1 de ${workingChapters.length}...`
      );

      // Phase 3: Progressive chapter-by-chapter analysis (concurrency = 2)
      let completedCount = 0;
      const totalToProcess = workingChapters.length;
      let nextIndex = 0;
      const CONCURRENCY = 2;

      const updateLiveChapters = () => {
        if (isCancelled()) return;
        const cov = computeCoverageReport(activePages, workingChapters, chosenMethod);
        setAnalysis((prev) =>
          prev
            ? {
                ...prev,
                chapters: [...workingChapters],
                coverageReport: cov,
              }
            : prev
        );
      };

      const worker = async () => {
        while (nextIndex < totalToProcess) {
          if (isCancelled()) return;
          const idx = nextIndex++;
          const target = workingChapters[idx];

          workingChapters[idx] = { ...target, status: 'processing', errorMessage: undefined };
          updateLiveChapters();

          try {
            const analyzedChapter = await analyzeSingleChapterRequest({
              bookTitle: resolvedTitle,
              authorOrSource: resolvedAuthor,
              chapter: target,
              pages: activePages,
            });
            workingChapters[idx] = analyzedChapter;
          } catch (chErr: unknown) {
            workingChapters[idx] = {
              ...target,
              status: 'error',
              idea: 'No se pudo completar el análisis automático de este capítulo.',
              errorMessage:
                chErr instanceof Error ? chErr.message : 'Error al procesar el capítulo.',
            };
          }

          completedCount++;
          if (isCancelled()) return;

          const pct = Math.round(45 + (completedCount / Math.max(1, totalToProcess)) * 42);
          setLoadingProgress(pct);
          setLoadingMessage(
            `Analizando capítulos progresivamente: ${completedCount} de ${totalToProcess} completados...`
          );
          updateLiveChapters();
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, totalToProcess) }, () => worker())
      );

      if (isCancelled()) return;

      const completedChapters = workingChapters.filter((ch) => ch.status === 'completed');
      const finalCoverage = computeCoverageReport(activePages, workingChapters, chosenMethod);

      if (completedChapters.length === 0) {
        throw new Error(
          'No se pudo analizar ningún capítulo del libro. Verifica la conexión o reintenta.'
        );
      }

      // Phase 4: Global synthesis constructed from ALL processed chapters
      setLoadingProgress(90);
      setLoadingMessage(
        `Construyendo síntesis global e ideas clave a partir de los ${completedChapters.length} capítulos procesados...`
      );

      let overviewData: Partial<DocumentAnalysis> = {};
      try {
        const overviewRes = await fetch(apiUrl('/api/analyze-overview'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: nameOfBook,
            bookTitle: resolvedTitle,
            authorOrSource: resolvedAuthor,
            totalPages: activePages.length,
            chapterSummaries: completedChapters.map((ch) => ({
              n: ch.n,
              titulo: ch.titulo,
              startPage: ch.startPage,
              endPage: ch.endPage,
              idea: ch.idea,
              analisisDetallado: ch.analisisDetallado,
              historia: ch.historia,
              conceptosClave: ch.conceptosClave,
              citaCapitulo: ch.citaCapitulo,
              consejos: ch.consejos,
            })),
          }),
        });
        if (overviewRes.ok) {
          overviewData = await readApiJson<Partial<DocumentAnalysis>>(overviewRes);
        }
      } catch {
        // Keep chapter-level data even if overview request fails transiently
      }

      if (isCancelled()) return;

      const finalTitle = overviewData.title || resolvedTitle;
      const finalAuthor = overviewData.authorOrSource || resolvedAuthor;

      const finalAnalysis: DocumentAnalysis = {
        title: finalTitle,
        authorOrSource: finalAuthor,
        executiveSummary:
          overviewData.executiveSummary ||
          completedChapters.map((c) => `Capítulo ${c.n} (${c.titulo}): ${c.idea}`).join('\n\n'),
        objectives: Array.isArray(overviewData.objectives) ? overviewData.objectives : [],
        keyPoints: Array.isArray(overviewData.keyPoints) ? overviewData.keyPoints : [],
        keyMetrics: Array.isArray(overviewData.keyMetrics) ? overviewData.keyMetrics : [],
        chapters: [...workingChapters],
        quotes:
          Array.isArray(overviewData.quotes) && overviewData.quotes.length > 0
            ? overviewData.quotes
            : completedChapters
                .filter((c) => c.citaCapitulo)
                .slice(0, 8)
                .map((c) => ({ texto: c.citaCapitulo!, autor: `Capítulo ${c.n}: ${c.titulo}` })),
        conclusions: Array.isArray(overviewData.conclusions) ? overviewData.conclusions : [],
        suggestedQuestions: Array.isArray(overviewData.suggestedQuestions)
          ? overviewData.suggestedQuestions
          : [],
        coverageReport: finalCoverage,
      };

      setAnalysis(finalAnalysis);
      setLoadingProgress(100);
      setLoadingMessage('');

      const coverageSummaryNote = finalCoverage.hasFullCoverage
        ? `Cobertura verificada del 100% (${finalCoverage.coveredPages}/${finalCoverage.totalPages} páginas y ${finalCoverage.processedChapters}/${finalCoverage.detectedChapters} capítulos procesados).`
        : `Cobertura real verificada: ${finalCoverage.realCoveragePercent}% (${finalCoverage.coveredPages}/${finalCoverage.totalPages} páginas; ${finalCoverage.processedChapters}/${finalCoverage.detectedChapters} capítulos procesados${finalCoverage.unreadablePages.length > 0 ? `; ${finalCoverage.unreadablePages.length} páginas sin texto legible` : ''}).`;

      setChatMessages([
        {
          id: `welcome-${Date.now()}`,
          role: 'assistant',
          content: `He procesado "${finalTitle}" capítulo por capítulo. ${coverageSummaryNote} Puedes preguntarme sobre cualquier capítulo o página del libro, incluidas las páginas finales.`,
          groundingStatus: 'Basado en el libro completo',
          timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);

      // Phase 5: Generate balanced quiz covering ALL chapters of the book
      const balancedQuizContext = buildBalancedBookQuizContext(activePages, workingChapters);
      const quizRes = await fetch(apiUrl('/api/quiz'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentText: textToAnalyze,
          balancedContext: balancedQuizContext,
          fileName: finalTitle,
          questionCount: quizCount,
          difficulty: quizDifficulty,
          quizMode,
        }),
      }).catch(() => null);

      if (!isCancelled() && quizRes && quizRes.ok) {
        const quizData = await readApiJson<{ questions?: QuizQuestion[] }>(quizRes).catch(() => null);
        if (quizData && Array.isArray(quizData.questions)) {
          setQuestions(quizData.questions);
          setSelectedOptions({});
          setOpenAnswersDraft({});
          setOpenEvaluations({});
        }
      }
    } catch (err: unknown) {
      if (isCancelled()) return;
      setLoadingMessage('');
      setLoadingProgress(0);
      setErrorMessage(
        err instanceof Error ? err.message : 'Ocurrió un inconveniente al analizar el libro.'
      );
    }
  };

  // Handle file selection or drag & drop
  const handleFileProcess = async (file: File) => {
    setErrorMessage('');
    try {
      setLoadingMessage(`Abriendo "${file.name}"...`);
      setLoadingProgress(12);

      const extracted = await extractTextFromFile(file, (status, pct) => {
        setLoadingMessage(status);
        setLoadingProgress(Math.min(35, Math.round(pct * 0.35)));
      });

      const cleanTitle = file.name.replace(/\.[^/.]+$/, '');
      setFileName(cleanTitle);
      setPageCount(extracted.pageCount);
      setExtractedPages(extracted.pages);
      setPdfOutline(extracted.outline);
      setDocumentText(extracted.text);

      await runFullAiPipeline(extracted.text, cleanTitle, extracted.pages, extracted.outline);
    } catch (err: unknown) {
      setLoadingMessage('');
      setLoadingProgress(0);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'No se pudo leer el archivo. Verifica que sea un PDF o archivo de texto válido.'
      );
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileProcess(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileProcess(file);
    }
  };

  // Generate new dynamic quiz covering ALL chapters (no 120k truncation)
  const handleGenerateNewQuiz = async () => {
    if (!documentText || documentText.trim().length < 20) {
      setErrorMessage('Primero debes cargar un libro para generar preguntas.');
      return;
    }

    setErrorMessage('');
    setLoadingMessage(`Generando ${quizCount} nuevas preguntas (${quizDifficulty})...`);
    setLoadingProgress(50);

    try {
      const activePages =
        extractedPages.length > 0
          ? extractedPages
          : buildStructuredDocumentFromText(documentText).pages;
      const balancedContext = buildBalancedBookQuizContext(
        activePages,
        Array.isArray(analysis?.chapters) ? analysis.chapters : []
      );

      const res = await fetch(apiUrl('/api/quiz'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentText,
          balancedContext,
          fileName: analysis?.title || fileName,
          questionCount: quizCount,
          difficulty: quizDifficulty,
          quizMode,
        }),
      });
      const data = await readApiJson<{ questions?: QuizQuestion[]; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data.error || 'Error al generar el cuestionario.');
      }
      if (Array.isArray(data.questions)) {
        setQuestions(data.questions);
        setSelectedOptions({});
        setOpenAnswersDraft({});
        setOpenEvaluations({});
      }
      setLoadingMessage('');
      setLoadingProgress(0);
    } catch (err: unknown) {
      setLoadingMessage('');
      setLoadingProgress(0);
      setErrorMessage(
        err instanceof Error ? err.message : 'Error al generar nuevas preguntas.'
      );
    }
  };

  // Evaluate open-ended question using full-book retrieval (no 60k truncation)
  const handleEvaluateOpenQuestion = async (q: QuizQuestion) => {
    const userAnswer = openAnswersDraft[q.id]?.trim();
    if (!userAnswer) {
      setErrorMessage('Por favor escribe tu respuesta antes de evaluarla.');
      return;
    }

    setErrorMessage('');
    setEvaluatingQuestionId(q.id);

    try {
      const activePages =
        extractedPages.length > 0
          ? extractedPages
          : buildStructuredDocumentFromText(documentText).pages;
      const retrievedContext = retrieveRelevantPassages(
        activePages,
        Array.isArray(analysis?.chapters) ? analysis.chapters : [],
        `${q.question} ${q.explanation} ${q.referenceQuote} ${userAnswer}`,
        { maxChars: 35000, topK: 16 }
      );

      const res = await fetch(apiUrl('/api/evaluate-open'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentText,
          retrievedContext,
          question: q.question,
          userAnswer,
          rubricKeyPoints: q.rubricKeyPoints,
          explanation: q.explanation,
        }),
      });
      const data = await readApiJson<OpenEvaluationResult & { error?: string }>(res);
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo evaluar la respuesta.');
      }
      setOpenEvaluations((prev) => ({
        ...prev,
        [q.id]: data,
      }));
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Error al evaluar la respuesta.'
      );
    } finally {
      setEvaluatingQuestionId(null);
    }
  };

  // Submit Chat question with whole-book retrieval (supports any page including final pages)
  const handleSendChatQuestion = async (questionText?: string) => {
    const msg = (questionText ?? chatInput).trim();
    if (!msg || isChatLoading) return;

    if (!documentText || documentText.trim().length < 20) {
      setErrorMessage('Carga un libro antes de realizar consultas.');
      return;
    }

    setErrorMessage('');
    setChatInput('');

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: msg,
      timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
    };

    const updatedHistory = [...chatMessages, userMsg];
    setChatMessages(updatedHistory);
    setIsChatLoading(true);

    try {
      const activePages =
        extractedPages.length > 0
          ? extractedPages
          : buildStructuredDocumentFromText(documentText).pages;
      const activeChapters = Array.isArray(analysis?.chapters) ? analysis.chapters : [];
      const retrievedContext = retrieveRelevantPassages(activePages, activeChapters, msg, {
        maxChars: 42000,
        topK: 22,
      });
      const chapterDirectory = buildChapterDirectory(activeChapters);

      const res = await fetch(apiUrl('/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentText,
          retrievedContext,
          chapterDirectory,
          totalPages: activePages.length,
          fileName: analysis?.title || fileName,
          history: updatedHistory.map((m) => ({ role: m.role, content: m.content })),
          message: msg,
        }),
      });
      const data = await readApiJson<{
        answer?: string;
        citations?: string[];
        groundingStatus?: string;
        error?: string;
      }>(res);
      if (!res.ok) {
        throw new Error(data.error || 'Error en la consulta al asistente de lectura.');
      }

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.answer || 'No se encontró información sobre ese punto en el libro.',
        citations: Array.isArray(data.citations) ? data.citations : [],
        groundingStatus: data.groundingStatus || 'Basado en el libro activo',
        timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
      };

      setChatMessages((prev) => [...prev, assistantMsg]);
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 80);
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Error de conexión al consultar al asistente.'
      );
    } finally {
      setIsChatLoading(false);
    }
  };

  // Export Study Guide Report
  const handleExportMarkdown = () => {
    if (!analysis) return;
    const combinedAnswers: Record<string, number | string> = {
      ...selectedOptions,
      ...openAnswersDraft,
    };
    const md = generateMarkdownReport(analysis.title || fileName, analysis, questions, combinedAnswers);
    const cleanName = (analysis.title || fileName)
      .toLowerCase()
      .replace(/[^a-z0-9áéíóúñ]+/gi, '-')
      .replace(/^-|-$/g, '') || 'libro';
    downloadTextFile(md, `guia-lectura-${cleanName}.md`);
  };

  // Compute Quiz statistics
  const totalQuestions = questions.length;
  const answeredMcCount = questions.filter(
    (q) => q.type === 'multiple_choice' && selectedOptions[q.id] !== undefined
  ).length;
  const answeredOpenCount = questions.filter(
    (q) => q.type === 'open' && openEvaluations[q.id] !== undefined
  ).length;
  const totalAnswered = answeredMcCount + answeredOpenCount;

  const correctMcCount = questions.filter(
    (q) => q.type === 'multiple_choice' && selectedOptions[q.id] === q.correctIndex
  ).length;
  const correctOpenCount = questions.filter(
    (q) => q.type === 'open' && openEvaluations[q.id]?.isCorrect
  ).length;
  const totalCorrect = correctMcCount + correctOpenCount;
  const masteryPercent = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;

  // Safe arrays from analysis
  const keyPointsList = Array.isArray(analysis?.keyPoints) ? analysis.keyPoints : [];
  const keyMetricsList = Array.isArray(analysis?.keyMetrics) ? analysis.keyMetrics : [];
  const objectivesList = Array.isArray(analysis?.objectives) ? analysis.objectives : [];
  const conclusionsList = Array.isArray(analysis?.conclusions) ? analysis.conclusions : [];
  const chaptersList = Array.isArray(analysis?.chapters) ? analysis.chapters : [];
  const quotesList = Array.isArray(analysis?.quotes) ? analysis.quotes : [];
  const suggestedQuestionsList = Array.isArray(analysis?.suggestedQuestions)
    ? analysis.suggestedQuestions
    : [];

  // Chapter Exploration & Completion Progress Calculations
  const totalChaptersCount = chaptersList.length;
  const exploredChaptersCount = chaptersList.filter((_, idx) => Boolean(exploredChapters[idx])).length;
  const chapterProgressPercent =
    totalChaptersCount > 0 ? Math.round((exploredChaptersCount / totalChaptersCount) * 100) : 0;
  const nextPendingChapterIdx = chaptersList.findIndex((_, idx) => !exploredChapters[idx]);

  // Categories for filtering key points & visual distribution schema
  const uniqueCategories = Array.from(new Set(keyPointsList.map((kp) => kp.category)));
  const availableCategories = ['Todas', ...uniqueCategories];
  const filteredKeyPoints =
    categoryFilter === 'Todas'
      ? keyPointsList
      : keyPointsList.filter((kp) => kp.category === categoryFilter);

  const activeChapter = chaptersList[activeChapterIdx] || chaptersList[0];
  const coverageReport = analysis?.coverageReport;

  return (
    <div className="min-h-dvh flex flex-col bg-[#F8FAFC] dark:bg-[#0B1120] text-slate-900 dark:text-slate-100 overflow-x-clip pb-20 md:pb-0 transition-colors duration-200">
      {/* Hidden global file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.txt,.md"
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* =====================================================================
          TOP BAR CONTRACT (3 Zones: Brand Wordmark, 5 Nav Links, 1 Primary CTA)
          Extensible navigation architecture via PRIMARY_NAV_SECTIONS & UPCOMING_NAV_SLOTS
          ===================================================================== */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-950/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-3.5 sm:px-6 py-3 sm:py-3.5 flex items-center justify-between gap-4 lg:gap-8 no-print">
        {/* Zone 1: Single text element brand wordmark (Blue primary + Orange accent) */}
        <a
          href="#workspace"
          onClick={(e) => {
            e.preventDefault();
            handleNavigateTab('summary');
          }}
          className="text-base sm:text-lg font-extrabold tracking-tight text-blue-900 dark:text-white whitespace-nowrap shrink-0 font-display"
        >
          Lectura<span className="text-orange-600 dark:text-orange-400">Viva</span>
        </a>

        {/* Zone 2: Organized single-line text navigation links (Desktop lg+) */}
        <nav
          aria-label="Navegación principal"
          className="hidden lg:flex items-center gap-3.5 xl:gap-5 text-xs xl:text-sm font-medium text-slate-600 dark:text-slate-300"
        >
          {PRIMARY_NAV_SECTIONS.map((section) => {
            const isActive = activeTab === section.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => handleNavigateTab(section.id)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? 'text-blue-800 dark:text-white underline decoration-orange-500 decoration-2 underline-offset-8 font-semibold'
                    : 'hover:text-blue-800 dark:hover:text-white'
                }`}
              >
                <span className="hidden xl:inline">{section.label}</span>
                <span className="xl:hidden">{section.shortLabel}</span>
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-2 shrink-0">
          {hasLoadedBook ? (
            <button
              type="button"
              onClick={handleExportMarkdown}
              className="px-3.5 sm:px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 sm:gap-2 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-orange-300" />
              <span className="sm:hidden">Guía</span>
              <span className="hidden sm:inline">Descargar Guía</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setManualTitleDraft('');
                setManualTextDraft('');
                setShowManualTextModal(true);
              }}
              className="px-3.5 sm:px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span className="sm:hidden">Pegar Texto</span>
              <span className="hidden sm:inline">Pegar Texto de un Libro</span>
            </button>
          )}
        </div>
      </header>

      {/* Tablet Navigation Bar (md..lg) so tablet screens see all 5 sections cleanly on one scrollable line */}
      <nav
        aria-label="Navegación en tableta"
        className="hidden md:flex lg:hidden items-center gap-5 px-6 py-2.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 overflow-x-auto no-scrollbar text-xs font-medium text-slate-600 dark:text-slate-300 no-print"
      >
        {PRIMARY_NAV_SECTIONS.map((section) => {
          const isActive = activeTab === section.id;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => handleNavigateTab(section.id)}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isActive
                  ? 'text-blue-800 dark:text-white underline decoration-orange-500 decoration-2 underline-offset-8 font-semibold'
                  : 'hover:text-blue-800 dark:hover:text-white'
              }`}
            >
              {section.label}
            </button>
          );
        })}
      </nav>

      {/* =====================================================================
          MAIN WORKSPACE CONTAINER
          ===================================================================== */}
      {!hasLoadedBook ? (
        /* =====================================================================
           TAB-AWARE WORKSPACE BEFORE A BOOK IS LOADED
           All 5 sections ('summary' | 'explorer' | 'principles' | 'quiz' | 'chat')
           ===================================================================== */
        <main
          id="workspace"
          className="max-w-[1280px] w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 space-y-5 sm:space-y-7 flex-1"
        >
          {/* Reading Personalization Strip (6 Fonts + A-/A+ + Dark Mode) */}
          <ReadingControlsStrip
            preferences={readingPrefs}
            onChange={setReadingPrefs}
            onOpenFontModal={() => setShowReadingSettings(true)}
          />

          {activeTab === 'summary' && (
            <>
              {/* Hero Split: Editorial Illustration + Single Book Dropzone */}
              <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
                {/* Left Column: Visual Emblem, Editorial Headline & Single Upload Zone */}
                <div className="lg:col-span-7 p-4 sm:p-10 flex flex-col justify-between space-y-5 sm:space-y-6">
                  <div className="space-y-3 sm:space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-blue-700 dark:bg-blue-600 text-orange-300 flex items-center justify-center shrink-0">
                        <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                          <path d="M2 6.5C2 5.4 2.9 4.5 4 4.5H10C11.1 4.5 12 5.4 12 6.5V19.5C12 18.4 11.1 17.5 10 17.5H4C2.9 17.5 2 18.4 2 19.5V6.5Z" />
                          <path d="M22 6.5C22 5.4 21.1 4.5 20 4.5H14C12.9 4.5 12 5.4 12 6.5V19.5C12 18.4 12.9 17.5 14 17.5H20C21.1 17.5 22 18.4 22 19.5V6.5Z" />
                          <circle cx="12" cy="9" r="1.5" fill="currentColor" />
                        </svg>
                      </div>
                      <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 leading-snug">
                        <span>Lectura Profunda y Personalizada</span>
                        <span aria-hidden="true"> · </span>
                        <span>Cobertura Verificable Capítulo a Capítulo</span>
                      </div>
                    </div>

                    <h1 className="text-xl sm:text-4xl font-bold text-slate-900 dark:text-white tracking-tight leading-tight">
                      Domina cada libro con mapas claros, capítulos profundos y lectura a tu medida
                    </h1>

                    <p className="reading-content text-slate-600 dark:text-slate-300 max-w-2xl">
                      Sube tu libro en PDF o texto para obtener un estudio integral capítulo por capítulo: síntesis global, principios y cifras clave, casos reales, evaluaciones y diálogo contextual con tu tipografía y modo visual preferido.
                    </p>
                  </div>

                  {/* THE SINGLE UNIFIED DROPZONE */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => {
                      if (!loadingMessage) {
                        fileInputRef.current?.click();
                      }
                    }}
                    className={`border-2 border-dashed rounded-xl p-5 sm:p-8 text-center transition-colors ${
                      loadingMessage
                        ? 'border-orange-400 dark:border-orange-500 bg-orange-50/60 dark:bg-orange-950/25 cursor-wait'
                        : isDragging
                        ? 'border-orange-500 bg-orange-50/70 dark:bg-orange-950/35 cursor-pointer'
                        : 'border-slate-300 dark:border-slate-700 hover:border-blue-600 dark:hover:border-blue-400 bg-slate-50 dark:bg-slate-800/50 hover:bg-blue-50/40 dark:hover:bg-blue-950/25 cursor-pointer'
                    }`}
                  >
                    {loadingMessage ? (
                      <div role="status" aria-live="polite" className="max-w-md mx-auto space-y-3">
                        <RefreshCw className="w-7 h-7 text-orange-600 dark:text-orange-400 animate-spin mx-auto" />
                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{loadingMessage}</div>
                        {fileName && (
                          <div className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums break-words">
                            {fileName} {pageCount > 0 ? `· ${pageCount} páginas procesadas` : ''}
                          </div>
                        )}
                        <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-orange-500 transition-transform duration-200 origin-left"
                            style={{ transform: `scaleX(${Math.max(0.12, loadingProgress / 100)})` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 flex items-center justify-center mx-auto">
                          <FileUp className="w-6 h-6" />
                        </div>
                        <p className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                          Selecciona o arrastra aquí tu libro (PDF o TXT)
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Análisis progresivo de todos los capítulos, conceptos clave, historias y lecciones prácticas
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Error Alert */}
                  {errorMessage && (
                    <div
                      role="alert"
                      className="p-3.5 sm:p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex flex-col sm:flex-row sm:items-start gap-3 text-xs text-rose-950 dark:text-rose-200"
                    >
                      <div className="flex items-start gap-2.5 flex-1">
                        <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                        <div className="flex-1 space-y-1 min-w-0">
                          <p className="font-semibold">Atención</p>
                          <p className="leading-relaxed break-words">{errorMessage}</p>
                        </div>
                      </div>
                      {documentText.trim().length >= 20 && (
                        <button
                          type="button"
                          onClick={() => runFullAiPipeline(documentText, fileName || 'Libro')}
                          className="px-3 py-2 bg-rose-700 hover:bg-rose-800 text-white font-semibold rounded-md cursor-pointer whitespace-nowrap self-start"
                        >
                          Reintentar
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Right Column: Editorial Illustration Showcase */}
                <div className="lg:col-span-5 relative bg-blue-950 min-h-[210px] sm:min-h-[280px] flex flex-col justify-end overflow-hidden">
                  <img
                    src={HERO_ILLUSTRATION}
                    alt="Ilustración editorial de un estudio de lectura con esquemas geométricos emergiendo de un libro abierto"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover opacity-85"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-blue-950/95 via-blue-950/35 to-transparent" />
                  <div className="relative p-4 sm:p-8 text-white space-y-1.5 sm:space-y-2">
                    <div className="text-xs text-orange-300 font-semibold">
                      Cobertura Integral Verificable
                    </div>
                    <p className="text-xs sm:text-sm text-slate-100 leading-relaxed">
                      Cada capítulo se desglosa en tesis central, desarrollo argumental completo, conceptos definidos, casos reales y preguntas de aplicación.
                    </p>
                  </div>
                </div>
              </section>

              {/* Visual Progress Bar Panel in 'Mapa y Resumen' (Ready State) */}
              <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-7 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0">
                      <BookMarked className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-orange-600 dark:text-orange-400">
                        Seguimiento de Avance en Mapa y Resumen
                      </div>
                      <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                        Barra de Progreso de Capítulos Explorados
                      </h2>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 pt-1 sm:pt-0">
                    <div className="sm:text-right">
                      <span className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-blue-900 dark:text-blue-300">
                        0%
                      </span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        Esperando carga de libro
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleNavigateTab('explorer')}
                      className="px-3.5 py-2 bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <span>Ver Capítulos</span>
                      <ArrowRight className="w-3.5 h-3.5 text-orange-300" />
                    </button>
                  </div>
                </div>

                <div className="w-full h-3 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-orange-500 rounded-full w-0 transition-all duration-300" />
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Al subir cualquier libro, esta barra registrará automáticamente cada capítulo que explores o marques como completado junto con el porcentaje de cobertura real verificada de la obra.
                </p>
              </section>

              {/* Interactive Section Cards with Direct Navigation */}
              <section className="space-y-4 sm:space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-1.5">
                  <div>
                    <div className="text-xs font-medium text-orange-600 dark:text-orange-400 mb-1">
                      Navegación por las Secciones de Estudio
                    </div>
                    <h2 className="text-lg sm:text-2xl font-bold text-slate-900 dark:text-white">
                      Explora las herramientas de LecturaViva
                    </h2>
                  </div>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Toca cualquier tarjeta para abrir su sección
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
                  {/* Card 1 -> Ruta de Capítulos */}
                  <div
                    onClick={() => handleNavigateTab('explorer')}
                    className="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-600 dark:hover:border-blue-400 rounded-2xl overflow-hidden flex flex-col transition-all cursor-pointer"
                  >
                    <div className="aspect-16/10 bg-slate-100 dark:bg-slate-800 overflow-hidden border-b border-slate-200 dark:border-slate-800">
                      <img
                        src={COMPASS_ILLUSTRATION}
                        alt="Brújula literaria y mapa de ruta por capítulos"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                    <div className="p-4 sm:p-5 space-y-2.5 flex-1 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="text-xs font-mono font-semibold text-orange-600 dark:text-orange-400">
                          01 · Estudio Capítulo a Capítulo
                        </div>
                        <h3 className="text-base font-bold text-slate-900 dark:text-white group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors">
                          Ruta de Capítulos
                        </h3>
                        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                          Desarrollo extenso de varios párrafos, glosario de conceptos clave, casos narrados, cita destacada y adaptación al mundo actual.
                        </p>
                      </div>
                      <div className="pt-2 flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 group-hover:text-orange-600 dark:group-hover:text-orange-400">
                        <span>Ir a Ruta de Capítulos</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </div>

                  {/* Card 2 -> Principios y Cifras Clave */}
                  <div
                    onClick={() => handleNavigateTab('principles')}
                    className="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-600 dark:hover:border-blue-400 rounded-2xl overflow-hidden flex flex-col transition-all cursor-pointer"
                  >
                    <div className="aspect-16/10 bg-gradient-to-br from-blue-900 via-blue-800 to-slate-900 p-5 flex flex-col justify-between border-b border-slate-200 dark:border-slate-800">
                      <div className="w-9 h-9 rounded-lg bg-white/10 text-orange-300 flex items-center justify-center">
                        <BarChart3 className="w-5 h-5" />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="h-2 rounded-full bg-orange-400/90" />
                        <div className="h-2 rounded-full bg-blue-300/70" />
                        <div className="h-2 rounded-full bg-white/30" />
                      </div>
                    </div>
                    <div className="p-4 sm:p-5 space-y-2.5 flex-1 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="text-xs font-mono font-semibold text-orange-600 dark:text-orange-400">
                          02 · Leyes y Métricas
                        </div>
                        <h3 className="text-base font-bold text-slate-900 dark:text-white group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors">
                          Principios y Cifras Clave
                        </h3>
                        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                          Indicadores fundamentales, leyes formuladas por el autor, objetivos centrales e ideas organizadas por eje temático.
                        </p>
                      </div>
                      <div className="pt-2 flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 group-hover:text-orange-600 dark:group-hover:text-orange-400">
                        <span>Ir a Principios y Cifras</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </div>

                  {/* Card 3 -> Evaluación Interactiva */}
                  <div
                    onClick={() => handleNavigateTab('quiz')}
                    className="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-600 dark:hover:border-blue-400 rounded-2xl overflow-hidden flex flex-col transition-all cursor-pointer"
                  >
                    <div className="aspect-16/10 bg-slate-100 dark:bg-slate-800 overflow-hidden border-b border-slate-200 dark:border-slate-800">
                      <img
                        src={QUIZ_ILLUSTRATION}
                        alt="Ilustración de cuaderno de evaluación y dominio de lectura"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                    <div className="p-4 sm:p-5 space-y-2.5 flex-1 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="text-xs font-mono font-semibold text-orange-600 dark:text-orange-400">
                          03 · Comprobación de Dominio
                        </div>
                        <h3 className="text-base font-bold text-slate-900 dark:text-white group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors">
                          Evaluación Interactiva
                        </h3>
                        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                          Preguntas de opción múltiple y preguntas abiertas calificadas al instante con cobertura balanceada de toda la obra.
                        </p>
                      </div>
                      <div className="pt-2 flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 group-hover:text-orange-600 dark:group-hover:text-orange-400">
                        <span>Ir a Evaluación Interactiva</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </div>

                  {/* Card 4 -> Dialogar con el Libro */}
                  <div
                    onClick={() => handleNavigateTab('chat')}
                    className="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-600 dark:hover:border-blue-400 rounded-2xl overflow-hidden flex flex-col transition-all cursor-pointer"
                  >
                    <div className="aspect-16/10 bg-slate-100 dark:bg-slate-800 overflow-hidden border-b border-slate-200 dark:border-slate-800">
                      <img
                        src={SYNTHESIS_ILLUSTRATION}
                        alt="Esquema ilustrado de árbol de conocimiento e ideas conectadas"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                    <div className="p-4 sm:p-5 space-y-2.5 flex-1 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="text-xs font-mono font-semibold text-orange-600 dark:text-orange-400">
                          04 · Consultas con Citas
                        </div>
                        <h3 className="text-base font-bold text-slate-900 dark:text-white group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors">
                          Dialogar con el Libro
                        </h3>
                        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                          Conversa directamente con el contenido completo de la obra, desde la introducción hasta las últimas páginas.
                        </p>
                      </div>
                      <div className="pt-2 flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 group-hover:text-orange-600 dark:group-hover:text-orange-400">
                        <span>Ir a Dialogar con el Libro</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Quiet Roadmap Note reflecting any remaining reserved navigation slots */}
                {UPCOMING_NAV_SLOTS.length > 0 && (
                  <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-2 pt-1">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      Próximos módulos integrables en el menú:
                    </span>
                    {UPCOMING_NAV_SLOTS.map((slot, idx) => (
                      <React.Fragment key={slot.id}>
                        {idx > 0 && <span aria-hidden="true">·</span>}
                        <span>{slot.label}</span>
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {activeTab === 'explorer' && (
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-10 space-y-6 sm:space-y-8">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 sm:pb-6 border-b border-slate-200 dark:border-slate-800">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-orange-600 dark:text-orange-400">
                    Ruta de Capítulos · Desglose Integral Verificable
                  </div>
                  <h1 className="text-xl sm:text-3xl font-bold text-slate-900 dark:text-white">
                    Desglose Profundo Capítulo por Capítulo
                  </h1>
                  <p className="reading-content-sm text-slate-600 dark:text-slate-300 max-w-2xl">
                    Cuando subas tu libro en PDF o texto, aquí podrás navegar por cada uno de sus capítulos con las 6 capas de profundidad editorial.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto shrink-0">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 sm:flex-none justify-center px-4 py-2.5 bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <FileUp className="w-4 h-4 text-orange-300" />
                    <span>Seleccionar Libro</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNavigateTab('summary')}
                    className="flex-1 sm:flex-none justify-center px-3.5 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Volver al Inicio
                  </button>
                </div>
              </div>

              {/* Preview of the 6 Deep Chapter Layers */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  {
                    n: 'CAPA 01',
                    t: 'Subtítulo y Tesis Central',
                    d: 'Síntesis clara de la premisa rectora y el argumento principal que sostiene el autor en el capítulo.',
                  },
                  {
                    n: 'CAPA 02',
                    t: 'Análisis Exhaustivo (Múltiples Párrafos)',
                    d: 'Desarrollo riguroso de 2 a 4 párrafos con los mecanismos, metodologías, contrastes y explicaciones completas del capítulo.',
                  },
                  {
                    n: 'CAPA 03',
                    t: 'Casos de Estudio e Historias Reales',
                    d: 'Relato detallado de los experimentos, ejemplos históricos, empresas o anécdotas empleadas por el autor.',
                  },
                  {
                    n: 'CAPA 04',
                    t: 'Glosario de Conceptos del Capítulo',
                    d: 'De 3 a 5 términos, marcos teóricos o leyes introducidas en el capítulo con su definición exacta.',
                  },
                  {
                    n: 'CAPA 05',
                    t: 'Cita Destacada y Reglas de Acción',
                    d: 'Pasaje memorable del capítulo acompañado de 4 a 6 pasos accionables para llevar la teoría a la práctica.',
                  },
                  {
                    n: 'CAPA 06',
                    t: 'Adaptación al Mundo Actual (Negocios y Liderazgo)',
                    d: 'Módulo interactivo que traduce cada capítulo a un caso real de empresa, liderazgo, startups, ventas o toma de decisiones hoy.',
                  },
                ].map((layer) => (
                  <div
                    key={layer.n}
                    className="p-5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 space-y-2"
                  >
                    <div className="text-xs font-mono font-bold text-orange-600 dark:text-orange-400">
                      {layer.n}
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">{layer.t}</h3>
                    <p className="reading-content-sm text-slate-600 dark:text-slate-300">
                      {layer.d}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeTab === 'principles' && (
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-10 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 sm:pb-6 border-b border-slate-200 dark:border-slate-800">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-orange-600 dark:text-orange-400">
                    Síntesis Analítica de Leyes, Datos y Pilares
                  </div>
                  <h1 className="text-xl sm:text-3xl font-bold text-slate-900 dark:text-white">
                    Principios y Cifras Clave
                  </h1>
                  <p className="reading-content-sm text-slate-600 dark:text-slate-300 max-w-2xl">
                    Al cargar tu libro, esta sección reunirá automáticamente sus indicadores numéricos, reglas fundamentales, propósitos centrales e ideas clasificadas por eje temático.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto shrink-0">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 sm:flex-none justify-center px-4 py-2.5 bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <FileUp className="w-4 h-4 text-orange-300" />
                    <span>Seleccionar Libro</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNavigateTab('summary')}
                    className="flex-1 sm:flex-none justify-center px-3.5 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Volver al Inicio
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 space-y-2">
                  <div className="text-xs font-mono font-bold text-orange-600 dark:text-orange-400">
                    01 · MÉTRICAS Y LEYES
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Cifras y Reglas Verificables
                  </h3>
                  <p className="reading-content-sm text-slate-600 dark:text-slate-300">
                    Resumen tabular de proporciones, leyes, horizontes temporales y resultados empíricos citados en la obra.
                  </p>
                </div>
                <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 space-y-2">
                  <div className="text-xs font-mono font-bold text-orange-600 dark:text-orange-400">
                    02 · PILARES RECTORES
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Propósitos e Ideas Clave
                  </h3>
                  <p className="reading-content-sm text-slate-600 dark:text-slate-300">
                    Filtros por eje temático para concentrarte en los principios estratégicos, metodológicos o prácticos del autor.
                  </p>
                </div>
                <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 space-y-2">
                  <div className="text-xs font-mono font-bold text-orange-600 dark:text-orange-400">
                    03 · RESPALDO TEXTUAL
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Citas y Conclusiones Accionables
                  </h3>
                  <p className="reading-content-sm text-slate-600 dark:text-slate-300">
                    Pasajes memorables y síntesis prácticas listas para repasar antes de una reunión, examen o decisión clave.
                  </p>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'quiz' && (
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-10 space-y-5 sm:space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 sm:pb-6 border-b border-slate-200 dark:border-slate-800">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-orange-600 dark:text-orange-400">
                    Comprobación de Lectura
                  </div>
                  <h1 className="text-xl sm:text-3xl font-bold text-slate-900 dark:text-white">
                    Evaluación Interactiva del Libro
                  </h1>
                  <p className="reading-content-sm text-slate-600 dark:text-slate-300 max-w-2xl">
                    Configura la dificultad, el formato y la cantidad de preguntas. Sube un libro para generar tu cuestionario personalizado al instante.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto shrink-0">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 sm:flex-none justify-center px-4 py-2.5 bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <FileUp className="w-4 h-4 text-orange-300" />
                    <span>Subir Libro</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNavigateTab('summary')}
                    className="flex-1 sm:flex-none justify-center px-3.5 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Volver al Inicio
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 sm:gap-4 p-4 sm:p-5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-600 dark:text-slate-300 font-semibold">Dificultad:</span>
                  <div className="flex items-center gap-1 p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg">
                    {(['Básico', 'Intermedio', 'Avanzado'] as const).map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setQuizDifficulty(level)}
                        className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                          quizDifficulty === level
                            ? 'bg-blue-700 text-white'
                            : 'text-slate-600 dark:text-slate-300 hover:text-blue-800 dark:hover:text-blue-300'
                        }`}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-600 dark:text-slate-300 font-semibold">Formato:</span>
                  <select
                    value={quizMode}
                    onChange={(e) =>
                      setQuizMode(e.target.value as 'mixed' | 'multiple_choice' | 'open')
                    }
                    className="px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 font-medium focus:outline-none focus:border-orange-500"
                  >
                    <option value="mixed">Mixto (Múltiple + Abierta)</option>
                    <option value="multiple_choice">Solo Opción Múltiple</option>
                    <option value="open">Solo Respuesta Abierta</option>
                  </select>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-600 dark:text-slate-300 font-semibold">Cantidad:</span>
                  <select
                    value={quizCount}
                    onChange={(e) => setQuizCount(Number(e.target.value))}
                    className="px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 font-mono tabular-nums focus:outline-none focus:border-orange-500"
                  >
                    <option value={5}>5 preguntas</option>
                    <option value={6}>6 preguntas</option>
                    <option value={8}>8 preguntas</option>
                  </select>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'chat' && (
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-10 space-y-5 sm:space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 sm:pb-6 border-b border-slate-200 dark:border-slate-800">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-orange-600 dark:text-orange-400">
                    Asistente Contextual fundamentado en el Libro
                  </div>
                  <h1 className="text-xl sm:text-3xl font-bold text-slate-900 dark:text-white">
                    Dialogar con el Libro
                  </h1>
                  <p className="reading-content-sm text-slate-600 dark:text-slate-300 max-w-2xl">
                    Realiza preguntas abiertas sobre cualquier capítulo, concepto o caso de estudio. El asistente responde citando pasajes de toda la obra cargada.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto shrink-0">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 sm:flex-none justify-center px-4 py-2.5 bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <FileUp className="w-4 h-4 text-orange-300" />
                    <span>Subir Libro</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNavigateTab('summary')}
                    className="flex-1 sm:flex-none justify-center px-3.5 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Volver al Inicio
                  </button>
                </div>
              </div>

              <div className="p-6 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="text-xs font-semibold text-slate-900 dark:text-white">
                  Ejemplos de consultas que podrás realizar al cargar tu libro:
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-700 dark:text-slate-300">
                  <div className="p-3.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 reading-content-sm">
                    “¿Cuáles son los argumentos principales y casos reales del Capítulo 1?”
                  </div>
                  <div className="p-3.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 reading-content-sm">
                    “¿Qué conclusiones clave presenta el autor en las últimas páginas del libro?”
                  </div>
                </div>
              </div>
            </section>
          )}
        </main>
      ) : (
        /* =====================================================================
           POPULATED 2-COLUMN VISUAL WORKSPACE (When a book is loaded)
           ===================================================================== */
        <main
          id="workspace"
          className="max-w-[1400px] w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-8 flex-1"
        >
          {/* Compact Mobile Active Book Strip so phone users immediately see active tab content first */}
          <div className="lg:hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 flex items-center justify-between gap-3 no-print">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium text-orange-600 dark:text-orange-400 flex items-center gap-1.5">
                <span>Obra activa</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono font-bold tabular-nums">{chapterProgressPercent}% avance</span>
              </div>
              <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                {analysis?.title || fileName}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Cambiar libro"
                className="p-2 rounded-lg bg-blue-700 dark:bg-blue-600 text-white hover:bg-blue-800 dark:hover:bg-blue-500 transition-colors cursor-pointer"
              >
                <FileUp className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleClearBook}
                aria-label="Cerrar libro"
                className="p-2 rounded-lg bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/70 hover:bg-rose-100 dark:hover:bg-rose-900/60 transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* LEFT COLUMN (Desktop) / BOTTOM INFO (Mobile): Active Book Card, Visual Stats & Key Principles */}
          <aside className="order-2 lg:order-1 lg:col-span-4 space-y-4 sm:space-y-6 no-print min-w-0">
            {/* Active Book Card with Visual Header Banner */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
              <div className="h-24 sm:h-28 relative bg-blue-950 overflow-hidden">
                <img
                  src={HERO_ILLUSTRATION}
                  alt="Portada ilustrada del estudio de lectura"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover opacity-75"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-blue-950/55 to-transparent" />
                <div className="absolute bottom-3 left-4 right-4 sm:left-5 sm:right-5 flex items-center justify-between text-xs text-orange-300 font-medium">
                  <span>Obra en Estudio</span>
                  {pageCount > 0 && (
                    <span className="font-mono tabular-nums">
                      {pageCount} {pageCount === 1 ? 'página' : 'páginas'}
                    </span>
                  )}
                </div>
              </div>

              <div className="p-4 sm:p-6 space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white leading-snug">
                    {analysis?.title || fileName}
                  </h2>
                  {analysis?.authorOrSource && (
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                      Autor / Fuente:{' '}
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {analysis.authorOrSource}
                      </span>
                    </p>
                  )}
                </div>

                {/* Sidebar Mini Progress Indicator */}
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      Avance de Capítulos
                    </span>
                    <span className="font-mono font-bold text-orange-600 dark:text-orange-400 tabular-nums">
                      {exploredChaptersCount}/{totalChaptersCount} ({chapterProgressPercent}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        chapterProgressPercent === 100
                          ? 'bg-emerald-600 dark:bg-emerald-500'
                          : 'bg-orange-500 dark:bg-orange-400'
                      }`}
                      style={{ width: `${chapterProgressPercent}%` }}
                    />
                  </div>
                </div>

                {/* Verified Coverage Report Box (Never claims 100% if pages/chapters are pending or unreadable) */}
                {coverageReport && (
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        Cobertura Verificada
                      </span>
                      <span
                        className={`font-mono font-bold tabular-nums ${
                          coverageReport.hasFullCoverage
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-orange-600 dark:text-orange-400'
                        }`}
                      >
                        {coverageReport.realCoveragePercent}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          coverageReport.hasFullCoverage
                            ? 'bg-emerald-600 dark:bg-emerald-500'
                            : 'bg-orange-500 dark:bg-orange-400'
                        }`}
                        style={{ width: `${coverageReport.realCoveragePercent}%` }}
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-600 dark:text-slate-400 font-mono tabular-nums">
                      <span>
                        {coverageReport.processedChapters}/{coverageReport.detectedChapters} caps
                      </span>
                      <span>
                        {coverageReport.coveredPages}/{coverageReport.totalPages} págs
                      </span>
                    </div>
                    {coverageReport.unreadablePages.length > 0 && (
                      <p className="text-[11px] text-orange-800 dark:text-orange-300 leading-snug">
                        {coverageReport.unreadablePages.length} pág. sin texto legible (escaneada o vacía).
                      </p>
                    )}
                    {(coverageReport.pendingChapters > 0 || coverageReport.failedChapters > 0) && (
                      <p className="text-[11px] text-rose-700 dark:text-rose-300 leading-snug">
                        {coverageReport.pendingChapters > 0
                          ? `${coverageReport.pendingChapters} cap. pendiente(s). `
                          : ''}
                        {coverageReport.failedChapters > 0
                          ? `${coverageReport.failedChapters} cap. con error (reintentable).`
                          : ''}
                      </p>
                    )}
                  </div>
                )}

                {/* Mini Structural Summary Schema */}
                <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/60">
                    <div className="text-base font-bold text-blue-700 dark:text-blue-400 font-mono tabular-nums">
                      {chaptersList.length}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Capítulos</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/60">
                    <div className="text-base font-bold text-orange-600 dark:text-orange-400 font-mono tabular-nums">
                      {keyPointsList.length}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Ideas Clave</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/60">
                    <div className="text-base font-bold text-emerald-700 dark:text-emerald-400 font-mono tabular-nums">
                      {quotesList.length}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Citas</div>
                  </div>
                </div>

                {/* Loading Indicator */}
                {loadingMessage && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="p-3.5 rounded-xl bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800/70 space-y-2"
                  >
                    <div className="flex items-center gap-2.5 text-xs font-medium text-orange-950 dark:text-orange-200">
                      <RefreshCw className="w-4 h-4 text-orange-600 dark:text-orange-400 animate-spin shrink-0" />
                      <span>{loadingMessage}</span>
                    </div>
                    {loadingProgress > 0 && (
                      <div className="w-full h-1.5 bg-orange-200/80 dark:bg-orange-900/70 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-orange-500 dark:bg-orange-400 transition-all duration-300"
                          style={{ width: `${Math.min(100, loadingProgress)}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Error Alert */}
                {errorMessage && (
                  <div
                    role="alert"
                    className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 flex items-start gap-2.5 text-xs text-rose-900 dark:text-rose-200"
                  >
                    <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-1">
                      <p className="font-semibold">Atención</p>
                      <p className="leading-relaxed">{errorMessage}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setErrorMessage('')}
                      className="text-rose-700 dark:text-rose-300 hover:text-rose-950 dark:hover:text-white font-medium cursor-pointer"
                    >
                      Cerrar
                    </button>
                  </div>
                )}

                <div className="pt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="py-2 px-3 bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <FileUp className="w-3.5 h-3.5 text-orange-300" />
                    <span>Cambiar Libro</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="py-2 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Imprimir Guía</span>
                  </button>
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
                  <button
                    type="button"
                    disabled={Boolean(loadingMessage)}
                    onClick={() =>
                      runFullAiPipeline(
                        documentText,
                        analysis?.title || fileName,
                        extractedPages.length > 0 ? extractedPages : undefined,
                        pdfOutline.length > 0 ? pdfOutline : undefined
                      )
                    }
                    className="text-slate-600 dark:text-slate-400 hover:text-blue-700 dark:hover:text-blue-300 underline underline-offset-4 cursor-pointer disabled:opacity-50"
                  >
                    Re-analizar obra
                  </button>
                  <button
                    type="button"
                    onClick={handleClearBook}
                    className="text-rose-700 dark:text-rose-400 hover:text-rose-900 dark:hover:text-rose-300 font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Cerrar libro</span>
                  </button>
                </div>
              </div>
            </section>

            {/* Key Principles & Figures Compact Sidebar Preview */}
            {keyMetricsList.length > 0 && (
              <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
                <div className="flex items-center justify-between mb-4 gap-2">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    Principios y Cifras Clave
                  </h2>
                  <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                    {keyMetricsList.length} indicadores
                  </span>
                </div>

                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {keyMetricsList.slice(0, 4).map((metric) => (
                    <div key={metric.label} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                          {metric.label}
                        </span>
                        <span className="text-sm font-bold text-orange-600 dark:text-orange-400 font-mono tabular-nums">
                          {metric.value}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed reading-content-sm">
                        {metric.context}
                      </p>
                    </div>
                  ))}
                </div>

                {activeTab !== 'principles' && (
                  <button
                    type="button"
                    onClick={() => handleNavigateTab('principles')}
                    className="mt-4 w-full py-2 px-3 rounded-lg bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-950 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800/70 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>Ver sección completa</span>
                    <ArrowRight className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
                  </button>
                )}
              </section>
            )}
          </aside>

          {/* RIGHT COLUMN (Desktop) / TOP CONTENT (Mobile): Main Interactive Book Views */}
          <section className="order-1 lg:order-2 lg:col-span-8 space-y-4 sm:space-y-6 min-w-0">
            {/* Compact Inline Reading Personalization Strip (Font Previewer, A-/A+, Claro/Oscuro) */}
            <ReadingControlsStrip
              preferences={readingPrefs}
              onChange={setReadingPrefs}
              onOpenFontModal={() => setShowReadingSettings(true)}
            />

            {/* =================================================================
                VIEW 1: MAPA CONCEPTUAL, BARRA DE PROGRESO Y RESUMEN DEL LIBRO
                ================================================================= */}
            {activeTab === 'summary' && analysis && (
              <div className="space-y-4 sm:space-y-6">
                {/* =============================================================
                    VISUAL PROGRESS BAR OF EXPLORED / COMPLETED CHAPTERS
                    ============================================================= */}
                {chaptersList.length > 0 && (
                  <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-7 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0">
                          <BookMarked className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="text-xs font-medium text-orange-600 dark:text-orange-400">
                            Progreso de Exploración del Libro
                          </div>
                          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                            {exploredChaptersCount} de {totalChaptersCount} capítulos explorados
                          </h2>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 pt-1 sm:pt-0">
                        <div className="sm:text-right">
                          <span className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                            {chapterProgressPercent}%
                          </span>
                          <span className="block text-xs text-slate-500 dark:text-slate-400">
                            {chapterProgressPercent === 100
                              ? '¡Obra completada!'
                              : 'de avance en la obra'}
                          </span>
                        </div>
                        {nextPendingChapterIdx !== -1 ? (
                          <button
                            type="button"
                            onClick={() => handleSelectAndExploreChapter(nextPendingChapterIdx, true)}
                            className="px-3.5 py-2 bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            <span>Ir al Cap. {chaptersList[nextPendingChapterIdx].n}</span>
                            <ArrowRight className="w-3.5 h-3.5 text-orange-300" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setExploredChapters({})}
                            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            Reiniciar progreso
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Visual Progress Bar Track */}
                    <div className="w-full h-3 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 rounded-full ${
                          chapterProgressPercent === 100
                            ? 'bg-emerald-600 dark:bg-emerald-500'
                            : 'bg-orange-500 dark:bg-orange-400'
                        }`}
                        style={{ width: `${chapterProgressPercent}%` }}
                      />
                    </div>

                    {/* Interactive Chapter Checkpoints */}
                    <div className="pt-1 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {chaptersList.map((cap, idx) => {
                          const isDone = Boolean(exploredChapters[idx]);
                          return (
                            <button
                              key={`${cap.n}-${idx}`}
                              type="button"
                              onClick={() => handleSelectAndExploreChapter(idx, true)}
                              title={`Capítulo ${cap.n}: ${cap.titulo}`}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                                isDone
                                  ? 'bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200'
                                  : 'bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-500 dark:hover:border-blue-400 hover:text-blue-800 dark:hover:text-blue-200'
                              }`}
                            >
                              {isDone && (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                              )}
                              <span>Cap. {cap.n}</span>
                            </button>
                          );
                        })}
                      </div>

                      {exploredChaptersCount < totalChaptersCount && (
                        <button
                          type="button"
                          onClick={() => {
                            const all: Record<number, boolean> = {};
                            chaptersList.forEach((_, idx) => {
                              all[idx] = true;
                            });
                            setExploredChapters(all);
                          }}
                          className="text-xs text-slate-500 dark:text-slate-400 hover:text-blue-700 dark:hover:text-blue-300 underline underline-offset-4 cursor-pointer whitespace-nowrap"
                        >
                          Marcar todos como leídos
                        </button>
                      )}
                    </div>
                  </section>
                )}

                {/* Book Synopsis Card */}
                <article className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-8">
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs text-orange-600 dark:text-orange-400 font-medium mb-2.5 sm:mb-3">
                    <span>
                      {coverageReport
                        ? coverageReport.hasFullCoverage
                          ? 'Síntesis Ejecutiva Integral (100% cobertura verificada)'
                          : `Síntesis Ejecutiva (${coverageReport.realCoveragePercent}% cobertura verificada · ${coverageReport.processedChapters}/${coverageReport.detectedChapters} capítulos)`
                        : 'Síntesis Ejecutiva de la Obra'}
                    </span>
                    {analysis.authorOrSource && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{analysis.authorOrSource}</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {coverageReport
                        ? `${coverageReport.coveredPages}/${coverageReport.totalPages} páginas`
                        : `${chaptersList.length} capítulos`}
                    </span>
                  </div>

                  {coverageReport && coverageReport.warnings.length > 0 && (
                    <div className="mb-4 p-3 rounded-xl bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800/70 text-xs text-orange-950 dark:text-orange-200 space-y-1">
                      <div className="font-semibold flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400 shrink-0" />
                        <span>Aviso de cobertura real ({coverageReport.realCoveragePercent}%):</span>
                      </div>
                      <ul className="list-disc pl-5 space-y-0.5 text-orange-900 dark:text-orange-200/90">
                        {coverageReport.warnings.map((w, wIdx) => (
                          <li key={wIdx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <h1 className="reading-title text-xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight mb-3.5 sm:mb-4">
                    {analysis.title}
                  </h1>

                  <div className="space-y-3 text-slate-700 dark:text-slate-300 reading-content-lg">
                    {(analysis.executiveSummary || '').split('\n\n').map((paragraph, index) => (
                      <p key={index}>{paragraph}</p>
                    ))}
                  </div>

                  {/* Quick Action Bar */}
                  <div className="mt-5 sm:mt-6 pt-4 sm:pt-5 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 no-print">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Explora el estudio exhaustivo de cada capítulo, consulta principios clave o conversa con el libro.
                    </div>
                    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                      <button
                        type="button"
                        onClick={() => handleSelectAndExploreChapter(activeChapterIdx, true)}
                        className="flex-1 sm:flex-none justify-center px-3 py-2 text-xs font-semibold text-orange-900 dark:text-orange-200 bg-orange-50 dark:bg-orange-950/50 hover:bg-orange-100 dark:hover:bg-orange-950 border border-orange-200 dark:border-orange-800/70 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <Compass className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
                        <span>Capítulos ({chaptersList.length})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleNavigateTab('principles')}
                        className="flex-1 sm:flex-none justify-center px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <BarChart3 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        <span>Principios</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleNavigateTab('quiz')}
                        className="flex-1 sm:flex-none justify-center px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <HelpCircle className="w-3.5 h-3.5" />
                        <span>Evaluación ({questions.length})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleNavigateTab('chat')}
                        className="w-full sm:w-auto justify-center px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-orange-300" />
                        <span>Dialogar con el Libro</span>
                      </button>
                    </div>
                  </div>
                </article>

                {/* =============================================================
                    EXPLANATORY VIDEO STUDIO: FULL BOOK SUMMARY VIDEO
                    ============================================================= */}
                <ExplainerVideoStudio
                  source={{
                    cacheKey: `book-${(analysis.title || fileName || 'obra').slice(0, 40)}`,
                    scope: 'book',
                    bookTitle: analysis.title || fileName,
                    author: analysis.authorOrSource,
                    executiveSummary: analysis.executiveSummary,
                    keyPoints: keyPointsList,
                    conclusions: conclusionsList,
                  }}
                  cachedVideo={
                    generatedVideos[
                      `book-${(analysis.title || fileName || 'obra').slice(0, 40)}`
                    ]
                  }
                  onVideoSaved={(key, vid) =>
                    setGeneratedVideos((prev) => ({ ...prev, [key]: vid }))
                  }
                />

                {/* =============================================================
                    VISUAL CONCEPTUAL MAP / ESQUEMA DE ARQUITECTURA DE LA OBRA
                    ============================================================= */}
                <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-8 space-y-5 sm:space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-medium text-orange-600 dark:text-orange-400 mb-0.5">
                        Esquema Estructural de la Obra
                      </div>
                      <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                        Mapa Conceptual y Distribución de Ejes Temáticos
                      </h2>
                    </div>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Toca cualquier eje o capítulo para inspeccionarlo
                    </span>
                  </div>

                  {/* Visual Tree Schema: Central Thesis -> Thematic Axes -> Chapters Flow */}
                  <div className="p-3.5 sm:p-6 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-5 sm:space-y-6">
                    {/* Level 1: Core Node */}
                    <div className="flex flex-col items-center text-center">
                      <div className="px-4 py-2.5 rounded-xl bg-blue-700 dark:bg-blue-600 text-white text-xs sm:text-sm font-bold max-w-full sm:max-w-xl shadow-xs">
                        Núcleo de la Obra: {analysis.title}
                      </div>
                      {/* Connecting SVG Stem */}
                      <svg
                        className="w-40 h-7 text-slate-300 dark:text-slate-600"
                        viewBox="0 0 160 28"
                        fill="none"
                      >
                        <path
                          d="M80 0V14M80 14H20V28M80 14H140V28M80 14V28"
                          stroke="currentColor"
                          strokeWidth="1.75"
                        />
                      </svg>
                    </div>

                    {/* Level 2: Thematic Distribution Bars */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3">
                      {uniqueCategories.map((cat, idx) => {
                        const count = keyPointsList.filter((kp) => kp.category === cat).length;
                        const pct = Math.max(
                          20,
                          Math.round((count / Math.max(1, keyPointsList.length)) * 100)
                        );
                        const palette = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
                        const isSelected = categoryFilter === cat;

                        return (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setCategoryFilter(isSelected ? 'Todas' : cat)}
                            className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-white dark:bg-slate-900 border-blue-700 dark:border-blue-400 ring-2 ring-blue-600/20'
                                : `${palette.bg} ${palette.border} hover:bg-white dark:hover:bg-slate-900`
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 text-xs font-semibold mb-1.5">
                              <span className={palette.text}>{cat}</span>
                              <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400 shrink-0">
                                {count} {count === 1 ? 'idea' : 'ideas'}
                              </span>
                            </div>
                            <div className="w-full h-1.5 bg-white/80 dark:bg-slate-900/80 rounded-full overflow-hidden">
                              <div className={`h-full ${palette.bar}`} style={{ width: `${pct}%` }} />
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Level 3: Visual Chapter Flow Chain */}
                    {chaptersList.length > 0 && (
                      <div className="pt-4 border-t border-slate-200 dark:border-slate-700/80 space-y-3">
                        <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                          <span>Secuencia Narrativa de Capítulos</span>
                          <span className="font-normal text-slate-500 dark:text-slate-400">
                            Desliza y toca un nodo para estudiar el capítulo
                          </span>
                        </div>
                        <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar">
                          {chaptersList.map((cap, idx) => {
                            const isExplored = Boolean(exploredChapters[idx]);
                            return (
                              <React.Fragment key={`${cap.n}-${idx}`}>
                                <button
                                  type="button"
                                  onClick={() => handleSelectAndExploreChapter(idx, true)}
                                  className={`group px-3.5 py-2.5 rounded-xl border text-left shrink-0 max-w-[175px] sm:max-w-[200px] transition-colors cursor-pointer ${
                                    isExplored
                                      ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 hover:border-emerald-500'
                                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:border-orange-500 dark:hover:border-orange-400'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-mono font-bold text-orange-600 dark:text-orange-400">
                                      Cap. {cap.n}
                                    </span>
                                    {isExplored && (
                                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                    )}
                                  </div>
                                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate group-hover:text-blue-700 dark:group-hover:text-blue-300">
                                    {cap.titulo}
                                  </div>
                                </button>
                                {idx < chaptersList.length - 1 && (
                                  <ArrowRight className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
                                )}
                              </React.Fragment>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                {/* Key Ideas with Interactive Category Filter */}
                <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-8">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                        Ideas Principales Desglosadas
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Argumentos, hallazgos y conceptos fundamentales extraídos de la obra.
                      </p>
                    </div>

                    {/* Interactive Filter Controls */}
                    <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-x-auto no-print">
                      {availableCategories.map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setCategoryFilter(cat)}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            categoryFilter === cat
                              ? 'bg-blue-700 dark:bg-blue-600 text-white'
                              : 'text-slate-600 dark:text-slate-300 hover:text-blue-700 dark:hover:text-blue-300'
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {filteredKeyPoints.map((kp, index) => (
                      <div key={kp.heading} className="py-4 first:pt-0 last:pb-0">
                        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
                          <span className="font-mono tabular-nums font-bold text-orange-600 dark:text-orange-400">
                            0{index + 1}.
                          </span>
                          <span className="font-medium text-blue-700 dark:text-blue-300">
                            {kp.category}
                          </span>
                        </div>
                        <h3 className="reading-heading font-bold text-slate-900 dark:text-white mb-1.5">
                          {kp.heading}
                        </h3>
                        <p className="reading-content text-slate-600 dark:text-slate-300">
                          {kp.detail}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Objectives & Actionable Takeaways */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Layers className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                      <h2 className="text-base font-bold text-slate-900 dark:text-white">
                        Propósitos Centrales del Libro
                      </h2>
                    </div>
                    <ol className="space-y-3 text-slate-700 dark:text-slate-300 reading-content">
                      {objectivesList.map((obj, idx) => (
                        <li key={idx} className="flex items-start gap-2.5">
                          <span className="font-mono text-xs font-bold text-orange-600 dark:text-orange-400 tabular-nums mt-1">
                            0{idx + 1}.
                          </span>
                          <span>{obj}</span>
                        </li>
                      ))}
                    </ol>
                  </section>

                  <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Award className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                      <h2 className="text-base font-bold text-slate-900 dark:text-white">
                        Lecciones Prácticas y Conclusiones
                      </h2>
                    </div>
                    <ul className="space-y-3 text-slate-700 dark:text-slate-300 reading-content">
                      {conclusionsList.map((conc, idx) => (
                        <li key={idx} className="flex items-start gap-2.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-1" />
                          <span>{conc}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              </div>
            )}

            {/* =================================================================
                VIEW 2: RUTA PROFUNDA DE CAPÍTULOS (100% DEL CONTENIDO) Y CITAS
                ================================================================= */}
            {activeTab === 'explorer' && analysis && (
              <div className="space-y-4 sm:space-y-6">
                {/* Chapter Selector & Deep Content Section */}
                <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-8">
                  <div className="flex flex-wrap items-center justify-between gap-2.5 mb-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-orange-600 dark:text-orange-400 mb-0.5">
                        {coverageReport
                          ? coverageReport.hasFullCoverage
                            ? `Estudio Exhaustivo Capítulo por Capítulo (100% cobertura verificada · ${coverageReport.totalPages} págs)`
                            : `Estudio Capítulo por Capítulo (${coverageReport.realCoveragePercent}% cobertura verificada · ${coverageReport.processedChapters}/${coverageReport.detectedChapters} procesados)`
                          : 'Estudio Exhaustivo Capítulo por Capítulo'}
                      </div>
                      <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
                        Ruta de Capítulos — {analysis.title}
                      </h2>
                    </div>
                    <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                      Avance: {exploredChaptersCount} / {totalChaptersCount} ({chapterProgressPercent}%)
                    </div>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-4 sm:mb-6">
                    Selecciona cada capítulo para estudiar su desarrollo extenso, conceptos definidos, historias reales, adaptación al mundo actual y preguntas.
                  </p>

                  {chaptersList.length > 0 && activeChapter ? (
                    <>
                      {/* Interactive Chapter Roadmap Nodes (swipeable on mobile, wrapped on desktop) */}
                      <div
                        role="tablist"
                        aria-label="Capítulos del libro"
                        className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0 sm:flex-wrap mb-4 sm:mb-6 no-scrollbar"
                      >
                        {chaptersList.map((cap, idx) => {
                          const isSelected = idx === activeChapterIdx;
                          const isExplored = Boolean(exploredChapters[idx]);
                          const isProcessing = cap.status === 'processing' || retryingChapterIdx === idx;
                          const hasError = cap.status === 'error';
                          return (
                            <button
                              key={`${cap.n}-${idx}`}
                              type="button"
                              role="tab"
                              aria-selected={isSelected}
                              onClick={() => handleSelectAndExploreChapter(idx, false)}
                              className={`py-2 px-3.5 rounded-xl text-xs font-mono font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                                isSelected
                                  ? 'bg-blue-700 dark:bg-blue-600 text-white shadow-xs'
                                  : hasError
                                  ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-900 dark:text-rose-200 border border-rose-300 dark:border-rose-700 hover:bg-rose-100/70 dark:hover:bg-rose-900/50'
                                  : isExplored
                                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700 hover:bg-emerald-100/70 dark:hover:bg-emerald-900/40'
                                  : 'bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-400'
                              }`}
                            >
                              {isProcessing ? (
                                <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />
                              ) : hasError ? (
                                <AlertTriangle
                                  className={`w-3.5 h-3.5 shrink-0 ${
                                    isSelected ? 'text-orange-300' : 'text-rose-600 dark:text-rose-400'
                                  }`}
                                />
                              ) : isExplored ? (
                                <CheckCircle2
                                  className={`w-3.5 h-3.5 shrink-0 ${
                                    isSelected ? 'text-orange-300' : 'text-emerald-600 dark:text-emerald-400'
                                  }`}
                                />
                              ) : null}
                              <span>Cap. {cap.n}</span>
                            </button>
                          );
                        })}
                      </div>

                      {/* Selected Chapter Deep Analysis Container */}
                      <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 sm:p-8 bg-slate-50/70 dark:bg-slate-950/50 space-y-4 sm:space-y-6">
                        {/* Chapter Header & Controls */}
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3.5 pb-4 sm:pb-5 border-b border-slate-200 dark:border-slate-800">
                          <div className="space-y-1 max-w-xl">
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-orange-600 dark:text-orange-400 font-mono font-semibold">
                              <span>
                                Capítulo {activeChapter.n} de {chaptersList.length}
                              </span>
                              {activeChapter.startPage && activeChapter.endPage && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>
                                    Págs. {activeChapter.startPage}–{activeChapter.endPage}
                                  </span>
                                </>
                              )}
                              {analysis.authorOrSource && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>{analysis.authorOrSource}</span>
                                </>
                              )}
                            </div>
                            <h3 className="reading-title text-lg sm:text-2xl font-bold text-slate-900 dark:text-white">
                              {activeChapter.titulo}
                            </h3>
                            {activeChapter.subtitulo && (
                              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 font-medium reading-content-sm">
                                {activeChapter.subtitulo}
                              </p>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto shrink-0">
                            <button
                              type="button"
                              onClick={() => handleToggleChapterCompleted(activeChapterIdx)}
                              className={`flex-1 sm:flex-none justify-center px-3 py-2 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                                exploredChapters[activeChapterIdx]
                                  ? 'bg-emerald-600 border-emerald-600 text-white'
                                  : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-emerald-600 dark:hover:border-emerald-500'
                              }`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>
                                {exploredChapters[activeChapterIdx]
                                  ? 'Completado'
                                  : 'Completar'}
                              </span>
                            </button>

                            <button
                              type="button"
                              disabled={activeChapterIdx === 0}
                              onClick={() =>
                                handleSelectAndExploreChapter(
                                  Math.max(0, activeChapterIdx - 1),
                                  false
                                )
                              }
                              className="px-3 py-2 text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              Anterior
                            </button>
                            <button
                              type="button"
                              disabled={activeChapterIdx === chaptersList.length - 1}
                              onClick={() =>
                                handleSelectAndExploreChapter(
                                  Math.min(chaptersList.length - 1, activeChapterIdx + 1),
                                  false
                                )
                              }
                              className="px-3 py-2 text-xs font-medium bg-blue-700 dark:bg-blue-600 text-white rounded-lg disabled:opacity-40 hover:bg-blue-800 dark:hover:bg-blue-500 cursor-pointer"
                            >
                              Siguiente
                            </button>
                          </div>
                        </div>

                        {/* Progressive Status / Retry Banner for Pending, Processing or Errored Chapters */}
                        {(activeChapter.status === 'processing' ||
                          retryingChapterIdx === activeChapterIdx) && (
                          <div className="p-4 rounded-xl bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800/70 flex items-center gap-2.5 text-xs font-medium text-orange-950 dark:text-orange-200">
                            <RefreshCw className="w-4 h-4 text-orange-600 dark:text-orange-400 animate-spin shrink-0" />
                            <span>
                              Analizando en profundidad el Capítulo {activeChapter.n}
                              {activeChapter.startPage && activeChapter.endPage
                                ? ` (págs. ${activeChapter.startPage}–${activeChapter.endPage})`
                                : ''}
                              ...
                            </span>
                          </div>
                        )}

                        {(activeChapter.status === 'error' ||
                          activeChapter.status === 'pending') &&
                          retryingChapterIdx !== activeChapterIdx && (
                            <div
                              className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
                                activeChapter.status === 'error'
                                  ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/70 text-rose-950 dark:text-rose-200'
                                  : 'bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800/70 text-orange-950 dark:text-orange-200'
                              }`}
                            >
                              <div className="flex items-start gap-2">
                                <AlertTriangle
                                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                                    activeChapter.status === 'error'
                                      ? 'text-rose-600 dark:text-rose-400'
                                      : 'text-orange-600 dark:text-orange-400'
                                  }`}
                                />
                                <div>
                                  <div className="font-semibold">
                                    {activeChapter.status === 'error'
                                      ? 'Este capítulo tuvo un error durante el análisis'
                                      : 'Este capítulo está pendiente de análisis profundo'}
                                  </div>
                                  {activeChapter.errorMessage && (
                                    <p className="mt-0.5 opacity-90">{activeChapter.errorMessage}</p>
                                  )}
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={Boolean(loadingMessage) || retryingChapterIdx !== null}
                                onClick={() => handleRetryChapter(activeChapterIdx)}
                                className="px-3.5 py-2 bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap self-start sm:self-auto"
                              >
                                <RefreshCw className="w-3.5 h-3.5 text-orange-300" />
                                <span>
                                  {activeChapter.status === 'error'
                                    ? 'Reintentar capítulo'
                                    : 'Analizar capítulo'}
                                </span>
                              </button>
                            </div>
                          )}

                        {/* 1. Core Thesis & Chapter Quote Banner */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                          <div
                            className={`${
                              activeChapter.citaCapitulo ? 'lg:col-span-7' : 'lg:col-span-12'
                            } bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/70 rounded-xl p-5 space-y-2`}
                          >
                            <div className="text-xs font-semibold text-blue-800 dark:text-blue-300">
                              Tesis e Idea Rectora del Capítulo
                            </div>
                            <p className="reading-content-lg text-slate-900 dark:text-slate-100 font-semibold">
                              {activeChapter.idea}
                            </p>
                          </div>

                          {activeChapter.citaCapitulo && (
                            <blockquote className="lg:col-span-5 bg-slate-900 dark:bg-slate-800 text-white border border-slate-800 dark:border-slate-700 rounded-xl p-5 flex flex-col justify-between space-y-3">
                              <div className="text-xs font-medium text-orange-300 flex items-center gap-1.5">
                                <Quote className="w-3.5 h-3.5" />
                                <span>Pasaje Clave del Capítulo</span>
                              </div>
                              <p className="reading-content font-medium text-slate-100 italic">
                                “{activeChapter.citaCapitulo}”
                              </p>
                            </blockquote>
                          )}
                        </div>

                        {/* 1B. AI-Narrated Explanatory Video Studio for this Chapter */}
                        <ExplainerVideoStudio
                          source={{
                            cacheKey: `chapter-${activeChapterIdx}-${activeChapter.n}`,
                            scope: 'chapter',
                            bookTitle: analysis.title || fileName,
                            author: analysis.authorOrSource,
                            chapterNumber: activeChapter.n,
                            chapterTitle: activeChapter.titulo,
                            chapterIdea: activeChapter.idea,
                            chapterAnalysis: activeChapter.analisisDetallado || '',
                            chapterStory: activeChapter.historia || '',
                            chapterConcepts: activeChapter.conceptosClave || [],
                            chapterTips: activeChapter.consejos || [],
                            realWorldCase:
                              customChapterAdaptations[activeChapterIdx] ||
                              activeChapter.adaptacionMundoActual,
                          }}
                          cachedVideo={
                            generatedVideos[`chapter-${activeChapterIdx}-${activeChapter.n}`]
                          }
                          onVideoSaved={(key, vid) =>
                            setGeneratedVideos((prev) => ({ ...prev, [key]: vid }))
                          }
                        />

                        {/* 2. Deep Multi-Paragraph Analysis (Análisis y Desarrollo Exhaustivo) */}
                        {activeChapter.analisisDetallado && (
                          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-3">
                            <div className="flex items-center gap-2 text-xs font-semibold text-blue-800 dark:text-blue-300">
                              <BookOpen className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                              <span>Análisis Exhaustivo y Desarrollo del Capítulo</span>
                            </div>
                            <div className="space-y-3 text-slate-700 dark:text-slate-300 reading-content-lg">
                              {activeChapter.analisisDetallado
                                .split('\n\n')
                                .map((para, pIdx) => (
                                  <p key={pIdx}>{para}</p>
                                ))}
                            </div>
                          </div>
                        )}

                        {/* 3. Real Stories, Case Studies & Examples */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-2">
                          <div className="text-xs font-semibold text-orange-600 dark:text-orange-400">
                            Casos de Estudio, Ejemplos Prácticos y Contexto Narrativo
                          </div>
                          <div className="space-y-2.5 text-slate-700 dark:text-slate-300 reading-content">
                            {(activeChapter.historia || '').split('\n\n').map((para, hIdx) => (
                              <p key={hIdx}>{para}</p>
                            ))}
                          </div>
                        </div>

                        {/* 4. Key Concepts & Definitions of the Chapter */}
                        {Array.isArray(activeChapter.conceptosClave) &&
                          activeChapter.conceptosClave.length > 0 && (
                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
                              <div className="text-xs font-semibold text-slate-900 dark:text-white">
                                Conceptos, Marcos y Definiciones Clave del Capítulo
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                {activeChapter.conceptosClave.map((concepto, kIdx) => (
                                  <div
                                    key={kIdx}
                                    className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 space-y-1"
                                  >
                                    <div className="text-sm font-bold text-blue-800 dark:text-blue-300">
                                      {concepto.termino}
                                    </div>
                                    <p className="reading-content-sm text-slate-600 dark:text-slate-300">
                                      {concepto.definicion}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                        {/* 5. Practical Takeaways & Action Rules */}
                        {Array.isArray(activeChapter.consejos) && activeChapter.consejos.length > 0 && (
                          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-3.5">
                            <div className="text-xs font-semibold text-slate-900 dark:text-white">
                              Lecciones Prácticas y Reglas de Acción del Capítulo
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {activeChapter.consejos.map((consejo, cIdx) => (
                                <div
                                  key={cIdx}
                                  className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 flex items-start gap-2.5 text-slate-700 dark:text-slate-300 reading-content"
                                >
                                  <span className="font-mono text-xs font-bold text-orange-600 dark:text-orange-400 tabular-nums mt-1">
                                    0{cIdx + 1}.
                                  </span>
                                  <span>{consejo}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 6. MODULE: ADAPTACIÓN DEL CAPÍTULO A CASO DE LA VIDA REAL / MUNDO ACTUAL */}
                        <div className="bg-white dark:bg-slate-900 border-2 border-blue-700/20 dark:border-blue-500/30 rounded-2xl overflow-hidden">
                          {/* Module Header Banner */}
                          <div className="bg-blue-900 dark:bg-slate-900 dark:border-b dark:border-slate-800 text-white p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 text-xs font-semibold text-orange-300">
                                <Briefcase className="w-4 h-4" />
                                <span>Módulo de Aplicación al Mundo Actual · Negocios, Liderazgo y Empresa</span>
                              </div>
                              <h4 className="text-lg font-bold text-white">
                                Adaptación del Capítulo {activeChapter.n} a un Caso Real de Hoy
                              </h4>
                              <p className="text-xs text-blue-100/85 dark:text-slate-300">
                                Selecciona un ámbito empresarial o describe tu propio caso para traducir las enseñanzas de este capítulo en un plan ejecutivo actual.
                              </p>
                            </div>
                          </div>

                          <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 bg-slate-50/70 dark:bg-slate-950/40">
                            {/* Interactive Domain Selector */}
                            <div className="space-y-2">
                              <label className="block text-xs font-semibold text-slate-900 dark:text-slate-200">
                                1. Elige el ámbito del mundo actual para adaptar este capítulo:
                              </label>
                              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                                {REAL_WORLD_DOMAINS.map((domain) => {
                                  const currentAdaptation =
                                    customChapterAdaptations[activeChapterIdx] ||
                                    activeChapter.adaptacionMundoActual;
                                  const isSelected = selectedAdaptationDomain === domain;
                                  return (
                                    <button
                                      key={domain}
                                      type="button"
                                      disabled={isAdaptingChapter}
                                      onClick={() => handleAdaptChapterToRealWorld(domain)}
                                      className={`px-3 py-1.5 rounded-xl text-xs font-medium text-left transition-colors cursor-pointer ${
                                        isSelected
                                          ? 'bg-blue-700 dark:bg-blue-600 text-white font-semibold'
                                          : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-orange-500 dark:hover:border-orange-400 hover:text-blue-800 dark:hover:text-blue-200'
                                      }`}
                                    >
                                      {domain}
                                      {currentAdaptation?.ambito === domain ? ' ✓' : ''}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Custom Context / Company Situation Input */}
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                              <input
                                type="text"
                                value={customAdaptationContext}
                                onChange={(e) => setCustomAdaptationContext(e.target.value)}
                                disabled={isAdaptingChapter}
                                placeholder="Opcional: Describe tu empresa, equipo o reto real..."
                                className="flex-1 px-3.5 py-2.5 text-base sm:text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:border-blue-600 dark:focus:border-blue-400"
                              />
                              <button
                                type="button"
                                disabled={isAdaptingChapter}
                                onClick={() => handleAdaptChapterToRealWorld()}
                                className="px-4 py-2.5 bg-orange-600 hover:bg-orange-700 dark:bg-orange-500 dark:hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
                              >
                                {isAdaptingChapter ? (
                                  <>
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    <span>Adaptando al caso real...</span>
                                  </>
                                ) : (
                                  <>
                                    <Target className="w-3.5 h-3.5" />
                                    <span>Adaptar a Caso Real</span>
                                  </>
                                )}
                              </button>
                            </div>

                            {/* Rendered Real-World Case Study & Action Plan */}
                            {(() => {
                              const activeAdaptation =
                                customChapterAdaptations[activeChapterIdx] ||
                                activeChapter.adaptacionMundoActual;

                              if (!activeAdaptation) {
                                return (
                                  <div className="p-4 sm:p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-3">
                                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                                      Haz clic en cualquiera de los ámbitos superiores o en <strong>Adaptar a Caso Real</strong> para generar el caso práctico de negocios, liderazgo o empresa de este capítulo.
                                    </p>
                                  </div>
                                );
                              }

                              return (
                                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-6 space-y-4 sm:space-y-5">
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-4 border-b border-slate-200 dark:border-slate-800">
                                    <div>
                                      <div className="text-xs font-mono font-semibold text-orange-600 dark:text-orange-400">
                                        Ámbito Aplicado: {activeAdaptation.ambito}
                                      </div>
                                      <h5 className="reading-heading font-bold text-slate-900 dark:text-white mt-0.5">
                                        {activeAdaptation.tituloCaso}
                                      </h5>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        handleNavigateTab('chat');
                                        handleSendChatQuestion(
                                          `Quiero profundizar en la adaptación del Capítulo ${activeChapter.n} ("${activeChapter.titulo}") al ámbito de ${activeAdaptation.ambito} (${activeAdaptation.tituloCaso}). ¿Cómo puedo implementar este plan paso a paso en mi organización?`
                                        );
                                      }}
                                      className="self-start sm:self-auto px-3 py-2 bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                                    >
                                      <MessageSquare className="w-3.5 h-3.5 text-orange-300" />
                                      <span>Simular Caso en el Chat</span>
                                    </button>
                                  </div>

                                  {/* Scenario & Book Parallel Grid */}
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4">
                                    <div className="p-3.5 sm:p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 space-y-1.5">
                                      <div className="text-xs font-bold text-slate-900 dark:text-white">
                                        Escenario en el Mundo Actual / Empresa
                                      </div>
                                      <p className="reading-content text-slate-700 dark:text-slate-300">
                                        {activeAdaptation.escenarioActual}
                                      </p>
                                    </div>

                                    <div className="p-3.5 sm:p-4 rounded-xl bg-orange-50/70 dark:bg-orange-950/35 border border-orange-200 dark:border-orange-800/70 space-y-1.5">
                                      <div className="text-xs font-bold text-orange-950 dark:text-orange-200">
                                        Paralelo Estratégico con el Capítulo {activeChapter.n}
                                      </div>
                                      <p className="reading-content text-slate-800 dark:text-slate-200">
                                        {activeAdaptation.paraleloConElLibro}
                                      </p>
                                    </div>
                                  </div>

                                  {/* Step-by-Step Executive Action Plan */}
                                  {Array.isArray(activeAdaptation.planDeAccion) &&
                                    activeAdaptation.planDeAccion.length > 0 && (
                                      <div className="space-y-2.5">
                                        <div className="text-xs font-bold text-slate-900 dark:text-white">
                                          Plan de Acción Ejecutivo para Implementar Hoy:
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                          {activeAdaptation.planDeAccion.map((paso, stepIdx) => (
                                            <div
                                              key={stepIdx}
                                              className="p-3 sm:p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 flex items-start gap-2.5 text-slate-700 dark:text-slate-300 reading-content"
                                            >
                                              <span className="font-mono text-xs font-bold text-orange-600 dark:text-orange-400 tabular-nums mt-1 shrink-0">
                                                Paso 0{stepIdx + 1}.
                                              </span>
                                              <span>{paso}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                  {/* Pitfall to Avoid & Success KPI */}
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4 pt-1">
                                    {activeAdaptation.errorComunEvitar && (
                                      <div className="p-3.5 rounded-xl bg-rose-50/80 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 text-xs space-y-1">
                                        <div className="font-bold text-rose-950 dark:text-rose-200 flex items-center gap-1.5">
                                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                                          <span>Error Común a Evitar en Empresas y Equipos</span>
                                        </div>
                                        <p className="text-rose-900 dark:text-rose-200/90 leading-relaxed reading-content-sm">
                                          {activeAdaptation.errorComunEvitar}
                                        </p>
                                      </div>
                                    )}

                                    {activeAdaptation.indicadorExito && (
                                      <div className="p-3.5 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 text-xs space-y-1">
                                        <div className="font-bold text-emerald-950 dark:text-emerald-200 flex items-center gap-1.5">
                                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                          <span>Indicador de Éxito / Métrica en la Vida Real</span>
                                        </div>
                                        <p className="text-emerald-900 dark:text-emerald-200/90 leading-relaxed reading-content-sm">
                                          {activeAdaptation.indicadorExito}
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        </div>

                        {/* 7. Reflection & Practical Application Questions */}
                        {Array.isArray(activeChapter.preguntasReflexion) &&
                          activeChapter.preguntasReflexion.length > 0 && (
                            <div className="bg-orange-50/60 dark:bg-orange-950/25 border border-orange-200 dark:border-orange-800/60 rounded-xl p-4 sm:p-5 space-y-3">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                                <div className="flex items-center gap-2 text-xs font-semibold text-orange-950 dark:text-orange-200">
                                  <Sparkles className="w-4 h-4 text-orange-600 dark:text-orange-400 shrink-0" />
                                  <span>Preguntas de Aplicación y Reflexión de este Capítulo</span>
                                </div>
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                  Toca para debatirlas con el asistente
                                </span>
                              </div>
                              <div className="space-y-2">
                                {activeChapter.preguntasReflexion.map((preg, pIdx) => (
                                  <div
                                    key={pIdx}
                                    className="p-3.5 rounded-lg bg-white dark:bg-slate-900 border border-orange-200/70 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                                  >
                                    <p className="reading-content font-medium text-slate-900 dark:text-slate-100">
                                      {preg}
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        handleNavigateTab('chat');
                                        handleSendChatQuestion(
                                          `Sobre el Capítulo ${activeChapter.n} ("${activeChapter.titulo}"): ${preg}`
                                        );
                                      }}
                                      className="px-3 py-1.5 bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shrink-0 cursor-pointer whitespace-nowrap"
                                    >
                                      Analizar en el Chat
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                      </div>
                    </>
                  ) : (
                    <div className="p-6 text-center bg-slate-50 dark:bg-slate-800/70 rounded-xl border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300">
                      Haz clic en &ldquo;Re-analizar obra&rdquo; para extraer el desglose profundo por capítulos de este libro.
                    </div>
                  )}
                </section>

                {/* Editorial Quotes Gallery */}
                {quotesList.length > 0 && (
                  <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8">
                    <div className="flex items-center gap-2 mb-1">
                      <Quote className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                        Pasajes y Citas Memorables
                      </h2>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
                      Frases destacadas extraídas de las páginas del libro.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {quotesList.map((q, idx) => (
                        <blockquote
                          key={idx}
                          className="p-5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 flex flex-col justify-between space-y-3"
                        >
                          <p className="reading-content-lg font-semibold text-slate-900 dark:text-slate-100">
                            “{q.texto}”
                          </p>
                          <cite className="text-xs text-orange-600 dark:text-orange-400 font-medium not-italic">
                            — {q.autor}
                          </cite>
                        </blockquote>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* =================================================================
                VIEW 3: PRINCIPIOS Y CIFRAS CLAVE (SECCIÓN DEDICADA)
                ================================================================= */}
            {activeTab === 'principles' && analysis && (
              <div className="space-y-4 sm:space-y-6">
                {/* Header & Summary Banner */}
                <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-8 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-medium text-orange-600 dark:text-orange-400 mb-0.5 flex items-center gap-1.5">
                        <BarChart3 className="w-3.5 h-3.5" />
                        <span>Principios, Indicadores y Fundamentos de la Obra</span>
                      </div>
                      <h2 className="text-lg sm:text-2xl font-bold text-slate-900 dark:text-white">
                        Principios y Cifras Clave — {analysis.title}
                      </h2>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleNavigateTab('explorer')}
                        className="px-3 py-2 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                      >
                        Ir a Capítulos
                      </button>
                      <button
                        type="button"
                        onClick={() => handleNavigateTab('chat')}
                        className="px-3 py-2 text-xs font-semibold bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                      >
                        Debatir Principios
                      </button>
                    </div>
                  </div>

                  {/* Key Metrics / Figures Grid */}
                  {keyMetricsList.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      {keyMetricsList.map((metric, mIdx) => (
                        <div
                          key={`${metric.label}-${mIdx}`}
                          className="p-4 sm:p-5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 flex flex-col justify-between gap-2"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-xs font-semibold text-blue-800 dark:text-blue-300">
                              {metric.label}
                            </span>
                            <span className="text-base sm:text-lg font-bold text-orange-600 dark:text-orange-400 font-mono tabular-nums shrink-0">
                              {metric.value}
                            </span>
                          </div>
                          <p className="reading-content-sm text-slate-600 dark:text-slate-300">
                            {metric.context}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300">
                      Este libro no reportó cifras numéricas destacadas en el análisis actual; revisa los principios y propósitos clave a continuación.
                    </div>
                  )}
                </section>

                {/* Filterable Core Principles & Ideas */}
                {keyPointsList.length > 0 && (
                  <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-8">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                      <div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                          Principios Fundamentales del Libro
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          Filtra los argumentos e ideas rectoras por eje temático.
                        </p>
                      </div>

                      <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-x-auto no-print">
                        {availableCategories.map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setCategoryFilter(cat)}
                            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              categoryFilter === cat
                                ? 'bg-blue-700 dark:bg-blue-600 text-white'
                                : 'text-slate-600 dark:text-slate-300 hover:text-blue-700 dark:hover:text-blue-300'
                            }`}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="divide-y divide-slate-200 dark:divide-slate-800">
                      {filteredKeyPoints.map((kp, idx) => (
                        <div key={`${kp.heading}-${idx}`} className="py-4 first:pt-0 last:pb-0">
                          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
                            <span className="font-mono tabular-nums font-bold text-orange-600 dark:text-orange-400">
                              0{idx + 1}.
                            </span>
                            <span className="font-medium text-blue-700 dark:text-blue-300">
                              {kp.category}
                            </span>
                          </div>
                          <h4 className="reading-heading font-bold text-slate-900 dark:text-white mb-1.5">
                            {kp.heading}
                          </h4>
                          <p className="reading-content text-slate-600 dark:text-slate-300">
                            {kp.detail}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Objectives & Actionable Takeaways */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Layers className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">
                        Propósitos Centrales
                      </h3>
                    </div>
                    <ol className="space-y-3 text-slate-700 dark:text-slate-300 reading-content">
                      {objectivesList.map((obj, idx) => (
                        <li key={idx} className="flex items-start gap-2.5">
                          <span className="font-mono text-xs font-bold text-orange-600 dark:text-orange-400 tabular-nums mt-1">
                            0{idx + 1}.
                          </span>
                          <span>{obj}</span>
                        </li>
                      ))}
                    </ol>
                  </section>

                  <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Award className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">
                        Conclusiones y Reglas Prácticas
                      </h3>
                    </div>
                    <ul className="space-y-3 text-slate-700 dark:text-slate-300 reading-content">
                      {conclusionsList.map((conc, idx) => (
                        <li key={idx} className="flex items-start gap-2.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-1" />
                          <span>{conc}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>

                {/* Quotes Collection */}
                {quotesList.length > 0 && (
                  <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8">
                    <div className="flex items-center gap-2 mb-1">
                      <Quote className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                        Citas de Respaldo del Autor
                      </h3>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
                      Pasajes textuales que sintetizan los principios de la obra.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {quotesList.map((q, idx) => (
                        <blockquote
                          key={idx}
                          className="p-5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 flex flex-col justify-between space-y-3"
                        >
                          <p className="reading-content-lg font-semibold text-slate-900 dark:text-slate-100">
                            “{q.texto}”
                          </p>
                          <cite className="text-xs text-orange-600 dark:text-orange-400 font-medium not-italic">
                            — {q.autor}
                          </cite>
                        </blockquote>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* =================================================================
                VIEW 4: EVALUACIÓN INTEGRAL, POR CAPÍTULO Y SEGUIMIENTO (ETAPA 3)
                + CUESTIONARIO RÁPIDO (ETAPA 1 PRESERVADO)
                ================================================================= */}
            {activeTab === 'quiz' && analysis && (
              <div className="space-y-4 sm:space-y-6">
                {/* Mode switcher preserving Etapa 1 Quick Quiz alongside Etapa 3 Studio */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-2 sm:p-2.5 flex flex-wrap items-center justify-between gap-2 no-print">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEvalViewMode('stage3')}
                      className={`px-3.5 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
                        evalViewMode === 'stage3'
                          ? 'bg-blue-700 dark:bg-blue-600 text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      Evaluación por Capítulo, Integral y Seguimiento
                    </button>
                    <button
                      type="button"
                      onClick={() => setEvalViewMode('quick')}
                      className={`px-3.5 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
                        evalViewMode === 'quick'
                          ? 'bg-blue-700 dark:bg-blue-600 text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      Cuestionario Rápido ({totalQuestions} preg.)
                    </button>
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 px-2">
                    {evalViewMode === 'stage3'
                      ? 'Múltiple · V/F · Abiertas · Trazabilidad · Evolución'
                      : 'Modo clásico de comprobación rápida'}
                  </span>
                </div>

                {evalViewMode === 'stage3' ? (
                  <Stage3EvaluationStudio
                    analysis={analysis}
                    coverageReport={coverageReport || null}
                    cache={
                      stage3Cache ||
                      createEmptyStage3Cache(
                        stage3BookFingerprint || 'book',
                        analysis.title || fileName || 'Libro'
                      )
                    }
                    onUpdateCache={handleUpdateStage3Cache}
                    onJumpToChapter={handleJumpToChapterNumber}
                    onAskInChat={handleAskInChatFromStage3}
                  />
                ) : (
                  <>
                {/* Quiz Configuration & Visual Mastery Gauge Header */}
                <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6 pb-4 sm:pb-5 border-b border-slate-200 dark:border-slate-800">
                    <div>
                      <div className="text-xs font-medium text-orange-600 dark:text-orange-400 mb-0.5">
                        Comprobación de Lectura
                      </div>
                      <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
                        Evaluación Interactiva del Libro
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Responde preguntas de opción múltiple y preguntas abiertas calificadas en vivo.
                      </p>
                    </div>

                    {/* Visual Radial Mastery Ring & Score Counter */}
                    <div className="flex flex-wrap items-center justify-between gap-3 w-full md:w-auto shrink-0 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 sm:px-4 py-3">
                      <div className="flex items-center gap-3">
                        <svg className="w-11 h-11 sm:w-12 sm:h-12 -rotate-90 shrink-0" viewBox="0 0 36 36">
                          <circle
                            cx="18"
                            cy="18"
                            r="15"
                            fill="none"
                            className="stroke-slate-200 dark:stroke-slate-700"
                            strokeWidth="3.5"
                          />
                          <circle
                            cx="18"
                            cy="18"
                            r="15"
                            fill="none"
                            className="stroke-orange-500 dark:stroke-orange-400"
                            strokeWidth="3.5"
                            strokeDasharray={`${masteryPercent} 100`}
                            strokeLinecap="round"
                          />
                        </svg>
                        <div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">Dominio Actual</div>
                          <div className="text-sm sm:text-base font-bold text-slate-900 dark:text-white font-mono tabular-nums">
                            {totalCorrect} / {totalQuestions} aciertos ({masteryPercent}%)
                          </div>
                        </div>
                      </div>
                      {totalAnswered > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedOptions({});
                            setOpenAnswersDraft({});
                            setOpenEvaluations({});
                          }}
                          className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Reiniciar</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Dynamic Quiz Generator Controls */}
                  <div className="pt-4 flex flex-wrap items-center justify-between gap-4 no-print">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-slate-500 dark:text-slate-400 font-medium">Dificultad:</span>
                        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
                          {(['Básico', 'Intermedio', 'Avanzado'] as const).map((level) => (
                            <button
                              key={level}
                              type="button"
                              onClick={() => setQuizDifficulty(level)}
                              className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                                quizDifficulty === level
                                  ? 'bg-blue-700 dark:bg-blue-600 text-white'
                                  : 'text-slate-600 dark:text-slate-300 hover:text-blue-700 dark:hover:text-blue-300'
                              }`}
                            >
                              {level}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-slate-500 dark:text-slate-400 font-medium">Formato:</span>
                        <select
                          value={quizMode}
                          onChange={(e) =>
                            setQuizMode(e.target.value as 'mixed' | 'multiple_choice' | 'open')
                          }
                          className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-medium focus:outline-none focus:border-blue-600"
                        >
                          <option value="mixed">Mixto (Múltiple + Abierta)</option>
                          <option value="multiple_choice">Solo Opción Múltiple</option>
                          <option value="open">Solo Respuesta Abierta</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-slate-500 dark:text-slate-400 font-medium">Cantidad:</span>
                        <select
                          value={quizCount}
                          onChange={(e) => setQuizCount(Number(e.target.value))}
                          className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-mono tabular-nums focus:outline-none focus:border-blue-600"
                        >
                          <option value={5}>5 preguntas</option>
                          <option value={6}>6 preguntas</option>
                          <option value={8}>8 preguntas</option>
                        </select>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={Boolean(loadingMessage)}
                      onClick={handleGenerateNewQuiz}
                      className="px-4 py-2 bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 text-orange-300 ${loadingMessage ? 'animate-spin' : ''}`}
                      />
                      <span>Generar Nuevas Preguntas</span>
                    </button>
                  </div>
                </section>

                {/* Questions List */}
                <div className="space-y-4">
                  {questions.map((q, idx) => {
                    if (q.type === 'multiple_choice') {
                      const userChoice = selectedOptions[q.id];
                      const hasAnswered = userChoice !== undefined;
                      const isCorrect = userChoice === q.correctIndex;

                      return (
                        <article
                          key={q.id}
                          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4"
                        >
                          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                            <span>
                              Pregunta{' '}
                              <span className="font-mono tabular-nums font-bold text-orange-600 dark:text-orange-400">
                                0{idx + 1}
                              </span>{' '}
                              · Opción Múltiple
                            </span>
                            {hasAnswered && (
                              <span
                                className={`font-semibold flex items-center gap-1 ${
                                  isCorrect
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-rose-700 dark:text-rose-400'
                                }`}
                              >
                                {isCorrect ? (
                                  <>
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>Acierto</span>
                                  </>
                                ) : (
                                  <>
                                    <XCircle className="w-3.5 h-3.5" />
                                    <span>Respuesta Incorrecta</span>
                                  </>
                                )}
                              </span>
                            )}
                          </div>

                          <h3 className="reading-heading font-bold text-slate-900 dark:text-white">
                            {q.question}
                          </h3>

                          <div className="space-y-2">
                            {(q.options || []).map((opt, optIdx) => {
                              const isThisSelected = userChoice === optIdx;
                              const isThisCorrect = q.correctIndex === optIdx;

                              let optionClasses =
                                'border-slate-200 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-400 bg-slate-50/70 dark:bg-slate-800/60 text-slate-800 dark:text-slate-200';
                              if (hasAnswered) {
                                if (isThisCorrect) {
                                  optionClasses =
                                    'border-emerald-600 dark:border-emerald-500 bg-emerald-50/90 dark:bg-emerald-950/45 text-emerald-950 dark:text-emerald-100 font-medium';
                                } else if (isThisSelected) {
                                  optionClasses =
                                    'border-rose-500 bg-rose-50/90 dark:bg-rose-950/45 text-rose-950 dark:text-rose-100';
                                } else {
                                  optionClasses =
                                    'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-slate-400 dark:text-slate-500';
                                }
                              }

                              return (
                                <button
                                  key={optIdx}
                                  type="button"
                                  onClick={() =>
                                    setSelectedOptions((prev) => ({ ...prev, [q.id]: optIdx }))
                                  }
                                  className={`w-full text-left px-4 py-3 rounded-xl border reading-content transition-colors flex items-start justify-between gap-3 cursor-pointer ${optionClasses}`}
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
                          </div>

                          {hasAnswered && (
                            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 space-y-1.5">
                              <div className="text-xs font-bold text-slate-900 dark:text-white">
                                Explicación fundamentada en el libro:
                              </div>
                              <p className="reading-content-sm">{q.explanation}</p>
                              {q.referenceQuote && (
                                <p className="text-xs text-orange-700 dark:text-orange-300 italic pt-1">
                                  {q.referenceQuote}
                                </p>
                              )}
                            </div>
                          )}
                        </article>
                      );
                    }

                    // Open-ended question card
                    const evaluation = openEvaluations[q.id];
                    const isEvaluatingThis = evaluatingQuestionId === q.id;

                    return (
                      <article
                        key={q.id}
                        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4"
                      >
                        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                          <span>
                            Pregunta{' '}
                            <span className="font-mono tabular-nums font-bold text-orange-600 dark:text-orange-400">
                              0{idx + 1}
                            </span>{' '}
                            · Respuesta Abierta
                          </span>
                          {evaluation && (
                            <span
                              className={`font-semibold font-mono tabular-nums flex items-center gap-1 ${
                                evaluation.isCorrect
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-orange-600 dark:text-orange-400'
                              }`}
                            >
                              {evaluation.isCorrect ? (
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              ) : (
                                <AlertTriangle className="w-3.5 h-3.5" />
                              )}
                              <span>Puntaje: {evaluation.score}/100</span>
                            </span>
                          )}
                        </div>

                        <h3 className="reading-heading font-bold text-slate-900 dark:text-white">
                          {q.question}
                        </h3>

                        <div className="space-y-2.5 no-print">
                          <textarea
                            rows={3}
                            value={openAnswersDraft[q.id] || ''}
                            onChange={(e) =>
                              setOpenAnswersDraft((prev) => ({ ...prev, [q.id]: e.target.value }))
                            }
                            placeholder="Escribe tu reflexión o respuesta según lo leído en el libro..."
                            className="w-full p-3.5 text-sm border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:border-blue-600 dark:focus:border-blue-400 bg-slate-50/70 dark:bg-slate-800/70 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                          />

                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              Puntos esperados: {(q.rubricKeyPoints || []).join(' · ')}
                            </span>
                            <button
                              type="button"
                              disabled={isEvaluatingThis}
                              onClick={() => handleEvaluateOpenQuestion(q)}
                              className="px-4 py-2 bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                            >
                              {isEvaluatingThis ? (
                                <>
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-orange-300" />
                                  <span>Revisando respuesta...</span>
                                </>
                              ) : (
                                <span>Calificar Respuesta</span>
                              )}
                            </button>
                          </div>
                        </div>

                        {evaluation && (
                          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 space-y-2">
                            <div className="flex items-center justify-between text-xs font-bold text-slate-900 dark:text-white">
                              <span>
                                {evaluation.isCorrect
                                  ? 'Excelente comprensión del libro'
                                  : 'Respuesta parcial — Puede profundizarse'}
                              </span>
                              <span className="font-mono tabular-nums text-orange-600 dark:text-orange-400">
                                {evaluation.score} / 100
                              </span>
                            </div>
                            <p className="reading-content-sm">{evaluation.feedback}</p>
                            {evaluation.missingConcepts && evaluation.missingConcepts.length > 0 && (
                              <div className="text-xs">
                                <span className="font-semibold text-slate-800 dark:text-slate-200">
                                  Ideas complementarias del libro:{' '}
                                </span>
                                <span>{evaluation.missingConcepts.join('; ')}</span>
                              </div>
                            )}
                            <div className="pt-2 border-t border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 reading-content-sm">
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                Síntesis modelo:{' '}
                              </span>
                              {q.explanation}
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
                  </>
                )}
              </div>
            )}

            {/* =================================================================
                VIEW 5: DIALOGAR CON EL LIBRO (ASISTENTE)
                ================================================================= */}
            {activeTab === 'chat' && analysis && (
              <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col h-[calc(100dvh-13rem)] min-h-[440px] sm:h-[680px]">
                {/* Chat Header */}
                <div className="p-3.5 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                      Dialogar con el Libro
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                      Basado en{' '}
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {analysis.title}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setChatMessages([
                        {
                          id: `reset-${Date.now()}`,
                          role: 'assistant',
                          content: `Conversación reiniciada. ¿Qué deseas consultar sobre "${analysis.title}"?`,
                          groundingStatus: 'Basado en el libro activo',
                          timestamp: new Date().toLocaleTimeString('es-ES', {
                            hour: '2-digit',
                            minute: '2-digit',
                          }),
                        },
                      ])
                    }
                    className="px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-blue-700 dark:hover:text-blue-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Limpiar
                  </button>
                </div>

                {/* Suggested Contextual Questions */}
                {suggestedQuestionsList.length > 0 && (
                  <div className="px-3.5 sm:px-5 py-2.5 sm:py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 overflow-x-auto no-scrollbar">
                    <span className="text-xs font-medium text-orange-600 dark:text-orange-400 shrink-0">
                      Sugerencias:
                    </span>
                    {suggestedQuestionsList.map((sq, idx) => (
                      <button
                        key={idx}
                        type="button"
                        disabled={isChatLoading}
                        onClick={() => handleSendChatQuestion(sq)}
                        className="px-3 py-1.5 text-xs bg-white dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-blue-950/60 text-slate-700 dark:text-slate-200 hover:text-blue-800 dark:hover:text-blue-200 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {sq}
                      </button>
                    ))}
                  </div>
                )}

                {/* Chat Messages Viewport */}
                <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-3.5 sm:space-y-4">
                  {chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[92%] sm:max-w-[85%] rounded-2xl p-3.5 sm:p-4 space-y-2 ${
                          msg.role === 'user'
                            ? 'bg-blue-700 dark:bg-blue-600 text-white'
                            : 'bg-slate-50 dark:bg-slate-800/80 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] sm:text-xs opacity-80">
                          <span className="font-semibold">
                            {msg.role === 'user' ? 'Tú' : 'Asistente del Libro'}
                          </span>
                          {msg.groundingStatus && (
                            <span>
                              {msg.groundingStatus} · {msg.timestamp}
                            </span>
                          )}
                        </div>

                        <div className="reading-content whitespace-pre-wrap break-words">
                          {msg.content}
                        </div>

                        {msg.citations && msg.citations.length > 0 && (
                          <div className="pt-2 mt-2 border-t border-slate-200 dark:border-slate-700 space-y-1 text-slate-600 dark:text-slate-300">
                            <div className="text-xs font-semibold text-orange-600 dark:text-orange-400">
                              Pasajes relacionados en la obra:
                            </div>
                            {msg.citations.map((cit, cIdx) => (
                              <p key={cIdx} className="reading-content-sm italic">
                                “{cit}”
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {isChatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-xs text-slate-700 dark:text-slate-300 flex items-center gap-2.5">
                        <RefreshCw className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400 animate-spin" />
                        <span>Consultando las páginas del libro...</span>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Chat Input Form */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendChatQuestion();
                  }}
                  className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2 sm:gap-3"
                >
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    disabled={isChatLoading}
                    placeholder="Pregunta sobre el libro o un capítulo..."
                    className="flex-1 min-w-0 px-3.5 sm:px-4 py-2.5 text-base sm:text-sm border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:border-blue-600 dark:focus:border-blue-400 bg-slate-50/70 dark:bg-slate-800/70 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                  <button
                    type="submit"
                    disabled={isChatLoading || !chatInput.trim()}
                    className="px-3.5 sm:px-5 py-2.5 bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Send className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-orange-300" />
                    <span className="hidden sm:inline">Enviar</span>
                  </button>
                </form>
              </section>
            )}
          </section>
        </main>
      )}

      {/* =====================================================================
          MODAL: PEGAR TEXTO DE UN LIBRO MANUALMENTE (Mobile-safe scrollable)
          ===================================================================== */}
      {showManualTextModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 dark:bg-black/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 no-print">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-t-2xl sm:rounded-2xl max-w-2xl w-full max-h-[90dvh] overflow-y-auto p-5 sm:p-6 space-y-4 shadow-xl safe-area-pb">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Pegar Contenido de un Libro
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowManualTextModal(false)}
                className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer px-2 py-1"
              >
                Cerrar
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Introduce el título y pega el texto o los capítulos del libro que deseas analizar.
            </p>
            <input
              type="text"
              value={manualTitleDraft}
              onChange={(e) => setManualTitleDraft(e.target.value)}
              placeholder="Título del libro"
              className="w-full px-3.5 py-2.5 text-base sm:text-sm bg-slate-50/70 dark:bg-slate-800/80 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:border-blue-600 dark:focus:border-blue-400"
            />
            <textarea
              rows={7}
              value={manualTextDraft}
              onChange={(e) => setManualTextDraft(e.target.value)}
              placeholder="Pega aquí el texto o capítulos del libro..."
              className="w-full p-3.5 text-base sm:text-sm bg-slate-50/70 dark:bg-slate-800/80 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:border-blue-600 dark:focus:border-blue-400"
            />
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowManualTextModal(false)}
                className="px-4 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (manualTextDraft.trim().length < 20) {
                    setErrorMessage('El texto del libro debe contener al menos 20 caracteres.');
                    return;
                  }
                  const customName = manualTitleDraft.trim() || 'Libro analizado';
                  const structured = buildStructuredDocumentFromText(manualTextDraft.trim());
                  setFileName(customName);
                  setDocumentText(structured.text);
                  setExtractedPages(structured.pages);
                  setPdfOutline([]);
                  setPageCount(structured.pageCount);
                  setShowManualTextModal(false);
                  await runFullAiPipeline(structured.text, customName, structured.pages, []);
                }}
                className="px-4 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg cursor-pointer"
              >
                Analizar Libro
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: PERSONALIZACIÓN DE LECTURA (6 TIPOGRAFÍAS, A-/A+, MODO OSCURO)
          ===================================================================== */}
      <ReadingSettingsModal
        preferences={readingPrefs}
        onChange={setReadingPrefs}
        isOpen={showReadingSettings}
        onClose={() => setShowReadingSettings(false)}
      />

      {/* Quiet Editorial Footer */}
      <footer className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-4 text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-blue-800 dark:text-blue-300">LecturaViva</span>
          <span aria-hidden="true">·</span>
          <span>Estudio Visual de Libros</span>
          {UPCOMING_NAV_SLOTS.length > 0 && (
            <>
              <span aria-hidden="true" className="hidden sm:inline">·</span>
              <span className="hidden sm:inline text-slate-400 dark:text-slate-500">
                Próximas expansiones preparadas: {UPCOMING_NAV_SLOTS.map((s) => s.label).join(' · ')}
              </span>
            </>
          )}
        </div>
        {hasLoadedBook && (
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleExportMarkdown}
              className="hover:text-blue-700 dark:hover:text-blue-300 underline underline-offset-4 cursor-pointer"
            >
              Descargar guía completa
            </button>
          </div>
        )}
      </footer>

      {/* =====================================================================
          NATIVE-STYLE FIXED BOTTOM NAVIGATION BAR FOR MOBILE PHONES
          5 organized sections fitted 100% to phone screen width with zero overflow
          ===================================================================== */}
      <nav
        aria-label="Navegación móvil"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 grid grid-cols-5 px-0.5 pt-1.5 safe-area-pb no-print shadow-[0_-4px_16px_rgba(15,23,42,0.08)] dark:shadow-[0_-4px_16px_rgba(0,0,0,0.4)]"
      >
        <button
          type="button"
          onClick={() => handleNavigateTab('summary')}
          className={`flex flex-col items-center justify-center gap-1 py-1.5 rounded-xl transition-colors cursor-pointer ${
            activeTab === 'summary'
              ? 'text-blue-700 dark:text-blue-300 font-semibold'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <div
            className={`relative p-1 rounded-lg ${
              activeTab === 'summary'
                ? 'bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300'
                : ''
            }`}
          >
            <BookOpen className="w-4 h-4" />
          </div>
          <span className="text-[10px] leading-none">Resumen</span>
        </button>

        <button
          type="button"
          onClick={() => handleNavigateTab('explorer')}
          className={`flex flex-col items-center justify-center gap-1 py-1.5 rounded-xl transition-colors cursor-pointer ${
            activeTab === 'explorer'
              ? 'text-blue-700 dark:text-blue-300 font-semibold'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <div
            className={`relative p-1 rounded-lg ${
              activeTab === 'explorer'
                ? 'bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300'
                : ''
            }`}
          >
            <Compass className="w-4 h-4" />
            {hasLoadedBook && totalChaptersCount > 0 && (
              <span className="absolute -top-1 -right-2.5 px-1 py-0.5 text-[9px] font-mono font-bold bg-blue-700 dark:bg-blue-600 text-white rounded-full leading-none">
                {exploredChaptersCount}/{totalChaptersCount}
              </span>
            )}
          </div>
          <span className="text-[10px] leading-none">Capítulos</span>
        </button>

        <button
          type="button"
          onClick={() => handleNavigateTab('principles')}
          className={`flex flex-col items-center justify-center gap-1 py-1.5 rounded-xl transition-colors cursor-pointer ${
            activeTab === 'principles'
              ? 'text-blue-700 dark:text-blue-300 font-semibold'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <div
            className={`relative p-1 rounded-lg ${
              activeTab === 'principles'
                ? 'bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300'
                : ''
            }`}
          >
            <BarChart3 className="w-4 h-4" />
          </div>
          <span className="text-[10px] leading-none">Principios</span>
        </button>

        <button
          type="button"
          onClick={() => handleNavigateTab('quiz')}
          className={`flex flex-col items-center justify-center gap-1 py-1.5 rounded-xl transition-colors cursor-pointer ${
            activeTab === 'quiz'
              ? 'text-blue-700 dark:text-blue-300 font-semibold'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <div
            className={`relative p-1 rounded-lg ${
              activeTab === 'quiz'
                ? 'bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300'
                : ''
            }`}
          >
            <HelpCircle className="w-4 h-4" />
            {hasLoadedBook && totalQuestions > 0 && (
              <span className="absolute -top-1 -right-2 px-1 py-0.5 text-[9px] font-mono font-bold bg-orange-600 text-white rounded-full leading-none">
                {totalCorrect}/{totalQuestions}
              </span>
            )}
          </div>
          <span className="text-[10px] leading-none">Evaluación</span>
        </button>

        <button
          type="button"
          onClick={() => handleNavigateTab('chat')}
          className={`flex flex-col items-center justify-center gap-1 py-1.5 rounded-xl transition-colors cursor-pointer ${
            activeTab === 'chat'
              ? 'text-blue-700 dark:text-blue-300 font-semibold'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <div
            className={`relative p-1 rounded-lg ${
              activeTab === 'chat'
                ? 'bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300'
                : ''
            }`}
          >
            <MessageSquare className="w-4 h-4" />
          </div>
          <span className="text-[10px] leading-none">Diálogo</span>
        </button>
      </nav>
    </div>
  );
}
