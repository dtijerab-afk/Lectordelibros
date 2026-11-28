import React from 'react';
import { BookOpen, Sparkles, Globe2 } from 'lucide-react';
import { ORIGIN_TYPE_META, OriginType, SourceProvenance } from '../types/stage3';

interface ProvenanceBadgeProps {
  provenance?: SourceProvenance;
  compact?: boolean;
  showQuote?: boolean;
}

const ORIGIN_STYLES: Record<OriginType, string> = {
  book_extracted:
    'bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800/80',
  ai_interpretation:
    'bg-violet-50 dark:bg-violet-950/50 text-violet-800 dark:text-violet-200 border-violet-200 dark:border-violet-800/80',
  external_example:
    'bg-orange-50 dark:bg-orange-950/50 text-orange-800 dark:text-orange-200 border-orange-200 dark:border-orange-800/80',
};

function OriginIcon({ type }: { type: OriginType }) {
  if (type === 'book_extracted') return <BookOpen className="w-3 h-3 shrink-0" />;
  if (type === 'ai_interpretation') return <Sparkles className="w-3 h-3 shrink-0" />;
  return <Globe2 className="w-3 h-3 shrink-0" />;
}

export function ProvenanceBadge({
  provenance,
  compact = false,
  showQuote = false,
}: ProvenanceBadgeProps) {
  if (!provenance) return null;
  const meta = ORIGIN_TYPE_META[provenance.originType] || ORIGIN_TYPE_META.book_extracted;
  const style = ORIGIN_STYLES[provenance.originType] || ORIGIN_STYLES.book_extracted;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span
          title={meta.description}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-medium ${style}`}
        >
          <OriginIcon type={provenance.originType} />
          <span>{compact ? meta.shortLabel : meta.label}</span>
        </span>

        {provenance.chapterNumber && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-mono font-semibold tabular-nums">
            Cap. {provenance.chapterNumber}
          </span>
        )}

        {provenance.pageRange && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 font-mono tabular-nums">
            {provenance.pageRange}
          </span>
        )}
      </div>

      {showQuote && provenance.evidenceQuote && (
        <p className="text-xs italic text-slate-600 dark:text-slate-400 border-l-2 border-blue-400 dark:border-blue-600 pl-2.5 reading-content-sm">
          “{provenance.evidenceQuote}”
        </p>
      )}
    </div>
  );
}

export function ProvenanceLegend() {
  const types: OriginType[] = ['book_extracted', 'ai_interpretation', 'external_example'];
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 dark:text-slate-400">
      <span className="font-semibold text-slate-700 dark:text-slate-300">Trazabilidad:</span>
      {types.map((t) => (
        <span
          key={t}
          title={ORIGIN_TYPE_META[t].description}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-medium ${ORIGIN_STYLES[t]}`}
        >
          <OriginIcon type={t} />
          <span>{ORIGIN_TYPE_META[t].label}</span>
        </span>
      ))}
    </div>
  );
}
