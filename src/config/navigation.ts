export type ActiveTab =
  | 'summary'
  | 'explorer'
  | 'principles'
  | 'quiz'
  | 'chat';

export type FutureExtensionSlotId = never;

export interface NavSectionItem {
  id: ActiveTab;
  label: string;
  shortLabel: string;
  description: string;
}

export interface FutureNavSlot {
  id: string;
  label: string;
  shortLabel: string;
  plannedStage: string;
  enabled: false;
}

export const PRIMARY_NAV_SECTIONS: readonly NavSectionItem[] = [
  {
    id: 'summary',
    label: 'Mapa y Resumen',
    shortLabel: 'Resumen',
    description: 'Síntesis global, progreso de lectura y arquitectura del libro.',
  },
  {
    id: 'explorer',
    label: 'Ruta de Capítulos',
    shortLabel: 'Capítulos',
    description: 'Estudio profundo capítulo por capítulo con conceptos, casos y aplicación.',
  },
  {
    id: 'principles',
    label: 'Principios y Cifras Clave',
    shortLabel: 'Principios',
    description: 'Leyes, métricas, objetivos centrales e ideas fundamentales de la obra.',
  },
  {
    id: 'quiz',
    label: 'Evaluación Interactiva',
    shortLabel: 'Evaluación',
    description: 'Evaluación por capítulo, evaluación integral multi-capítulo y seguimiento del aprendizaje.',
  },
  {
    id: 'chat',
    label: 'Dialogar con el Libro',
    shortLabel: 'Diálogo',
    description: 'Consultas en lenguaje natural con pasajes respaldados del documento.',
  },
] as const;

export const UPCOMING_NAV_SLOTS: readonly FutureNavSlot[] = [] as const;
