import React, { useState, useEffect, useRef } from 'react';
import {
  Sun,
  Moon,
  Type,
  Check,
  RotateCcw,
  X,
} from 'lucide-react';
import {
  DEFAULT_READING_PREFERENCES,
  MAX_FONT_SCALE,
  MIN_FONT_SCALE,
  READING_FONTS,
  ReadingFontId,
  ReadingPreferences,
  getReadingFontById,
  stepFontScale,
} from '../utils/readingPreferences';

interface ReadingSettingsPanelProps {
  preferences: ReadingPreferences;
  onChange: (next: ReadingPreferences) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function ReadingSettingsModal({
  preferences,
  onChange,
  isOpen,
  onClose,
}: ReadingSettingsPanelProps) {
  const [hoveredFontId, setHoveredFontId] = useState<ReadingFontId | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setHoveredFontId(null);
      return;
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const activeFont = getReadingFontById(preferences.fontId);
  const previewFont = hoveredFontId ? getReadingFontById(hoveredFontId) : activeFont;
  const scalePercent = Math.round(preferences.fontScale * 100);
  const canDecrease = preferences.fontScale > MIN_FONT_SCALE + 0.005;
  const canIncrease = preferences.fontScale < MAX_FONT_SCALE - 0.005;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/55 dark:bg-black/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 no-print"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Personalización de lectura"
    >
      <div
        ref={panelRef}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-t-2xl sm:rounded-2xl max-w-2xl w-full max-h-[90dvh] overflow-y-auto shadow-xl safe-area-pb"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/95 dark:bg-slate-900/95 backdrop-blur px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0">
              <Type className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
                Personalización de Lectura
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Tus preferencias se guardan automáticamente en este dispositivo.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar panel de personalización"
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* 1. Theme & Font Size Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Appearance / Dark Mode */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 space-y-2.5">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Apariencia de la Interfaz
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onChange({ ...preferences, theme: 'light' })}
                  className={`py-2.5 px-3 rounded-lg text-xs font-semibold border transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                    preferences.theme === 'light'
                      ? 'bg-blue-700 border-blue-700 text-white shadow-xs'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-blue-500'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5" />
                  <span>Modo Claro</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ ...preferences, theme: 'dark' })}
                  className={`py-2.5 px-3 rounded-lg text-xs font-semibold border transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                    preferences.theme === 'dark'
                      ? 'bg-blue-600 border-blue-500 text-white shadow-xs'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-blue-500'
                  }`}
                >
                  <Moon className="w-3.5 h-3.5" />
                  <span>Modo Oscuro</span>
                </button>
              </div>
            </div>

            {/* Font Size Scale A- / A+ */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Tamaño de Lectura
                </span>
                <span className="font-mono font-bold tabular-nums text-orange-600 dark:text-orange-400">
                  {scalePercent}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!canDecrease}
                  onClick={() =>
                    onChange({
                      ...preferences,
                      fontScale: stepFontScale(preferences.fontScale, 'decrease'),
                    })
                  }
                  aria-label="Reducir tamaño de letra"
                  className="flex-1 py-2 px-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-blue-600 dark:hover:border-blue-400 disabled:opacity-40 text-slate-900 dark:text-slate-100 text-xs font-bold transition-colors cursor-pointer"
                >
                  A-
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ ...preferences, fontScale: 1.0 })}
                  title="Restablecer al 100%"
                  className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-orange-500 text-xs font-mono font-semibold text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  100%
                </button>
                <button
                  type="button"
                  disabled={!canIncrease}
                  onClick={() =>
                    onChange({
                      ...preferences,
                      fontScale: stepFontScale(preferences.fontScale, 'increase'),
                    })
                  }
                  aria-label="Aumentar tamaño de letra"
                  className="flex-1 py-2 px-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-blue-600 dark:hover:border-blue-400 disabled:opacity-40 text-slate-900 dark:text-slate-100 text-sm font-bold transition-colors cursor-pointer"
                >
                  A+
                </button>
              </div>
            </div>
          </div>

          {/* 2. Live Interactive Preview Box */}
          <div className="p-4 sm:p-5 rounded-xl bg-blue-50/60 dark:bg-slate-800/90 border border-blue-200/80 dark:border-slate-700 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-blue-900 dark:text-blue-300">
                Vista previa en vivo · {previewFont.name} ({previewFont.category})
              </span>
              <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                Escala {scalePercent}%
              </span>
            </div>
            <p
              style={{
                fontFamily: previewFont.cssFamily,
                fontSize: `${(0.95 * preferences.fontScale).toFixed(3)}rem`,
                lineHeight: 1.7,
              }}
              className="text-slate-800 dark:text-slate-100 transition-all"
            >
              “{previewFont.previewText} Cada capítulo revela principios aplicables, historias memorables y decisiones concretas para el día a día.”
            </p>
          </div>

          {/* 3. Six Reading Fonts Selector with Individual Previews */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                Tipografía de Lectura (6 fuentes disponibles)
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                Pasa el cursor o toca para previsualizar
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {READING_FONTS.map((font) => {
                const isSelected = preferences.fontId === font.id;
                return (
                  <button
                    key={font.id}
                    type="button"
                    onMouseEnter={() => setHoveredFontId(font.id)}
                    onMouseLeave={() => setHoveredFontId(null)}
                    onFocus={() => setHoveredFontId(font.id)}
                    onBlur={() => setHoveredFontId(null)}
                    onClick={() => onChange({ ...preferences, fontId: font.id })}
                    className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer space-y-1.5 ${
                      isSelected
                        ? 'bg-blue-50/90 dark:bg-blue-950/50 border-blue-600 dark:border-blue-400 ring-2 ring-blue-600/15 dark:ring-blue-400/20'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:border-orange-500 dark:hover:border-orange-400'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          style={{ fontFamily: font.cssFamily }}
                          className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate"
                        >
                          {font.name}
                        </span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                          · {font.category}
                        </span>
                      </div>
                      {isSelected && (
                        <span className="w-5 h-5 rounded-full bg-orange-600 text-white flex items-center justify-center shrink-0">
                          <Check className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                    <p
                      style={{ fontFamily: font.cssFamily }}
                      className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed"
                    >
                      Aa Bb Cc — {font.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Footer Reset & Done */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => onChange({ ...DEFAULT_READING_PREFERENCES })}
              className="px-3 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restablecer valores</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-lg text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 transition-colors cursor-pointer"
            >
              Listo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ReadingControlsStripProps {
  preferences: ReadingPreferences;
  onChange: (next: ReadingPreferences) => void;
  onOpenFontModal: () => void;
}

/**
 * Compact inline reading customization strip so readers can adjust A-/A+,
 * open the 6-font previewer, or toggle Dark Mode in 1 click from any reading view.
 */
export function ReadingControlsStrip({
  preferences,
  onChange,
  onOpenFontModal,
}: ReadingControlsStripProps) {
  const activeFont = getReadingFontById(preferences.fontId);
  const scalePercent = Math.round(preferences.fontScale * 100);
  const canDecrease = preferences.fontScale > MIN_FONT_SCALE + 0.005;
  const canIncrease = preferences.fontScale < MAX_FONT_SCALE - 0.005;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 no-print">
      <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
        <Type className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400 shrink-0" />
        <span className="font-medium text-slate-800 dark:text-slate-200">Lectura:</span>
        <button
          type="button"
          onClick={onOpenFontModal}
          className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/60 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-blue-900 dark:text-blue-200 transition-colors cursor-pointer whitespace-nowrap"
          style={{ fontFamily: activeFont.cssFamily }}
          title="Elegir y previsualizar entre 6 tipografías"
        >
          {activeFont.name}
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <div
          className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
          role="group"
          aria-label="Controles de tamaño de letra"
        >
          <button
            type="button"
            disabled={!canDecrease}
            onClick={() =>
              onChange({
                ...preferences,
                fontScale: stepFontScale(preferences.fontScale, 'decrease'),
              })
            }
            aria-label="Reducir tamaño de letra"
            className="px-2.5 py-1 rounded-md text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 disabled:opacity-40 transition-colors cursor-pointer"
          >
            A-
          </button>
          <span className="px-1.5 text-[11px] font-mono font-semibold tabular-nums text-orange-600 dark:text-orange-400 min-w-[38px] text-center">
            {scalePercent}%
          </span>
          <button
            type="button"
            disabled={!canIncrease}
            onClick={() =>
              onChange({
                ...preferences,
                fontScale: stepFontScale(preferences.fontScale, 'increase'),
              })
            }
            aria-label="Aumentar tamaño de letra"
            className="px-2.5 py-1 rounded-md text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 disabled:opacity-40 transition-colors cursor-pointer"
          >
            A+
          </button>
        </div>

        <button
          type="button"
          onClick={() =>
            onChange({
              ...preferences,
              theme: preferences.theme === 'dark' ? 'light' : 'dark',
            })
          }
          aria-label={preferences.theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/60 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
        >
          {preferences.theme === 'dark' ? (
            <>
              <Sun className="w-3.5 h-3.5 text-orange-400" />
              <span className="hidden sm:inline">Claro</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5 text-blue-700" />
              <span className="hidden sm:inline">Oscuro</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
