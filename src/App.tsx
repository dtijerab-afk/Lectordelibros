/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
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
} from 'lucide-react';
import {
  DocumentAnalysis,
  QuizQuestion,
  RealWorldAdaptationItem,
} from './data/enamoratePreset';
import {
  downloadTextFile,
  extractTextFromFile,
  generateMarkdownReport,
} from './utils/pdfAndExport';

const HERO_ILLUSTRATION = '/src/assets/images/editorial_reading_studio_hero_1794091696482.jpg';
const SYNTHESIS_ILLUSTRATION = '/src/assets/images/schema_book_synthesis_art_1794091697552.jpg';
const COMPASS_ILLUSTRATION = '/src/assets/images/schema_chapter_compass_art_1794091699649.jpg';
const QUIZ_ILLUSTRATION = '/src/assets/images/schema_quiz_mastery_art_1794091699280.jpg';

type ActiveTab = 'summary' | 'explorer' | 'quiz' | 'chat';

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
  { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-900', bar: 'bg-amber-600' },
  { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-900', bar: 'bg-indigo-600' },
  { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-900', bar: 'bg-emerald-600' },
  { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-900', bar: 'bg-rose-600' },
  { bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-900', bar: 'bg-sky-600' },
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

  // Book / Document state (starts clean without any pre-loaded book)
  const [fileName, setFileName] = useState<string>('');
  const [pageCount, setPageCount] = useState<number>(0);
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

  // Chapter Explorer & Reading Progress state
  const [activeChapterIdx, setActiveChapterIdx] = useState<number>(0);
  const [exploredChapters, setExploredChapters] = useState<Record<number, boolean>>({});

  // Real-World Adaptation Module state (Negocios, Liderazgo, Empresa, etc.)
  const [selectedAdaptationDomain, setSelectedAdaptationDomain] = useState<string>(
    REAL_WORLD_DOMAINS[0]
  );
  const [customAdaptationContext, setCustomAdaptationContext] = useState<string>('');
  const [customChapterAdaptations, setCustomChapterAdaptations] = useState<
    Record<number, RealWorldAdaptationItem>
  >({});
  const [isAdaptingChapter, setIsAdaptingChapter] = useState<boolean>(false);

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

  const hasLoadedBook = Boolean(analysis && documentText.trim().length >= 20);

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
      const res = await fetch('/api/adapt-chapter', {
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

      const data = await res.json();
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
    setFileName('');
    setPageCount(0);
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
    setErrorMessage('');
    setLoadingMessage('');
    setLoadingProgress(0);
    setActiveTab('summary');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Run full AI Analysis + non-blocking Quiz generation on any uploaded book
  const runFullAiPipeline = async (textToAnalyze: string, nameOfBook: string) => {
    if (!textToAnalyze || textToAnalyze.trim().length < 20) {
      setErrorMessage('Por favor adjunta un libro con contenido válido antes de analizar.');
      return;
    }

    setErrorMessage('');
    setLoadingMessage(
      `Analizando el 90% del contenido de "${nameOfBook}" (capítulos detallados, conceptos y mapa)...`
    );
    setLoadingProgress(45);

    try {
      const analyzeRes = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentText: textToAnalyze,
          fileName: nameOfBook,
        }),
      });

      const analyzeData = await analyzeRes.json();
      if (!analyzeRes.ok) {
        throw new Error(analyzeData.error || 'No se pudo completar el análisis del libro.');
      }

      setAnalysis(analyzeData);
      setCategoryFilter('Todas');
      setActiveChapterIdx(0);
      setExploredChapters({ 0: true });
      setActiveTab('summary');
      setLoadingProgress(100);
      setLoadingMessage('');

      setChatMessages([
        {
          id: `welcome-${Date.now()}`,
          role: 'assistant',
          content: `He procesado en profundidad el libro "${analyzeData.title || nameOfBook}", extrayendo el análisis detallado de sus capítulos, conceptos clave, casos de estudio y lecciones prácticas. ¿Sobre qué capítulo o tema deseas profundizar?`,
          groundingStatus: 'Basado en el libro activo',
          timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);

      // Generate quiz in background after main analysis finishes to avoid concurrent API load
      const quizRes = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentText: textToAnalyze,
          fileName: nameOfBook,
          questionCount: quizCount,
          difficulty: quizDifficulty,
          quizMode,
        }),
      }).catch(() => null);

      if (quizRes && quizRes.ok) {
        const quizData = await quizRes.json();
        if (Array.isArray(quizData.questions)) {
          setQuestions(quizData.questions);
          setSelectedOptions({});
          setOpenAnswersDraft({});
          setOpenEvaluations({});
        }
      }
    } catch (err: unknown) {
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
      setLoadingProgress(15);

      const { text, pageCount: pages } = await extractTextFromFile(file, (status, pct) => {
        setLoadingMessage(status);
        setLoadingProgress(Math.min(35, Math.round(pct * 0.35)));
      });

      const cleanTitle = file.name.replace(/\.[^/.]+$/, '');
      setFileName(cleanTitle);
      setPageCount(pages);
      setDocumentText(text);

      await runFullAiPipeline(text, cleanTitle);
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

  // Generate new dynamic quiz
  const handleGenerateNewQuiz = async () => {
    if (!documentText || documentText.trim().length < 20) {
      setErrorMessage('Primero debes cargar un libro para generar preguntas.');
      return;
    }

    setErrorMessage('');
    setLoadingMessage(`Generando ${quizCount} nuevas preguntas (${quizDifficulty})...`);
    setLoadingProgress(50);

    try {
      const res = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentText,
          fileName: analysis?.title || fileName,
          questionCount: quizCount,
          difficulty: quizDifficulty,
          quizMode,
        }),
      });
      const data = await res.json();
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

  // Evaluate open-ended question
  const handleEvaluateOpenQuestion = async (q: QuizQuestion) => {
    const userAnswer = openAnswersDraft[q.id]?.trim();
    if (!userAnswer) {
      setErrorMessage('Por favor escribe tu respuesta antes de evaluarla.');
      return;
    }

    setErrorMessage('');
    setEvaluatingQuestionId(q.id);

    try {
      const res = await fetch('/api/evaluate-open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentText,
          question: q.question,
          userAnswer,
          rubricKeyPoints: q.rubricKeyPoints,
          explanation: q.explanation,
        }),
      });
      const data = await res.json();
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

  // Submit Chat question
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
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentText,
          fileName: analysis?.title || fileName,
          history: updatedHistory.map((m) => ({ role: m.role, content: m.content })),
          message: msg,
        }),
      });
      const data = await res.json();
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

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF7F2] text-stone-900">
      {/* Hidden global file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.txt,.md"
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* =====================================================================
          TOP BAR CONTRACT (3 Zones: Brand Wordmark, 4 Nav Links, 1 Primary CTA)
          ===================================================================== */}
      <header className="sticky top-0 z-30 bg-[#FAF7F2]/95 backdrop-blur border-b border-stone-200/90 px-6 py-3.5 flex items-center justify-between gap-8 no-print">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#workspace"
          onClick={(e) => {
            e.preventDefault();
            handleNavigateTab('summary');
          }}
          className="text-lg font-bold tracking-tight text-indigo-950 whitespace-nowrap shrink-0 font-display"
        >
          LecturaViva
        </a>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-stone-600">
          <button
            type="button"
            onClick={() => handleNavigateTab('summary')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'summary'
                ? 'text-indigo-950 underline decoration-amber-600 decoration-2 underline-offset-8 font-semibold'
                : 'hover:text-indigo-950'
            }`}
          >
            Mapa y Resumen
          </button>
          <button
            type="button"
            onClick={() => handleNavigateTab('explorer')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'explorer'
                ? 'text-indigo-950 underline decoration-amber-600 decoration-2 underline-offset-8 font-semibold'
                : 'hover:text-indigo-950'
            }`}
          >
            Ruta de Capítulos
          </button>
          <button
            type="button"
            onClick={() => handleNavigateTab('quiz')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'quiz'
                ? 'text-indigo-950 underline decoration-amber-600 decoration-2 underline-offset-8 font-semibold'
                : 'hover:text-indigo-950'
            }`}
          >
            Evaluación Interactiva
          </button>
          <button
            type="button"
            onClick={() => handleNavigateTab('chat')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'chat'
                ? 'text-indigo-950 underline decoration-amber-600 decoration-2 underline-offset-8 font-semibold'
                : 'hover:text-indigo-950'
            }`}
          >
            Dialogar con el Libro
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          {hasLoadedBook ? (
            <button
              type="button"
              onClick={handleExportMarkdown}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-950 rounded-lg hover:bg-indigo-900 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              <span>Descargar Guía</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setManualTitleDraft('');
                setManualTextDraft('');
                setShowManualTextModal(true);
              }}
              className="px-4 py-2 text-xs font-semibold text-indigo-950 bg-amber-100/90 border border-amber-300/80 rounded-lg hover:bg-amber-200/80 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Pegar Texto de un Libro
            </button>
          )}
        </div>
      </header>

      {/* Mobile Segmented Navigation (Always visible on mobile/tablet so navigation always works) */}
      <div className="md:hidden bg-white border-b border-stone-200 px-4 py-2 flex items-center gap-1 overflow-x-auto no-print">
        <button
          type="button"
          onClick={() => handleNavigateTab('summary')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'summary' ? 'bg-indigo-950 text-white' : 'text-stone-600 hover:text-indigo-950'
          }`}
        >
          Mapa y Resumen {hasLoadedBook ? `(${chapterProgressPercent}%)` : ''}
        </button>
        <button
          type="button"
          onClick={() => handleNavigateTab('explorer')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'explorer' ? 'bg-indigo-950 text-white' : 'text-stone-600 hover:text-indigo-950'
          }`}
        >
          Ruta de Capítulos {hasLoadedBook ? `(${exploredChaptersCount}/${chaptersList.length})` : ''}
        </button>
        <button
          type="button"
          onClick={() => handleNavigateTab('quiz')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'quiz' ? 'bg-indigo-950 text-white' : 'text-stone-600 hover:text-indigo-950'
          }`}
        >
          Evaluación {hasLoadedBook ? `(${totalCorrect}/${totalQuestions})` : ''}
        </button>
        <button
          type="button"
          onClick={() => handleNavigateTab('chat')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'chat' ? 'bg-indigo-950 text-white' : 'text-stone-600 hover:text-indigo-950'
          }`}
        >
          Dialogar con el Libro
        </button>
      </div>

      {/* =====================================================================
          MAIN WORKSPACE CONTAINER
          ===================================================================== */}
      {!hasLoadedBook ? (
        /* =====================================================================
           TAB-AWARE WORKSPACE BEFORE A BOOK IS LOADED
           Every tab ('summary' | 'explorer' | 'quiz' | 'chat') navigates cleanly
           ===================================================================== */
        <main
          id="workspace"
          className="max-w-[1280px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-8 flex-1"
        >
          {activeTab === 'summary' && (
            <>
              {/* Hero Split: Editorial Illustration + Single Book Dropzone */}
              <section className="bg-white border border-stone-200/90 rounded-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
                {/* Left Column: Visual Emblem, Editorial Headline & Single Upload Zone */}
                <div className="lg:col-span-7 p-6 sm:p-10 flex flex-col justify-between space-y-6">
                  <div className="space-y-4">
                    <div className="inline-flex items-center gap-3">
                      <div className="w-11 h-11 rounded-xl bg-indigo-950 text-amber-400 flex items-center justify-center shrink-0">
                        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                          <path d="M2 6.5C2 5.4 2.9 4.5 4 4.5H10C11.1 4.5 12 5.4 12 6.5V19.5C12 18.4 11.1 17.5 10 17.5H4C2.9 17.5 2 18.4 2 19.5V6.5Z" />
                          <path d="M22 6.5C22 5.4 21.1 4.5 20 4.5H14C12.9 4.5 12 5.4 12 6.5V19.5C12 18.4 12.9 17.5 14 17.5H20C21.1 17.5 22 18.4 22 19.5V6.5Z" />
                          <circle cx="12" cy="9" r="1.5" fill="currentColor" />
                        </svg>
                      </div>
                      <div className="text-xs text-stone-500">
                        <span>Estudio Profundo de Libros</span>
                        <span aria-hidden="true"> · </span>
                        <span>Cobertura del 90% del Contenido Capítulo a Capítulo</span>
                      </div>
                    </div>

                    <h1 className="text-2xl sm:text-4xl font-bold text-indigo-950 tracking-tight leading-tight">
                      Domina el 90% de cualquier libro con mapas visuales y capítulos detallados
                    </h1>

                    <p className="text-sm sm:text-base text-stone-600 leading-relaxed max-w-2xl">
                      Sube tu libro en PDF o texto para obtener un estudio exhaustivo capítulo por capítulo: análisis de múltiples párrafos, glosario de conceptos clave, casos reales, barra de progreso de lectura y evaluación interactiva.
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
                    className={`border-2 border-dashed rounded-xl p-6 sm:p-8 text-center transition-colors ${
                      loadingMessage
                        ? 'border-amber-400 bg-amber-50/50 cursor-wait'
                        : isDragging
                        ? 'border-amber-600 bg-amber-50/70 cursor-pointer'
                        : 'border-stone-300 hover:border-amber-600 bg-[#FAF7F2] hover:bg-amber-50/30 cursor-pointer'
                    }`}
                  >
                    {loadingMessage ? (
                      <div role="status" aria-live="polite" className="max-w-md mx-auto space-y-3">
                        <RefreshCw className="w-7 h-7 text-amber-700 animate-spin mx-auto" />
                        <div className="text-sm font-semibold text-indigo-950">{loadingMessage}</div>
                        {fileName && (
                          <div className="text-xs text-stone-600 font-mono tabular-nums">
                            {fileName} {pageCount > 0 ? `· ${pageCount} páginas procesadas` : ''}
                          </div>
                        )}
                        <div className="w-full h-2 bg-amber-200/70 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-600 transition-transform duration-200 origin-left"
                            style={{ transform: `scaleX(${Math.max(0.12, loadingProgress / 100)})` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center mx-auto">
                          <FileUp className="w-6 h-6" />
                        </div>
                        <p className="text-base font-bold text-indigo-950">
                          Selecciona o arrastra aquí tu libro (PDF o TXT)
                        </p>
                        <p className="text-xs text-stone-500">
                          Análisis profundo de todos los capítulos, conceptos clave, historias y lecciones prácticas
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Error Alert */}
                  {errorMessage && (
                    <div
                      role="alert"
                      className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-3 text-xs text-rose-950"
                    >
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <div className="flex-1 space-y-1">
                        <p className="font-semibold">Atención</p>
                        <p className="leading-relaxed">{errorMessage}</p>
                      </div>
                      {documentText.trim().length >= 20 && (
                        <button
                          type="button"
                          onClick={() => runFullAiPipeline(documentText, fileName || 'Libro')}
                          className="px-3 py-1.5 bg-rose-900 text-white font-semibold rounded-md hover:bg-rose-800 cursor-pointer whitespace-nowrap"
                        >
                          Reintentar
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Right Column: Editorial Illustration Showcase */}
                <div className="lg:col-span-5 relative bg-indigo-950 min-h-[280px] flex flex-col justify-end overflow-hidden">
                  <img
                    src={HERO_ILLUSTRATION}
                    alt="Ilustración editorial de un estudio de lectura con esquemas geométricos y botánicos emergiendo de un libro abierto"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover opacity-90"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-indigo-950/90 via-indigo-950/25 to-transparent" />
                  <div className="relative p-6 sm:p-8 text-white space-y-2">
                    <div className="text-xs text-amber-300 font-medium">
                      Cobertura Exhaustiva del 90% de la Obra
                    </div>
                    <p className="text-sm text-stone-100 leading-relaxed">
                      Cada capítulo se desglosa en tesis central, desarrollo argumental completo, conceptos definidos, casos reales y preguntas de aplicación.
                    </p>
                  </div>
                </div>
              </section>

              {/* Visual Progress Bar Panel in 'Mapa y Resumen' (Ready State) */}
              <section className="bg-white border border-stone-200/90 rounded-2xl p-6 sm:p-7 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                      <BookMarked className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-amber-800">
                        Seguimiento de Avance en Mapa y Resumen
                      </div>
                      <h2 className="text-base sm:text-lg font-bold text-indigo-950">
                        Barra de Progreso de Capítulos Explorados
                      </h2>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <span className="text-2xl font-bold font-mono tabular-nums text-indigo-950">
                        0%
                      </span>
                      <span className="block text-xs text-stone-500">
                        Esperando carga de libro
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleNavigateTab('explorer')}
                      className="px-3.5 py-2 bg-indigo-950 hover:bg-indigo-900 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <span>Ver Ruta de Capítulos</span>
                      <ArrowRight className="w-3.5 h-3.5 text-amber-400" />
                    </button>
                  </div>
                </div>

                <div className="w-full h-3 bg-stone-200/80 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-600 rounded-full w-0 transition-all duration-300" />
                </div>

                <p className="text-xs text-stone-600">
                  Al subir cualquier libro, esta barra registrará automáticamente cada capítulo que explores o marques como completado para mostrar tu porcentaje de avance sobre el 100% de la obra.
                </p>
              </section>

              {/* Interactive 3-Stage Cards with Direct Section Navigation */}
              <section className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium text-amber-800 mb-1">
                      Navegación por las Secciones de Estudio
                    </div>
                    <h2 className="text-xl sm:text-2xl font-bold text-indigo-950">
                      Explora las herramientas de LecturaViva
                    </h2>
                  </div>
                  <span className="text-xs text-stone-500">
                    Haz clic en cualquier tarjeta para navegar a su sección
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Stage 1 Card -> Ruta de Capítulos */}
                  <div
                    onClick={() => handleNavigateTab('explorer')}
                    className="group bg-white border border-stone-200/90 hover:border-amber-600 rounded-2xl overflow-hidden flex flex-col transition-all cursor-pointer"
                  >
                    <div className="aspect-4/3 bg-stone-100 overflow-hidden border-b border-stone-200/80">
                      <img
                        src={COMPASS_ILLUSTRATION}
                        alt="Brújula literaria y mapa de ruta por capítulos"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                    <div className="p-6 space-y-2.5 flex-1 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="text-xs font-mono font-semibold text-amber-700">
                          01 · Capítulos al 90% de Detalle
                        </div>
                        <h3 className="text-base font-bold text-indigo-950 group-hover:text-amber-800 transition-colors">
                          Ruta Profunda de Capítulos
                        </h3>
                        <p className="text-xs text-stone-600 leading-relaxed">
                          Cada capítulo incluye desarrollo extenso de varios párrafos, glosario de conceptos clave, casos narrados por el autor, cita propia y preguntas de aplicación.
                        </p>
                      </div>
                      <div className="pt-2 flex items-center gap-1.5 text-xs font-semibold text-indigo-950 group-hover:text-amber-800">
                        <span>Ir a Ruta de Capítulos</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </div>

                  {/* Stage 2 Card -> Evaluación Interactiva */}
                  <div
                    onClick={() => handleNavigateTab('quiz')}
                    className="group bg-white border border-stone-200/90 hover:border-amber-600 rounded-2xl overflow-hidden flex flex-col transition-all cursor-pointer"
                  >
                    <div className="aspect-4/3 bg-stone-100 overflow-hidden border-b border-stone-200/80">
                      <img
                        src={QUIZ_ILLUSTRATION}
                        alt="Ilustración de cuaderno de evaluación y dominio de lectura"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                    <div className="p-6 space-y-2.5 flex-1 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="text-xs font-mono font-semibold text-amber-700">
                          02 · Comprobación de Dominio
                        </div>
                        <h3 className="text-base font-bold text-indigo-950 group-hover:text-amber-800 transition-colors">
                          Evaluación Interactiva
                        </h3>
                        <p className="text-xs text-stone-600 leading-relaxed">
                          Pon a prueba tu comprensión con preguntas de opción múltiple y preguntas abiertas calificadas al instante según el contenido del libro.
                        </p>
                      </div>
                      <div className="pt-2 flex items-center gap-1.5 text-xs font-semibold text-indigo-950 group-hover:text-amber-800">
                        <span>Ir a Evaluación Interactiva</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </div>

                  {/* Stage 3 Card -> Dialogar con el Libro */}
                  <div
                    onClick={() => handleNavigateTab('chat')}
                    className="group bg-white border border-stone-200/90 hover:border-amber-600 rounded-2xl overflow-hidden flex flex-col transition-all cursor-pointer"
                  >
                    <div className="aspect-4/3 bg-stone-100 overflow-hidden border-b border-stone-200/80">
                      <img
                        src={SYNTHESIS_ILLUSTRATION}
                        alt="Esquema ilustrado de árbol de conocimiento e ideas conectadas"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                    <div className="p-6 space-y-2.5 flex-1 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="text-xs font-mono font-semibold text-amber-700">
                          03 · Consultas con Citas Textuales
                        </div>
                        <h3 className="text-base font-bold text-indigo-950 group-hover:text-amber-800 transition-colors">
                          Dialogar con el Libro
                        </h3>
                        <p className="text-xs text-stone-600 leading-relaxed">
                          Conversa directamente con el contenido de la obra para resolver dudas sobre capítulos, conceptos o ejemplos con respaldo textual.
                        </p>
                      </div>
                      <div className="pt-2 flex items-center gap-1.5 text-xs font-semibold text-indigo-950 group-hover:text-amber-800">
                        <span>Ir a Dialogar con el Libro</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}

          {activeTab === 'explorer' && (
            <section className="bg-white border border-stone-200/90 rounded-2xl p-6 sm:p-10 space-y-8">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-stone-200/80">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-amber-800">
                    Ruta de Capítulos · Cobertura del 90% del Contenido
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-indigo-950">
                    Desglose Profundo Capítulo por Capítulo
                  </h1>
                  <p className="text-sm text-stone-600 max-w-2xl">
                    Cuando subas tu libro en PDF o texto, aquí podrás navegar por cada uno de sus capítulos con las 6 capas de profundidad editorial.
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2.5 bg-indigo-950 hover:bg-indigo-900 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <FileUp className="w-4 h-4 text-amber-400" />
                    <span>Seleccionar Libro (PDF / TXT)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNavigateTab('summary')}
                    className="px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-stone-200/70 text-stone-700 text-xs font-medium rounded-xl border border-stone-200/90 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Volver a Mapa y Resumen
                  </button>
                </div>
              </div>

              {/* Preview of the 6 Deep Chapter Layers */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="p-5 rounded-xl bg-[#FAF7F2] border border-stone-200/80 space-y-2">
                  <div className="text-xs font-mono font-bold text-amber-700">CAPA 01</div>
                  <h3 className="text-sm font-bold text-indigo-950">Subtítulo y Tesis Central</h3>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Síntesis clara de la premisa rectora y el argumento principal que sostiene el autor en el capítulo.
                  </p>
                </div>
                <div className="p-5 rounded-xl bg-[#FAF7F2] border border-stone-200/80 space-y-2">
                  <div className="text-xs font-mono font-bold text-amber-700">CAPA 02</div>
                  <h3 className="text-sm font-bold text-indigo-950">Análisis Exhaustivo (Múltiples Párrafos)</h3>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Desarrollo riguroso de 2 a 4 párrafos con los mecanismos, metodologías, contrastes y explicaciones completas del capítulo.
                  </p>
                </div>
                <div className="p-5 rounded-xl bg-[#FAF7F2] border border-stone-200/80 space-y-2">
                  <div className="text-xs font-mono font-bold text-amber-700">CAPA 03</div>
                  <h3 className="text-sm font-bold text-indigo-950">Casos de Estudio e Historias Reales</h3>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Relato detallado de los experimentos, ejemplos históricos, empresas o anécdotas empleadas por el autor.
                  </p>
                </div>
                <div className="p-5 rounded-xl bg-[#FAF7F2] border border-stone-200/80 space-y-2">
                  <div className="text-xs font-mono font-bold text-amber-700">CAPA 04</div>
                  <h3 className="text-sm font-bold text-indigo-950">Glosario de Conceptos del Capítulo</h3>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    De 3 a 5 términos, marcos teóricos o leyes introducidas en el capítulo con su definición exacta.
                  </p>
                </div>
                <div className="p-5 rounded-xl bg-[#FAF7F2] border border-stone-200/80 space-y-2">
                  <div className="text-xs font-mono font-bold text-amber-700">CAPA 05</div>
                  <h3 className="text-sm font-bold text-indigo-950">Cita Destacada y Reglas de Acción</h3>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Pasaje memorable del capítulo acompañado de 4 a 6 pasos accionables para llevar la teoría a la práctica.
                  </p>
                </div>
                <div className="p-5 rounded-xl bg-[#FAF7F2] border border-stone-200/80 space-y-2">
                  <div className="text-xs font-mono font-bold text-amber-700">CAPA 06</div>
                  <h3 className="text-sm font-bold text-indigo-950">Adaptación al Mundo Actual (Negocios y Liderazgo)</h3>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Módulo interactivo que traduce cada capítulo a un caso real de empresa, liderazgo, startups, ventas o toma de decisiones hoy.
                  </p>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'quiz' && (
            <section className="bg-white border border-stone-200/90 rounded-2xl p-6 sm:p-10 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-stone-200/80">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-amber-800">
                    Comprobación de Lectura
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-indigo-950">
                    Evaluación Interactiva del Libro
                  </h1>
                  <p className="text-sm text-stone-600 max-w-2xl">
                    Configura la dificultad, el formato y la cantidad de preguntas. Sube un libro para generar tu cuestionario personalizado al instante.
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2.5 bg-indigo-950 hover:bg-indigo-900 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <FileUp className="w-4 h-4 text-amber-400" />
                    <span>Subir Libro para Evaluar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNavigateTab('summary')}
                    className="px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-stone-200/70 text-stone-700 text-xs font-medium rounded-xl border border-stone-200/90 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Volver al Inicio
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 p-5 rounded-xl bg-[#FAF7F2] border border-stone-200/80">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-stone-600 font-semibold">Dificultad preseleccionada:</span>
                  <div className="flex items-center gap-1 p-1 bg-white border border-stone-200/80 rounded-lg">
                    {(['Básico', 'Intermedio', 'Avanzado'] as const).map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setQuizDifficulty(level)}
                        className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                          quizDifficulty === level
                            ? 'bg-indigo-950 text-white'
                            : 'text-stone-600 hover:text-indigo-950'
                        }`}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-stone-600 font-semibold">Formato:</span>
                  <select
                    value={quizMode}
                    onChange={(e) =>
                      setQuizMode(e.target.value as 'mixed' | 'multiple_choice' | 'open')
                    }
                    className="px-2.5 py-1.5 bg-white border border-stone-200 rounded-lg text-stone-800 font-medium focus:outline-none"
                  >
                    <option value="mixed">Mixto (Múltiple + Abierta)</option>
                    <option value="multiple_choice">Solo Opción Múltiple</option>
                    <option value="open">Solo Respuesta Abierta</option>
                  </select>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-stone-600 font-semibold">Cantidad:</span>
                  <select
                    value={quizCount}
                    onChange={(e) => setQuizCount(Number(e.target.value))}
                    className="px-2.5 py-1.5 bg-white border border-stone-200 rounded-lg text-stone-800 font-mono tabular-nums focus:outline-none"
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
            <section className="bg-white border border-stone-200/90 rounded-2xl p-6 sm:p-10 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-stone-200/80">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-amber-800">
                    Asistente Contextual fundamentado en el Libro
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-indigo-950">
                    Dialogar con el Libro
                  </h1>
                  <p className="text-sm text-stone-600 max-w-2xl">
                    Realiza preguntas abiertas sobre cualquier capítulo, concepto o caso de estudio. El asistente responde citando pasajes de la obra cargada.
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2.5 bg-indigo-950 hover:bg-indigo-900 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <FileUp className="w-4 h-4 text-amber-400" />
                    <span>Subir Libro para Dialogar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNavigateTab('summary')}
                    className="px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-stone-200/70 text-stone-700 text-xs font-medium rounded-xl border border-stone-200/90 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Volver al Inicio
                  </button>
                </div>
              </div>

              <div className="p-6 rounded-xl bg-[#FAF7F2] border border-stone-200/80 space-y-3">
                <div className="text-xs font-semibold text-indigo-950">
                  Ejemplos de consultas que podrás realizar al cargar tu libro:
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-stone-700">
                  <div className="p-3.5 rounded-lg bg-white border border-stone-200/80">
                    “¿Cuáles son los argumentos principales y casos reales del Capítulo 1?”
                  </div>
                  <div className="p-3.5 rounded-lg bg-white border border-stone-200/80">
                    “Explícame los conceptos clave del libro y cómo aplicarlos paso a paso.”
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
          className="max-w-[1400px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1"
        >
          {/* LEFT COLUMN: Active Book Card, Visual Stats & Key Principles */}
          <aside className="lg:col-span-4 space-y-6 no-print">
            {/* Active Book Card with Visual Header Banner */}
            <section className="bg-white border border-stone-200/90 rounded-2xl overflow-hidden">
              <div className="h-28 relative bg-indigo-950 overflow-hidden">
                <img
                  src={HERO_ILLUSTRATION}
                  alt="Portada ilustrada del estudio de lectura"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover opacity-75"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-indigo-950 via-indigo-950/40 to-transparent" />
                <div className="absolute bottom-3 left-5 right-5 flex items-center justify-between text-xs text-amber-300 font-medium">
                  <span>Obra en Estudio</span>
                  {pageCount > 0 && (
                    <span className="font-mono tabular-nums">
                      {pageCount} {pageCount === 1 ? 'página' : 'páginas'}
                    </span>
                  )}
                </div>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-indigo-950 leading-snug">
                    {analysis?.title || fileName}
                  </h2>
                  {analysis?.authorOrSource && (
                    <p className="text-xs text-stone-600 mt-1">
                      Autor / Fuente:{' '}
                      <span className="font-semibold text-stone-800">{analysis.authorOrSource}</span>
                    </p>
                  )}
                </div>

                {/* Sidebar Mini Progress Indicator */}
                <div className="p-3.5 rounded-xl bg-[#FAF7F2] border border-stone-200/80 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-indigo-950">Avance de Capítulos</span>
                    <span className="font-mono font-bold text-amber-800 tabular-nums">
                      {exploredChaptersCount}/{totalChaptersCount} ({chapterProgressPercent}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-stone-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        chapterProgressPercent === 100 ? 'bg-emerald-600' : 'bg-amber-600'
                      }`}
                      style={{ width: `${chapterProgressPercent}%` }}
                    />
                  </div>
                </div>

                {/* Mini Structural Summary Schema */}
                <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                  <div className="p-2.5 rounded-xl bg-[#FAF7F2]">
                    <div className="text-base font-bold text-indigo-950 font-mono tabular-nums">
                      {chaptersList.length}
                    </div>
                    <div className="text-xs text-stone-500">Capítulos</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#FAF7F2]">
                    <div className="text-base font-bold text-amber-700 font-mono tabular-nums">
                      {keyPointsList.length}
                    </div>
                    <div className="text-xs text-stone-500">Ideas Clave</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#FAF7F2]">
                    <div className="text-base font-bold text-emerald-700 font-mono tabular-nums">
                      {quotesList.length}
                    </div>
                    <div className="text-xs text-stone-500">Citas</div>
                  </div>
                </div>

                {/* Loading Indicator */}
                {loadingMessage && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-2"
                  >
                    <div className="flex items-center gap-2.5 text-xs font-medium text-amber-950">
                      <RefreshCw className="w-4 h-4 text-amber-700 animate-spin shrink-0" />
                      <span>{loadingMessage}</span>
                    </div>
                  </div>
                )}

                {/* Error Alert */}
                {errorMessage && (
                  <div
                    role="alert"
                    className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-xs text-rose-900"
                  >
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-1">
                      <p className="font-semibold">Atención</p>
                      <p className="leading-relaxed">{errorMessage}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setErrorMessage('')}
                      className="text-rose-700 hover:text-rose-950 font-medium cursor-pointer"
                    >
                      Cerrar
                    </button>
                  </div>
                )}

                <div className="pt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="py-2 px-3 bg-indigo-950 hover:bg-indigo-900 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <FileUp className="w-3.5 h-3.5 text-amber-400" />
                    <span>Cambiar Libro</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="py-2 px-3 bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Imprimir Guía</span>
                  </button>
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
                  <button
                    type="button"
                    disabled={Boolean(loadingMessage)}
                    onClick={() => runFullAiPipeline(documentText, analysis?.title || fileName)}
                    className="text-stone-600 hover:text-indigo-950 underline underline-offset-4 cursor-pointer"
                  >
                    Re-analizar obra
                  </button>
                  <button
                    type="button"
                    onClick={handleClearBook}
                    className="text-rose-700 hover:text-rose-900 font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Cerrar libro</span>
                  </button>
                </div>
              </div>
            </section>

            {/* Key Principles & Figures Table */}
            {keyMetricsList.length > 0 && (
              <section className="bg-white border border-stone-200/90 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-bold text-indigo-950">Principios y Cifras Clave</h2>
                  <span className="text-xs text-stone-500 tabular-nums">
                    {keyMetricsList.length} indicadores
                  </span>
                </div>

                <div className="divide-y divide-stone-200/80">
                  {keyMetricsList.map((metric) => (
                    <div key={metric.label} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-xs font-medium text-stone-600">{metric.label}</span>
                        <span className="text-sm font-bold text-amber-800 font-mono tabular-nums">
                          {metric.value}
                        </span>
                      </div>
                      <p className="text-xs text-stone-500 mt-1 leading-relaxed">{metric.context}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </aside>

          {/* RIGHT COLUMN: Main Interactive Book Views */}
          <section className="lg:col-span-8 space-y-6">
            {/* =================================================================
                VIEW 1: MAPA CONCEPTUAL, BARRA DE PROGRESO Y RESUMEN DEL LIBRO
                ================================================================= */}
            {activeTab === 'summary' && analysis && (
              <div className="space-y-6">
                {/* =============================================================
                    VISUAL PROGRESS BAR OF EXPLORED / COMPLETED CHAPTERS
                    ============================================================= */}
                {chaptersList.length > 0 && (
                  <section className="bg-white border border-stone-200/90 rounded-2xl p-6 sm:p-7 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                          <BookMarked className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="text-xs font-medium text-amber-800">
                            Progreso de Exploración del Libro
                          </div>
                          <h2 className="text-base sm:text-lg font-bold text-indigo-950">
                            {exploredChaptersCount} de {totalChaptersCount} capítulos explorados
                          </h2>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <span className="text-2xl font-bold font-mono tabular-nums text-indigo-950">
                            {chapterProgressPercent}%
                          </span>
                          <span className="block text-xs text-stone-500">
                            {chapterProgressPercent === 100
                              ? '¡Obra completada!'
                              : 'de avance en la obra'}
                          </span>
                        </div>
                        {nextPendingChapterIdx !== -1 ? (
                          <button
                            type="button"
                            onClick={() => handleSelectAndExploreChapter(nextPendingChapterIdx, true)}
                            className="px-3.5 py-2 bg-indigo-950 hover:bg-indigo-900 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            <span>Ir al Cap. {chaptersList[nextPendingChapterIdx].n}</span>
                            <ArrowRight className="w-3.5 h-3.5 text-amber-400" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setExploredChapters({})}
                            className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-medium rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                          >
                            Reiniciar progreso
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Visual Progress Bar Track */}
                    <div className="w-full h-3 bg-stone-200/80 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 rounded-full ${
                          chapterProgressPercent === 100 ? 'bg-emerald-600' : 'bg-amber-600'
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
                              className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                                isDone
                                  ? 'bg-emerald-50 border border-emerald-300 text-emerald-900'
                                  : 'bg-[#FAF7F2] border border-stone-200 text-stone-600 hover:border-amber-500 hover:text-indigo-950'
                              }`}
                            >
                              {isDone && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
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
                          className="text-xs text-stone-500 hover:text-indigo-950 underline underline-offset-4 cursor-pointer whitespace-nowrap"
                        >
                          Marcar todos como leídos
                        </button>
                      )}
                    </div>
                  </section>
                )}

                {/* Book Synopsis Card */}
                <article className="bg-white border border-stone-200/90 rounded-2xl p-6 sm:p-8">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-amber-800 font-medium mb-3">
                    <span>Síntesis Ejecutiva Integral (90% del Contenido)</span>
                    {analysis.authorOrSource && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{analysis.authorOrSource}</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{chaptersList.length} capítulos profundos</span>
                  </div>

                  <h1 className="text-2xl sm:text-3xl font-bold text-indigo-950 tracking-tight mb-4">
                    {analysis.title}
                  </h1>

                  <div className="space-y-3 text-sm sm:text-base text-stone-700 leading-relaxed">
                    {(analysis.executiveSummary || '').split('\n\n').map((paragraph, index) => (
                      <p key={index}>{paragraph}</p>
                    ))}
                  </div>

                  {/* Quick Action Bar */}
                  <div className="mt-6 pt-5 border-t border-stone-200/80 flex flex-wrap items-center justify-between gap-4 no-print">
                    <div className="text-xs text-stone-500">
                      Explora el estudio exhaustivo de cada capítulo, realiza el test o conversa con el libro.
                    </div>
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => handleSelectAndExploreChapter(activeChapterIdx, true)}
                        className="px-3.5 py-2 text-xs font-semibold text-indigo-950 bg-amber-100/80 hover:bg-amber-200/80 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <Compass className="w-3.5 h-3.5 text-amber-800" />
                        <span>Estudiar Capítulos ({chaptersList.length})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleNavigateTab('quiz')}
                        className="px-3.5 py-2 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <HelpCircle className="w-3.5 h-3.5" />
                        <span>Evaluación ({questions.length})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleNavigateTab('chat')}
                        className="px-3.5 py-2 text-xs font-semibold text-white bg-indigo-950 hover:bg-indigo-900 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
                        <span>Dialogar con el Libro</span>
                      </button>
                    </div>
                  </div>
                </article>

                {/* =============================================================
                    VISUAL CONCEPTUAL MAP / ESQUEMA DE ARQUITECTURA DE LA OBRA
                    ============================================================= */}
                <section className="bg-white border border-stone-200/90 rounded-2xl p-6 sm:p-8 space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-medium text-amber-800 mb-0.5">
                        Esquema Estructural de la Obra
                      </div>
                      <h2 className="text-lg font-bold text-indigo-950">
                        Mapa Conceptual y Distribución de Ejes Temáticos
                      </h2>
                    </div>
                    <span className="text-xs text-stone-500">
                      Haz clic en cualquier eje o capítulo para inspeccionarlo
                    </span>
                  </div>

                  {/* Visual Tree Schema: Central Thesis -> Thematic Axes -> Chapters Flow */}
                  <div className="p-5 sm:p-6 rounded-xl bg-[#FAF7F2] border border-stone-200/80 space-y-6">
                    {/* Level 1: Core Node */}
                    <div className="flex flex-col items-center text-center">
                      <div className="px-4 py-2 rounded-xl bg-indigo-950 text-white text-xs sm:text-sm font-bold max-w-xl">
                        Núcleo de la Obra: {analysis.title}
                      </div>
                      {/* Connecting SVG Stem */}
                      <svg className="w-40 h-7 text-stone-300" viewBox="0 0 160 28" fill="none">
                        <path d="M80 0V14M80 14H20V28M80 14H140V28M80 14V28" stroke="currentColor" strokeWidth="1.75" />
                      </svg>
                    </div>

                    {/* Level 2: Thematic Distribution Bars */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {uniqueCategories.map((cat, idx) => {
                        const count = keyPointsList.filter((kp) => kp.category === cat).length;
                        const pct = Math.max(20, Math.round((count / Math.max(1, keyPointsList.length)) * 100));
                        const palette = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
                        const isSelected = categoryFilter === cat;

                        return (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setCategoryFilter(isSelected ? 'Todas' : cat)}
                            className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-white border-indigo-950 ring-2 ring-indigo-950/10'
                                : `${palette.bg} ${palette.border} hover:bg-white`
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 text-xs font-semibold mb-1.5">
                              <span className={palette.text}>{cat}</span>
                              <span className="font-mono tabular-nums text-stone-600">
                                {count} {count === 1 ? 'idea' : 'ideas'}
                              </span>
                            </div>
                            <div className="w-full h-1.5 bg-white/80 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${palette.bar}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Level 3: Visual Chapter Flow Chain */}
                    {chaptersList.length > 0 && (
                      <div className="pt-4 border-t border-stone-200/80 space-y-3">
                        <div className="text-xs font-semibold text-stone-600 flex items-center justify-between">
                          <span>Secuencia Narrativa de Capítulos</span>
                          <span>Haz clic en un nodo para estudiar el capítulo completo</span>
                        </div>
                        <div className="flex items-center gap-2 overflow-x-auto pb-2">
                          {chaptersList.map((cap, idx) => {
                            const isExplored = Boolean(exploredChapters[idx]);
                            return (
                              <React.Fragment key={`${cap.n}-${idx}`}>
                                <button
                                  type="button"
                                  onClick={() => handleSelectAndExploreChapter(idx, true)}
                                  className={`group px-3.5 py-2.5 rounded-xl border text-left shrink-0 max-w-[200px] transition-colors cursor-pointer ${
                                    isExplored
                                      ? 'bg-emerald-50/70 border-emerald-300 hover:border-emerald-500'
                                      : 'bg-white border-stone-200/90 hover:border-amber-600'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-mono font-bold text-amber-700">
                                      Cap. {cap.n}
                                    </span>
                                    {isExplored && (
                                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                    )}
                                  </div>
                                  <div className="text-xs font-semibold text-indigo-950 truncate group-hover:text-amber-800">
                                    {cap.titulo}
                                  </div>
                                </button>
                                {idx < chaptersList.length - 1 && (
                                  <ArrowRight className="w-4 h-4 text-stone-400 shrink-0" />
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
                <section className="bg-white border border-stone-200/90 rounded-2xl p-6 sm:p-8">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <div>
                      <h2 className="text-lg font-bold text-indigo-950">
                        Ideas Principales Desglosadas
                      </h2>
                      <p className="text-xs text-stone-500 mt-0.5">
                        Argumentos, hallazgos y conceptos fundamentales extraídos de la obra.
                      </p>
                    </div>

                    {/* Interactive Filter Controls */}
                    <div className="flex items-center gap-1 p-1 bg-[#FAF7F2] border border-stone-200/80 rounded-lg overflow-x-auto no-print">
                      {availableCategories.map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setCategoryFilter(cat)}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            categoryFilter === cat
                              ? 'bg-indigo-950 text-white'
                              : 'text-stone-600 hover:text-indigo-950'
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="divide-y divide-stone-200/80">
                    {filteredKeyPoints.map((kp, index) => (
                      <div key={kp.heading} className="py-4 first:pt-0 last:pb-0">
                        <div className="flex items-center gap-2 text-xs text-stone-500 mb-1">
                          <span className="font-mono tabular-nums font-bold text-amber-700">
                            0{index + 1}.
                          </span>
                          <span className="font-medium text-indigo-900">{kp.category}</span>
                        </div>
                        <h3 className="text-base font-bold text-indigo-950 mb-1.5">
                          {kp.heading}
                        </h3>
                        <p className="text-sm text-stone-600 leading-relaxed">{kp.detail}</p>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Objectives & Actionable Takeaways */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <section className="bg-white border border-stone-200/90 rounded-2xl p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Layers className="w-4 h-4 text-amber-700" />
                      <h2 className="text-base font-bold text-indigo-950">
                        Propósitos Centrales del Libro
                      </h2>
                    </div>
                    <ol className="space-y-3 text-sm text-stone-700">
                      {objectivesList.map((obj, idx) => (
                        <li key={idx} className="flex items-start gap-2.5">
                          <span className="font-mono text-xs font-bold text-amber-700 tabular-nums mt-0.5">
                            0{idx + 1}.
                          </span>
                          <span className="leading-relaxed">{obj}</span>
                        </li>
                      ))}
                    </ol>
                  </section>

                  <section className="bg-white border border-stone-200/90 rounded-2xl p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Award className="w-4 h-4 text-emerald-700" />
                      <h2 className="text-base font-bold text-indigo-950">
                        Lecciones Prácticas y Conclusiones
                      </h2>
                    </div>
                    <ul className="space-y-3 text-sm text-stone-700">
                      {conclusionsList.map((conc, idx) => (
                        <li key={idx} className="flex items-start gap-2.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          <span className="leading-relaxed">{conc}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              </div>
            )}

            {/* =================================================================
                VIEW 2: RUTA PROFUNDA DE CAPÍTULOS (90% DEL CONTENIDO) Y CITAS
                ================================================================= */}
            {activeTab === 'explorer' && analysis && (
              <div className="space-y-6">
                {/* Chapter Selector & Deep Content Section */}
                <section className="bg-white border border-stone-200/90 rounded-2xl p-6 sm:p-8">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                    <div>
                      <div className="text-xs font-medium text-amber-800 mb-0.5">
                        Estudio Exhaustivo Capítulo por Capítulo (90% de la Obra)
                      </div>
                      <h2 className="text-xl font-bold text-indigo-950">
                        Ruta de Capítulos — {analysis.title}
                      </h2>
                    </div>
                    <div className="text-xs font-mono tabular-nums text-stone-600 bg-[#FAF7F2] px-3 py-1.5 rounded-lg border border-stone-200/80">
                      Avance: {exploredChaptersCount} / {totalChaptersCount} capítulos ({chapterProgressPercent}%)
                    </div>
                  </div>
                  <p className="text-sm text-stone-600 mb-6">
                    Selecciona cada capítulo para estudiar su desarrollo extenso, conceptos definidos, historias reales, citas y preguntas de aplicación.
                  </p>

                  {chaptersList.length > 0 && activeChapter ? (
                    <>
                      {/* Interactive Chapter Roadmap Nodes with Checkmarks */}
                      <div
                        role="tablist"
                        aria-label="Capítulos del libro"
                        className="flex flex-wrap items-center gap-2 mb-6"
                      >
                        {chaptersList.map((cap, idx) => {
                          const isSelected = idx === activeChapterIdx;
                          const isExplored = Boolean(exploredChapters[idx]);
                          return (
                            <button
                              key={`${cap.n}-${idx}`}
                              type="button"
                              role="tab"
                              aria-selected={isSelected}
                              onClick={() => handleSelectAndExploreChapter(idx, false)}
                              className={`py-2 px-3.5 rounded-xl text-xs font-mono font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                                isSelected
                                  ? 'bg-indigo-950 text-amber-300 shadow-xs'
                                  : isExplored
                                  ? 'bg-emerald-50 text-emerald-900 border border-emerald-300 hover:bg-emerald-100/70'
                                  : 'bg-[#FAF7F2] text-stone-700 border border-stone-200/80 hover:border-amber-500'
                              }`}
                            >
                              {isExplored && (
                                <CheckCircle2
                                  className={`w-3.5 h-3.5 shrink-0 ${
                                    isSelected ? 'text-amber-300' : 'text-emerald-600'
                                  }`}
                                />
                              )}
                              <span>Cap. {cap.n}</span>
                            </button>
                          );
                        })}
                      </div>

                      {/* Selected Chapter Deep Analysis Container */}
                      <div className="border border-stone-200/90 rounded-2xl p-6 sm:p-8 bg-[#FAF7F2] space-y-6">
                        {/* Chapter Header & Controls */}
                        <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-stone-200/80">
                          <div className="space-y-1 max-w-xl">
                            <div className="flex items-center gap-2 text-xs text-amber-800 font-mono font-semibold">
                              <span>
                                Capítulo {activeChapter.n} de {chaptersList.length}
                              </span>
                              {analysis.authorOrSource && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>{analysis.authorOrSource}</span>
                                </>
                              )}
                            </div>
                            <h3 className="text-xl sm:text-2xl font-bold text-indigo-950">
                              {activeChapter.titulo}
                            </h3>
                            {activeChapter.subtitulo && (
                              <p className="text-sm text-stone-600 font-medium">
                                {activeChapter.subtitulo}
                              </p>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleToggleChapterCompleted(activeChapterIdx)}
                              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                                exploredChapters[activeChapterIdx]
                                  ? 'bg-emerald-600 border-emerald-600 text-white'
                                  : 'bg-white border-stone-300 text-stone-700 hover:border-emerald-600'
                              }`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>
                                {exploredChapters[activeChapterIdx]
                                  ? 'Capítulo Completado'
                                  : 'Marcar como completado'}
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
                              className="px-3 py-1.5 text-xs font-medium bg-white border border-stone-200 rounded-lg disabled:opacity-40 hover:bg-stone-100 cursor-pointer"
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
                              className="px-3 py-1.5 text-xs font-medium bg-indigo-950 text-white rounded-lg disabled:opacity-40 hover:bg-indigo-900 cursor-pointer"
                            >
                              Siguiente
                            </button>
                          </div>
                        </div>

                        {/* 1. Core Thesis & Chapter Quote Banner */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                          <div
                            className={`${
                              activeChapter.citaCapitulo ? 'lg:col-span-7' : 'lg:col-span-12'
                            } bg-amber-50/80 border border-amber-200/90 rounded-xl p-5 space-y-2`}
                          >
                            <div className="text-xs font-semibold text-amber-900">
                              Tesis e Idea Rectora del Capítulo
                            </div>
                            <p className="text-sm sm:text-base text-indigo-950 font-semibold leading-relaxed">
                              {activeChapter.idea}
                            </p>
                          </div>

                          {activeChapter.citaCapitulo && (
                            <blockquote className="lg:col-span-5 bg-indigo-950 text-white rounded-xl p-5 flex flex-col justify-between space-y-3">
                              <div className="text-xs font-medium text-amber-300 flex items-center gap-1.5">
                                <Quote className="w-3.5 h-3.5" />
                                <span>Pasaje Clave del Capítulo</span>
                              </div>
                              <p className="text-sm font-medium text-stone-100 italic leading-relaxed">
                                “{activeChapter.citaCapitulo}”
                              </p>
                            </blockquote>
                          )}
                        </div>

                        {/* 2. Deep Multi-Paragraph Analysis (Análisis y Desarrollo Exhaustivo) */}
                        {activeChapter.analisisDetallado && (
                          <div className="bg-white border border-stone-200/90 rounded-xl p-6 space-y-3">
                            <div className="flex items-center gap-2 text-xs font-semibold text-indigo-950">
                              <BookOpen className="w-4 h-4 text-amber-700" />
                              <span>Análisis Exhaustivo y Desarrollo del Capítulo</span>
                            </div>
                            <div className="space-y-3 text-sm sm:text-base text-stone-700 leading-relaxed">
                              {activeChapter.analisisDetallado
                                .split('\n\n')
                                .map((para, pIdx) => (
                                  <p key={pIdx}>{para}</p>
                                ))}
                            </div>
                          </div>
                        )}

                        {/* 3. Real Stories, Case Studies & Examples */}
                        <div className="bg-white border border-stone-200/90 rounded-xl p-6 space-y-2">
                          <div className="text-xs font-semibold text-amber-800">
                            Casos de Estudio, Ejemplos Prácticos y Contexto Narrativo
                          </div>
                          <div className="space-y-2.5 text-sm text-stone-700 leading-relaxed">
                            {(activeChapter.historia || '').split('\n\n').map((para, hIdx) => (
                              <p key={hIdx}>{para}</p>
                            ))}
                          </div>
                        </div>

                        {/* 4. Key Concepts & Definitions of the Chapter */}
                        {Array.isArray(activeChapter.conceptosClave) &&
                          activeChapter.conceptosClave.length > 0 && (
                            <div className="bg-white border border-stone-200/90 rounded-xl p-6 space-y-4">
                              <div className="text-xs font-semibold text-indigo-950">
                                Conceptos, Marcos y Definiciones Clave del Capítulo
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                {activeChapter.conceptosClave.map((concepto, kIdx) => (
                                  <div
                                    key={kIdx}
                                    className="p-4 rounded-xl bg-[#FAF7F2] border border-stone-200/80 space-y-1"
                                  >
                                    <div className="text-sm font-bold text-indigo-950">
                                      {concepto.termino}
                                    </div>
                                    <p className="text-xs text-stone-600 leading-relaxed">
                                      {concepto.definicion}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                        {/* 5. Practical Takeaways & Action Rules */}
                        {Array.isArray(activeChapter.consejos) && activeChapter.consejos.length > 0 && (
                          <div className="bg-white border border-stone-200/90 rounded-xl p-6 space-y-3.5">
                            <div className="text-xs font-semibold text-indigo-950">
                              Lecciones Prácticas y Reglas de Acción del Capítulo
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {activeChapter.consejos.map((consejo, cIdx) => (
                                <div
                                  key={cIdx}
                                  className="p-3.5 rounded-lg bg-[#FAF7F2] border border-stone-200/70 flex items-start gap-2.5 text-sm text-stone-700"
                                >
                                  <span className="font-mono text-xs font-bold text-amber-700 tabular-nums mt-0.5">
                                    0{cIdx + 1}.
                                  </span>
                                  <span className="leading-relaxed">{consejo}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 6. MODULE: ADAPTACIÓN DEL CAPÍTULO A CASO DE LA VIDA REAL / MUNDO ACTUAL */}
                        <div className="bg-white border-2 border-indigo-950/15 rounded-2xl overflow-hidden">
                          {/* Module Header Banner */}
                          <div className="bg-indigo-950 text-white p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                                <Briefcase className="w-4 h-4" />
                                <span>Módulo de Aplicación al Mundo Actual · Negocios, Liderazgo y Empresa</span>
                              </div>
                              <h4 className="text-lg font-bold text-white">
                                Adaptación del Capítulo {activeChapter.n} a un Caso Real de Hoy
                              </h4>
                              <p className="text-xs text-stone-300">
                                Selecciona un ámbito empresarial o describe tu propio caso para traducir las enseñanzas de este capítulo en un plan ejecutivo actual.
                              </p>
                            </div>
                          </div>

                          <div className="p-5 sm:p-6 space-y-5 bg-[#FAF7F2]/60">
                            {/* Interactive Domain Selector Pills */}
                            <div className="space-y-2">
                              <label className="block text-xs font-semibold text-indigo-950">
                                1. Elige el ámbito del mundo actual para adaptar este capítulo:
                              </label>
                              <div className="flex flex-wrap items-center gap-2">
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
                                      className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                                        isSelected
                                          ? 'bg-indigo-950 text-amber-300 font-semibold'
                                          : 'bg-white border border-stone-200/90 text-stone-700 hover:border-amber-600 hover:text-indigo-950'
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
                                placeholder="Opcional: Describe tu empresa, equipo, industria o reto real (ej. 'Lidero un equipo comercial de 12 personas en una empresa tecnológica')..."
                                className="flex-1 px-4 py-2.5 text-xs sm:text-sm bg-white border border-stone-300 rounded-xl focus:outline-none focus:border-amber-600"
                              />
                              <button
                                type="button"
                                disabled={isAdaptingChapter}
                                onClick={() => handleAdaptChapterToRealWorld()}
                                className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
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
                                  <div className="p-5 rounded-xl bg-white border border-stone-200/90 text-center space-y-3">
                                    <p className="text-xs sm:text-sm text-stone-600">
                                      Haz clic en cualquiera de los ámbitos superiores o en <strong>Adaptar a Caso Real</strong> para generar el caso práctico de negocios, liderazgo o empresa de este capítulo.
                                    </p>
                                  </div>
                                );
                              }

                              return (
                                <div className="bg-white border border-stone-200/90 rounded-xl p-5 sm:p-6 space-y-5">
                                  <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-stone-200/80">
                                    <div>
                                      <div className="text-xs font-mono font-semibold text-amber-800">
                                        Ámbito Aplicado: {activeAdaptation.ambito}
                                      </div>
                                      <h5 className="text-base sm:text-lg font-bold text-indigo-950 mt-0.5">
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
                                      className="px-3 py-1.5 bg-indigo-950 hover:bg-indigo-900 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                                    >
                                      <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
                                      <span>Simular Caso en el Chat</span>
                                    </button>
                                  </div>

                                  {/* Scenario & Book Parallel Grid */}
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="p-4 rounded-xl bg-[#FAF7F2] border border-stone-200/80 space-y-1.5">
                                      <div className="text-xs font-bold text-indigo-950">
                                        Escenario en el Mundo Actual / Empresa
                                      </div>
                                      <p className="text-xs sm:text-sm text-stone-700 leading-relaxed">
                                        {activeAdaptation.escenarioActual}
                                      </p>
                                    </div>

                                    <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200/80 space-y-1.5">
                                      <div className="text-xs font-bold text-amber-950">
                                        Paralelo Estratégico con el Capítulo {activeChapter.n}
                                      </div>
                                      <p className="text-xs sm:text-sm text-stone-800 leading-relaxed">
                                        {activeAdaptation.paraleloConElLibro}
                                      </p>
                                    </div>
                                  </div>

                                  {/* Step-by-Step Executive Action Plan */}
                                  {Array.isArray(activeAdaptation.planDeAccion) &&
                                    activeAdaptation.planDeAccion.length > 0 && (
                                      <div className="space-y-2.5">
                                        <div className="text-xs font-bold text-indigo-950">
                                          Plan de Acción Ejecutivo para Implementar Hoy:
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                          {activeAdaptation.planDeAccion.map((paso, stepIdx) => (
                                            <div
                                              key={stepIdx}
                                              className="p-3.5 rounded-xl bg-[#FAF7F2] border border-stone-200/80 flex items-start gap-2.5 text-xs sm:text-sm text-stone-700"
                                            >
                                              <span className="font-mono text-xs font-bold text-amber-700 tabular-nums mt-0.5">
                                                Paso 0{stepIdx + 1}.
                                              </span>
                                              <span className="leading-relaxed">{paso}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                  {/* Pitfall to Avoid & Success KPI */}
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                                    {activeAdaptation.errorComunEvitar && (
                                      <div className="p-3.5 rounded-xl bg-rose-50/80 border border-rose-200 text-xs space-y-1">
                                        <div className="font-bold text-rose-950 flex items-center gap-1.5">
                                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                          <span>Error Común a Evitar en Empresas y Equipos</span>
                                        </div>
                                        <p className="text-rose-900 leading-relaxed">
                                          {activeAdaptation.errorComunEvitar}
                                        </p>
                                      </div>
                                    )}

                                    {activeAdaptation.indicadorExito && (
                                      <div className="p-3.5 rounded-xl bg-emerald-50/80 border border-emerald-200 text-xs space-y-1">
                                        <div className="font-bold text-emerald-950 flex items-center gap-1.5">
                                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                          <span>Indicador de Éxito / Métrica en la Vida Real</span>
                                        </div>
                                        <p className="text-emerald-900 leading-relaxed">
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
                            <div className="bg-amber-50/60 border border-amber-200/80 rounded-xl p-5 space-y-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 text-xs font-semibold text-amber-950">
                                  <Sparkles className="w-4 h-4 text-amber-700" />
                                  <span>Preguntas de Aplicación y Reflexión de este Capítulo</span>
                                </div>
                                <span className="text-xs text-stone-500">
                                  Haz clic para debatirlas con el asistente
                                </span>
                              </div>
                              <div className="space-y-2">
                                {activeChapter.preguntasReflexion.map((preg, pIdx) => (
                                  <div
                                    key={pIdx}
                                    className="p-3.5 rounded-lg bg-white border border-amber-200/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                                  >
                                    <p className="text-xs sm:text-sm font-medium text-indigo-950 leading-relaxed">
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
                                      className="px-3 py-1.5 bg-indigo-950 hover:bg-indigo-900 text-white text-xs font-semibold rounded-lg shrink-0 cursor-pointer whitespace-nowrap"
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
                    <div className="p-6 text-center bg-[#FAF7F2] rounded-xl border border-stone-200 text-sm text-stone-600">
                      Haz clic en "Re-analizar obra" para extraer el desglose profundo por capítulos de este libro.
                    </div>
                  )}
                </section>

                {/* Editorial Quotes Gallery */}
                {quotesList.length > 0 && (
                  <section className="bg-white border border-stone-200/90 rounded-2xl p-6 sm:p-8">
                    <div className="flex items-center gap-2 mb-1">
                      <Quote className="w-4 h-4 text-amber-700" />
                      <h2 className="text-lg font-bold text-indigo-950">
                        Pasajes y Citas Memorables
                      </h2>
                    </div>
                    <p className="text-xs text-stone-500 mb-5">
                      Frases destacadas extraídas de las páginas del libro.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {quotesList.map((q, idx) => (
                        <blockquote
                          key={idx}
                          className="p-5 rounded-xl bg-[#FAF7F2] border border-stone-200/90 flex flex-col justify-between space-y-3"
                        >
                          <p className="text-sm sm:text-base font-semibold text-indigo-950 leading-relaxed">
                            “{q.texto}”
                          </p>
                          <cite className="text-xs text-amber-800 font-medium not-italic">
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
                VIEW 3: EVALUACIÓN DE LECTURA CON MEDIDOR VISUAL
                ================================================================= */}
            {activeTab === 'quiz' && (
              <div className="space-y-6">
                {/* Quiz Configuration & Visual Mastery Gauge Header */}
                <section className="bg-white border border-stone-200/90 rounded-2xl p-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-5 border-b border-stone-200/80">
                    <div>
                      <div className="text-xs font-medium text-amber-800 mb-0.5">
                        Comprobación de Lectura
                      </div>
                      <h2 className="text-xl font-bold text-indigo-950">
                        Evaluación Interactiva del Libro
                      </h2>
                      <p className="text-xs text-stone-500 mt-0.5">
                        Responde preguntas de opción múltiple y preguntas abiertas calificadas en vivo.
                      </p>
                    </div>

                    {/* Visual Radial Mastery Ring & Score Counter */}
                    <div className="flex items-center gap-4 shrink-0 bg-[#FAF7F2] border border-stone-200/80 rounded-xl px-4 py-3">
                      <svg className="w-12 h-12 -rotate-90 shrink-0" viewBox="0 0 36 36">
                        <circle
                          cx="18"
                          cy="18"
                          r="15"
                          fill="none"
                          stroke="#e7e5e4"
                          strokeWidth="3.5"
                        />
                        <circle
                          cx="18"
                          cy="18"
                          r="15"
                          fill="none"
                          stroke="#d97706"
                          strokeWidth="3.5"
                          strokeDasharray={`${masteryPercent} 100`}
                          strokeLinecap="round"
                        />
                      </svg>
                      <div>
                        <div className="text-xs text-stone-500">Dominio Actual</div>
                        <div className="text-base font-bold text-indigo-950 font-mono tabular-nums">
                          {totalCorrect} / {totalQuestions} aciertos ({masteryPercent}%)
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
                          className="px-3 py-1.5 text-xs font-medium text-stone-700 bg-white border border-stone-200 hover:bg-stone-100 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
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
                        <span className="text-stone-500 font-medium">Dificultad:</span>
                        <div className="flex items-center gap-1 p-1 bg-[#FAF7F2] border border-stone-200/80 rounded-lg">
                          {(['Básico', 'Intermedio', 'Avanzado'] as const).map((level) => (
                            <button
                              key={level}
                              type="button"
                              onClick={() => setQuizDifficulty(level)}
                              className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                                quizDifficulty === level
                                  ? 'bg-indigo-950 text-white'
                                  : 'text-stone-600 hover:text-indigo-950'
                              }`}
                            >
                              {level}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-stone-500 font-medium">Formato:</span>
                        <select
                          value={quizMode}
                          onChange={(e) =>
                            setQuizMode(e.target.value as 'mixed' | 'multiple_choice' | 'open')
                          }
                          className="px-2.5 py-1.5 bg-[#FAF7F2] border border-stone-200 rounded-lg text-stone-800 font-medium focus:outline-none"
                        >
                          <option value="mixed">Mixto (Múltiple + Abierta)</option>
                          <option value="multiple_choice">Solo Opción Múltiple</option>
                          <option value="open">Solo Respuesta Abierta</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-stone-500 font-medium">Cantidad:</span>
                        <select
                          value={quizCount}
                          onChange={(e) => setQuizCount(Number(e.target.value))}
                          className="px-2.5 py-1.5 bg-[#FAF7F2] border border-stone-200 rounded-lg text-stone-800 font-mono tabular-nums focus:outline-none"
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
                      className="px-4 py-2 bg-indigo-950 hover:bg-indigo-900 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${loadingMessage ? 'animate-spin' : ''}`} />
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
                          className="bg-white border border-stone-200/90 rounded-2xl p-6 space-y-4"
                        >
                          <div className="flex items-center justify-between text-xs text-stone-500">
                            <span>
                              Pregunta <span className="font-mono tabular-nums font-bold text-amber-700">0{idx + 1}</span> ·
                              Opción Múltiple
                            </span>
                            {hasAnswered && (
                              <span
                                className={`font-semibold flex items-center gap-1 ${
                                  isCorrect ? 'text-emerald-700' : 'text-rose-700'
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

                          <h3 className="text-base font-bold text-indigo-950 leading-snug">
                            {q.question}
                          </h3>

                          <div className="space-y-2">
                            {(q.options || []).map((opt, optIdx) => {
                              const isThisSelected = userChoice === optIdx;
                              const isThisCorrect = q.correctIndex === optIdx;

                              let optionClasses =
                                'border-stone-200/90 hover:border-amber-500 bg-[#FAF7F2]/60 text-stone-800';
                              if (hasAnswered) {
                                if (isThisCorrect) {
                                  optionClasses =
                                    'border-emerald-600 bg-emerald-50/90 text-emerald-950 font-medium';
                                } else if (isThisSelected) {
                                  optionClasses = 'border-rose-500 bg-rose-50/90 text-rose-950';
                                } else {
                                  optionClasses = 'border-stone-200 bg-stone-50/50 text-stone-400';
                                }
                              }

                              return (
                                <button
                                  key={optIdx}
                                  type="button"
                                  onClick={() =>
                                    setSelectedOptions((prev) => ({ ...prev, [q.id]: optIdx }))
                                  }
                                  className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors flex items-start justify-between gap-3 cursor-pointer ${optionClasses}`}
                                >
                                  <div className="flex items-start gap-2.5">
                                    <span className="font-mono text-xs font-bold mt-0.5 tabular-nums text-amber-800">
                                      {String.fromCharCode(65 + optIdx)}.
                                    </span>
                                    <span>{opt}</span>
                                  </div>
                                  {hasAnswered && isThisCorrect && (
                                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                                  )}
                                  {hasAnswered && isThisSelected && !isThisCorrect && (
                                    <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                                  )}
                                </button>
                              );
                            })}
                          </div>

                          {hasAnswered && (
                            <div className="p-4 rounded-xl bg-[#FAF7F2] border border-stone-200/90 text-xs text-stone-700 space-y-1.5">
                              <div className="font-bold text-indigo-950">
                                Explicación fundamentada en el libro:
                              </div>
                              <p className="leading-relaxed">{q.explanation}</p>
                              {q.referenceQuote && (
                                <p className="text-amber-900 italic pt-1">{q.referenceQuote}</p>
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
                        className="bg-white border border-stone-200/90 rounded-2xl p-6 space-y-4"
                      >
                        <div className="flex items-center justify-between text-xs text-stone-500">
                          <span>
                            Pregunta <span className="font-mono tabular-nums font-bold text-amber-700">0{idx + 1}</span> ·
                            Respuesta Abierta
                          </span>
                          {evaluation && (
                            <span
                              className={`font-semibold font-mono tabular-nums flex items-center gap-1 ${
                                evaluation.isCorrect ? 'text-emerald-700' : 'text-amber-700'
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

                        <h3 className="text-base font-bold text-indigo-950 leading-snug">
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
                            className="w-full p-3.5 text-sm border border-stone-300 rounded-xl focus:outline-none focus:border-amber-600 bg-[#FAF7F2]/60"
                          />

                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs text-stone-500">
                              Puntos esperados: {(q.rubricKeyPoints || []).join(' · ')}
                            </span>
                            <button
                              type="button"
                              disabled={isEvaluatingThis}
                              onClick={() => handleEvaluateOpenQuestion(q)}
                              className="px-4 py-2 bg-indigo-950 hover:bg-indigo-900 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                            >
                              {isEvaluatingThis ? (
                                <>
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                                  <span>Revisando respuesta...</span>
                                </>
                              ) : (
                                <span>Calificar Respuesta</span>
                              )}
                            </button>
                          </div>
                        </div>

                        {evaluation && (
                          <div className="p-4 rounded-xl bg-[#FAF7F2] border border-stone-200/90 text-xs text-stone-700 space-y-2">
                            <div className="flex items-center justify-between font-bold text-indigo-950">
                              <span>
                                {evaluation.isCorrect
                                  ? 'Excelente comprensión del libro'
                                  : 'Respuesta parcial — Puede profundizarse'}
                              </span>
                              <span className="font-mono tabular-nums text-amber-800">
                                {evaluation.score} / 100
                              </span>
                            </div>
                            <p className="leading-relaxed">{evaluation.feedback}</p>
                            {evaluation.missingConcepts && evaluation.missingConcepts.length > 0 && (
                              <div>
                                <span className="font-semibold text-stone-800">
                                  Ideas complementarias del libro:{' '}
                                </span>
                                <span>{evaluation.missingConcepts.join('; ')}</span>
                              </div>
                            )}
                            <div className="pt-2 border-t border-stone-200/80 text-stone-600">
                              <span className="font-semibold text-stone-800">Síntesis modelo: </span>
                              {q.explanation}
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>
            )}

            {/* =================================================================
                VIEW 4: DIALOGAR CON EL LIBRO (ASISTENTE)
                ================================================================= */}
            {activeTab === 'chat' && analysis && (
              <section className="bg-white border border-stone-200/90 rounded-2xl flex flex-col h-[680px]">
                {/* Chat Header */}
                <div className="p-5 border-b border-stone-200/80 flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-bold text-indigo-950">
                      Dialogar con el Libro
                    </h2>
                    <p className="text-xs text-stone-500 mt-0.5">
                      Respuestas fundamentadas en las páginas de{' '}
                      <span className="font-semibold text-stone-800">{analysis.title}</span>.
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
                    className="px-3 py-1.5 text-xs font-medium text-stone-600 hover:text-indigo-950 bg-[#FAF7F2] hover:bg-stone-200/70 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Limpiar Conversación
                  </button>
                </div>

                {/* Suggested Contextual Questions */}
                {suggestedQuestionsList.length > 0 && (
                  <div className="px-5 py-3 bg-[#FAF7F2] border-b border-stone-200/80 flex items-center gap-2 overflow-x-auto">
                    <span className="text-xs font-medium text-amber-800 shrink-0">Sugerencias:</span>
                    {suggestedQuestionsList.map((sq, idx) => (
                      <button
                        key={idx}
                        type="button"
                        disabled={isChatLoading}
                        onClick={() => handleSendChatQuestion(sq)}
                        className="px-3 py-1 text-xs bg-white hover:bg-amber-50 text-stone-700 hover:text-indigo-950 border border-stone-200/90 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {sq}
                      </button>
                    ))}
                  </div>
                )}

                {/* Chat Messages Viewport */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  {chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl p-4 text-sm space-y-2 ${
                          msg.role === 'user'
                            ? 'bg-indigo-950 text-white'
                            : 'bg-[#FAF7F2] text-stone-800 border border-stone-200/90'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4 text-xs opacity-75">
                          <span className="font-semibold">
                            {msg.role === 'user' ? 'Tú' : 'Asistente del Libro'}
                          </span>
                          {msg.groundingStatus && (
                            <span>
                              {msg.groundingStatus} · {msg.timestamp}
                            </span>
                          )}
                        </div>

                        <div className="leading-relaxed whitespace-pre-wrap">{msg.content}</div>

                        {msg.citations && msg.citations.length > 0 && (
                          <div className="pt-2 mt-2 border-t border-stone-200/80 space-y-1 text-xs text-stone-600">
                            <div className="font-semibold text-amber-900">
                              Pasajes relacionados en la obra:
                            </div>
                            {msg.citations.map((cit, cIdx) => (
                              <p key={cIdx} className="italic">
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
                      <div className="bg-[#FAF7F2] border border-stone-200 rounded-xl px-4 py-3 text-xs text-stone-700 flex items-center gap-2.5">
                        <RefreshCw className="w-3.5 h-3.5 text-amber-700 animate-spin" />
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
                  className="p-4 border-t border-stone-200/80 flex items-center gap-3"
                >
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    disabled={isChatLoading}
                    placeholder="Escribe una pregunta sobre el libro, un capítulo o una idea..."
                    className="flex-1 px-4 py-2.5 text-sm border border-stone-300 rounded-xl focus:outline-none focus:border-amber-600 bg-[#FAF7F2]/50"
                  />
                  <button
                    type="submit"
                    disabled={isChatLoading || !chatInput.trim()}
                    className="px-5 py-2.5 bg-indigo-950 hover:bg-indigo-900 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5 text-amber-400" />
                    <span>Enviar</span>
                  </button>
                </form>
              </section>
            )}
          </section>
        </main>
      )}

      {/* =====================================================================
          MODAL: PEGAR TEXTO DE UN LIBRO MANUALMENTE
          ===================================================================== */}
      {showManualTextModal && (
        <div className="fixed inset-0 z-50 bg-indigo-950/50 backdrop-blur-xs flex items-center justify-center p-4 no-print">
          <div className="bg-white border border-stone-200 rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-amber-700" />
                <h3 className="text-base font-bold text-indigo-950">
                  Pegar Contenido de un Libro
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowManualTextModal(false)}
                className="text-xs text-stone-500 hover:text-indigo-950 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
            <p className="text-xs text-stone-500">
              Introduce el título y pega el texto o los capítulos del libro que deseas analizar.
            </p>
            <input
              type="text"
              value={manualTitleDraft}
              onChange={(e) => setManualTitleDraft(e.target.value)}
              placeholder="Título del libro"
              className="w-full px-3.5 py-2.5 text-sm border border-stone-300 rounded-xl focus:outline-none focus:border-amber-600"
            />
            <textarea
              rows={9}
              value={manualTextDraft}
              onChange={(e) => setManualTextDraft(e.target.value)}
              placeholder="Pega aquí el texto o capítulos del libro..."
              className="w-full p-3.5 text-sm border border-stone-300 rounded-xl focus:outline-none focus:border-amber-600"
            />
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowManualTextModal(false)}
                className="px-4 py-2 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg cursor-pointer"
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
                  setFileName(customName);
                  setDocumentText(manualTextDraft.trim());
                  setPageCount(Math.max(1, Math.ceil(manualTextDraft.length / 2500)));
                  setShowManualTextModal(false);
                  await runFullAiPipeline(manualTextDraft.trim(), customName);
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-950 hover:bg-indigo-900 rounded-lg cursor-pointer"
              >
                Analizar Libro
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quiet Editorial Footer */}
      <footer className="bg-white border-t border-stone-200/90 px-6 py-4 text-xs text-stone-500 flex flex-wrap items-center justify-between gap-4 no-print">
        <div>LecturaViva · Estudio Visual de Análisis de Libros y Mapas de Lectura</div>
        {hasLoadedBook && (
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleExportMarkdown}
              className="hover:text-indigo-950 underline underline-offset-4 cursor-pointer"
            >
              Descargar guía de lectura completa
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}
