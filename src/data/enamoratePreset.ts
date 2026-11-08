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
