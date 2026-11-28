export type ThemeMode = 'light' | 'dark';

export type ReadingFontId =
  | 'inter'
  | 'open-sans'
  | 'roboto'
  | 'lato'
  | 'merriweather'
  | 'georgia';

export interface ReadingFontOption {
  id: ReadingFontId;
  name: string;
  category: 'Sans-serif' | 'Serif';
  cssFamily: string;
  description: string;
  previewText: string;
}

export interface ReadingPreferences {
  theme: ThemeMode;
  fontId: ReadingFontId;
  fontScale: number;
}

export const READING_PREFS_STORAGE_KEY = 'lecturaviva_reading_prefs_v1';

export const FONT_SCALE_STEPS: readonly number[] = [0.85, 0.92, 1.0, 1.1, 1.2, 1.3, 1.4];
export const MIN_FONT_SCALE = FONT_SCALE_STEPS[0];
export const MAX_FONT_SCALE = FONT_SCALE_STEPS[FONT_SCALE_STEPS.length - 1];

export const READING_FONTS: readonly ReadingFontOption[] = [
  {
    id: 'inter',
    name: 'Inter',
    category: 'Sans-serif',
    cssFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    description: 'Nítida y moderna, optimizada para lectura prolongada en pantalla.',
    previewText: 'La lectura profunda transforma la información en criterio duradero.',
  },
  {
    id: 'open-sans',
    name: 'Open Sans',
    category: 'Sans-serif',
    cssFamily: "'Open Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    description: 'Humanista y abierta, excelente claridad en párrafos densos.',
    previewText: 'La lectura profunda transforma la información en criterio duradero.',
  },
  {
    id: 'roboto',
    name: 'Roboto',
    category: 'Sans-serif',
    cssFamily: "'Roboto', -apple-system, BlinkMacSystemFont, sans-serif",
    description: 'Geométrica y equilibrada, ritmo ágil para estudio estructurado.',
    previewText: 'La lectura profunda transforma la información en criterio duradero.',
  },
  {
    id: 'lato',
    name: 'Lato',
    category: 'Sans-serif',
    cssFamily: "'Lato', -apple-system, BlinkMacSystemFont, sans-serif",
    description: 'Cálida y profesional, gran confort visual en textos ejecutivos.',
    previewText: 'La lectura profunda transforma la información en criterio duradero.',
  },
  {
    id: 'merriweather',
    name: 'Merriweather',
    category: 'Serif',
    cssFamily: "'Merriweather', Georgia, serif",
    description: 'Editorial clásica de alta legibilidad, diseñada para libros digitales.',
    previewText: 'La lectura profunda transforma la información en criterio duradero.',
  },
  {
    id: 'georgia',
    name: 'Georgia',
    category: 'Serif',
    cssFamily: "Georgia, 'Times New Roman', serif",
    description: 'Elegancia literaria atemporal con serifa firme y pausada.',
    previewText: 'La lectura profunda transforma la información en criterio duradero.',
  },
] as const;

export const DEFAULT_READING_PREFERENCES: ReadingPreferences = {
  theme: 'light',
  fontId: 'lato',
  fontScale: 1.0,
};

export function getReadingFontById(fontId: string): ReadingFontOption {
  return READING_FONTS.find((f) => f.id === fontId) || READING_FONTS[3];
}

export function clampFontScale(value: number): number {
  if (!Number.isFinite(value)) return 1.0;
  const clamped = Math.max(MIN_FONT_SCALE, Math.min(MAX_FONT_SCALE, value));
  return Math.round(clamped * 100) / 100;
}

export function stepFontScale(current: number, direction: 'decrease' | 'increase'): number {
  const safe = clampFontScale(current);
  if (direction === 'increase') {
    const next = FONT_SCALE_STEPS.find((s) => s > safe + 0.005);
    return next ?? MAX_FONT_SCALE;
  }
  const reversed = [...FONT_SCALE_STEPS].reverse();
  const prev = reversed.find((s) => s < safe - 0.005);
  return prev ?? MIN_FONT_SCALE;
}

export function loadReadingPreferences(): ReadingPreferences {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_READING_PREFERENCES };
  }
  try {
    const raw = window.localStorage.getItem(READING_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_READING_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<ReadingPreferences>;
    const theme: ThemeMode = parsed.theme === 'dark' ? 'dark' : 'light';
    const fontValid = READING_FONTS.some((f) => f.id === parsed.fontId);
    const fontId: ReadingFontId = fontValid
      ? (parsed.fontId as ReadingFontId)
      : DEFAULT_READING_PREFERENCES.fontId;
    const fontScale =
      typeof parsed.fontScale === 'number'
        ? clampFontScale(parsed.fontScale)
        : DEFAULT_READING_PREFERENCES.fontScale;
    return { theme, fontId, fontScale };
  } catch {
    return { ...DEFAULT_READING_PREFERENCES };
  }
}

export function saveReadingPreferences(prefs: ReadingPreferences): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(READING_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota / private mode failures gracefully
  }
}

export function applyReadingPreferencesToDom(prefs: ReadingPreferences): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const isDark = prefs.theme === 'dark';
  root.classList.toggle('dark', isDark);

  const fontOption = getReadingFontById(prefs.fontId);
  root.style.setProperty('--reading-font-family', fontOption.cssFamily);
  root.style.setProperty('--reading-scale', String(clampFontScale(prefs.fontScale)));

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', isDark ? '#0b1120' : '#f8fafc');
  }
}
