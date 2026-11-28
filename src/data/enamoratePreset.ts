export interface KeyPointItem {
  heading: string;
  detail: string;
  category: string;
}

export interface KeyMetricItem {
  label: string;
  value: string;
  context: string;
}

export interface ChapterConceptItem {
  termino: string;
  definicion: string;
}

export interface RealWorldAdaptationItem {
  ambito: string;
  tituloCaso: string;
  escenarioActual: string;
  paraleloConElLibro: string;
  planDeAccion: string[];
  errorComunEvitar: string;
  indicadorExito: string;
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  charCount: number;
  isReadable: boolean;
  headings: string[];
}

export interface PdfOutlineItem {
  title: string;
  pageNumber: number;
  level: number;
}

export type StructureDetectionMethod =
  | 'pdf_outline'
  | 'heading_detection'
  | 'ai_structure'
  | 'page_blocks';

export interface ChapterSegment {
  n: string;
  titulo: string;
  startPage: number;
  endPage: number;
  charCount: number;
  readablePagesCount: number;
  source: StructureDetectionMethod;
}

export interface CoverageReport {
  totalPages: number;
  readablePages: number;
  unreadablePages: number[];
  coveredPages: number;
  uncoveredReadablePages: number[];
  detectedChapters: number;
  processedChapters: number;
  failedChapters: number;
  pendingChapters: number;
  realCoveragePercent: number;
  readableCoveragePercent: number;
  detectionMethod: StructureDetectionMethod;
  hasFullCoverage: boolean;
  warnings: string[];
}

export interface ChapterItem {
  n: string;
  titulo: string;
  subtitulo?: string;
  idea: string;
  analisisDetallado?: string;
  historia: string;
  conceptosClave?: ChapterConceptItem[];
  citaCapitulo?: string;
  consejos: string[];
  preguntasReflexion?: string[];
  adaptacionMundoActual?: RealWorldAdaptationItem;
  startPage?: number;
  endPage?: number;
  charCount?: number;
  status?: 'pending' | 'processing' | 'completed' | 'error';
  errorMessage?: string;
  wasChunked?: boolean;
  finishReason?: string;
}

export interface QuoteItem {
  texto: string;
  autor: string;
}

export interface DocumentAnalysis {
  title: string;
  authorOrSource?: string;
  executiveSummary: string;
  objectives: string[];
  keyPoints: KeyPointItem[];
  keyMetrics: KeyMetricItem[];
  chapters: ChapterItem[];
  quotes: QuoteItem[];
  conclusions: string[];
  suggestedQuestions: string[];
  coverageReport?: CoverageReport;
}

export interface QuizQuestion {
  id: string;
  type: 'multiple_choice' | 'open';
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  referenceQuote: string;
  rubricKeyPoints: string[];
}
