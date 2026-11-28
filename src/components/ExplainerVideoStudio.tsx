import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Download,
  RefreshCw,
  Video,
  Subtitles,
  FileText,
  Sparkles,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Film,
  Square,
} from 'lucide-react';
import { apiUrl, readApiJson } from '../utils/api';

export interface VideoScene {
  sceneNumber: number;
  tag: string;
  headline: string;
  visualType: 'thesis' | 'pillars' | 'flow' | 'case' | 'takeaways';
  keyBullets: string[];
  highlightStat: string;
  narration: string;
  accentTheme: 'amber' | 'indigo' | 'emerald' | 'rose';
}

export interface GeneratedExplainerVideo {
  videoTitle: string;
  subtitle: string;
  voiceName: string;
  style: 'ejecutivo' | 'storytelling' | 'didactico';
  scenes: VideoScene[];
  audioByScene: Record<number, string>; // base64 WAV audio per scene index
}

export interface ExplainerVideoSource {
  cacheKey: string;
  scope: 'chapter' | 'book';
  bookTitle: string;
  author?: string;
  chapterNumber?: string;
  chapterTitle?: string;
  chapterIdea?: string;
  chapterAnalysis?: string;
  chapterStory?: string;
  chapterConcepts?: Array<{ termino: string; definicion: string }>;
  chapterTips?: string[];
  realWorldCase?: {
    ambito?: string;
    tituloCaso?: string;
    escenarioActual?: string;
    planDeAccion?: string[];
  };
  executiveSummary?: string;
  keyPoints?: Array<{ heading: string; detail: string; category: string }>;
  conclusions?: string[];
}

interface ExplainerVideoStudioProps {
  source: ExplainerVideoSource;
  cachedVideo?: GeneratedExplainerVideo;
  onVideoSaved?: (cacheKey: string, video: GeneratedExplainerVideo) => void;
}

const VOICE_OPTIONS = [
  { id: 'Kore', label: 'Kore · Ejecutiva', style: 'Voz femenina profesional, clara, cálida y articulada en español para video explicativo' },
  { id: 'Charon', label: 'Charon · Documental', style: 'Voz masculina profunda, serena y autoritativa en español estilo documental' },
  { id: 'Puck', label: 'Puck · Dinámica', style: 'Voz enérgica, entusiasta y didáctica en español para explicar ideas complejas' },
  { id: 'Zephyr', label: 'Zephyr · Narrativa', style: 'Voz cálida, cercana y pausada en español estilo storytelling editorial' },
] as const;

const STYLE_OPTIONS = [
  { id: 'ejecutivo', label: 'Ejecutivo' },
  { id: 'storytelling', label: 'Storytelling' },
  { id: 'didactico', label: 'Didáctico' },
] as const;

const THEME_PALETTES: Record<
  VideoScene['accentTheme'],
  { bg1: string; bg2: string; accent: string; accentSoft: string; cardBg: string; border: string }
> = {
  amber: {
    bg1: '#151936',
    bg2: '#231c35',
    accent: '#f59e0b',
    accentSoft: 'rgba(245, 158, 11, 0.16)',
    cardBg: 'rgba(255, 255, 255, 0.06)',
    border: 'rgba(245, 158, 11, 0.42)',
  },
  indigo: {
    bg1: '#111633',
    bg2: '#1d2754',
    accent: '#818cf8',
    accentSoft: 'rgba(129, 140, 248, 0.18)',
    cardBg: 'rgba(255, 255, 255, 0.06)',
    border: 'rgba(129, 140, 248, 0.42)',
  },
  emerald: {
    bg1: '#0e2427',
    bg2: '#153437',
    accent: '#34d399',
    accentSoft: 'rgba(52, 211, 153, 0.16)',
    cardBg: 'rgba(255, 255, 255, 0.06)',
    border: 'rgba(52, 211, 153, 0.42)',
  },
  rose: {
    bg1: '#271323',
    bg2: '#1c1836',
    accent: '#fb7185',
    accentSoft: 'rgba(251, 113, 133, 0.16)',
    cardBg: 'rgba(255, 255, 255, 0.06)',
    border: 'rgba(251, 113, 133, 0.42)',
  },
};

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function estimateSpeechDuration(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(5.5, Math.min(18, words / 2.45 + 1.2));
}

function splitNarrationIntoChunks(narration: string, maxChars = 95): string[] {
  const sentences = narration
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      chunks.push(sentence);
    } else {
      const words = sentence.split(/\s+/);
      let current = '';
      for (const word of words) {
        if ((current + ' ' + word).trim().length > maxChars && current) {
          chunks.push(current.trim());
          current = word;
        } else {
          current = (current + ' ' + word).trim();
        }
      }
      if (current) chunks.push(current.trim());
    }
  }
  return chunks.length > 0 ? chunks : [narration];
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 4
): string[] {
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = words[0];

  for (let i = 1; i < words.length; i++) {
    const testLine = `${line} ${words[i]}`;
    if (ctx.measureText(testLine).width <= maxWidth) {
      line = testLine;
    } else {
      lines.push(line);
      line = words[i];
      if (lines.length >= maxLines - 1) {
        // Pack remaining words with ellipsis if needed
        let remainder = words.slice(i).join(' ');
        while (ctx.measureText(remainder).width > maxWidth && remainder.length > 4) {
          remainder = remainder.slice(0, -2).trimEnd() + '…';
        }
        lines.push(remainder);
        return lines;
      }
    }
  }
  lines.push(line);
  return lines;
}

function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
}

function renderSceneFrame(
  ctx: CanvasRenderingContext2D,
  video: GeneratedExplainerVideo,
  sceneIndex: number,
  sceneProgress: number, // 0..1
  timeSec: number,
  showSubtitles: boolean,
  audioLevel: number, // 0..1
  isPlaying: boolean
) {
  const W = 1280;
  const H = 720;
  const scene = video.scenes[sceneIndex];
  if (!scene) return;

  const palette = THEME_PALETTES[scene.accentTheme] || THEME_PALETTES.amber;
  const introT = easeOutCubic(Math.min(1, sceneProgress * 6.5));
  const outroFade = sceneProgress > 0.94 ? Math.max(0.25, 1 - (sceneProgress - 0.94) / 0.06) : 1;

  // 1. Editorial gradient backdrop
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, palette.bg1);
  bgGrad.addColorStop(1, palette.bg2);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Subtle ambient glow orbs
  const orbX = W * 0.84 + Math.sin(timeSec * 0.5) * 28;
  const orbY = H * 0.22 + Math.cos(timeSec * 0.4) * 18;
  const radial = ctx.createRadialGradient(orbX, orbY, 20, orbX, orbY, 420);
  radial.addColorStop(0, palette.accentSoft);
  radial.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, W, H);

  // Subtle editorial architectural grid lines
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  for (let gx = 80; gx < W; gx += 160) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, H);
    ctx.stroke();
  }
  for (let gy = 90; gy < H; gy += 140) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(W, gy);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = outroFade;

  // 2. Top Editorial HUD Bar
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  drawRoundedRect(ctx, 56, 36, 28, 28, 7);
  ctx.fill();
  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.arc(70, 50, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = '600 18px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#f5f5f4';
  const brandLabel = `LecturaViva · ${video.subtitle}`.slice(0, 58);
  ctx.fillText(brandLabel, 96, 56);

  // Scene counter + live voice visualizer bars (top-right)
  const sceneCountText = `ESCENA 0${sceneIndex + 1} / 0${video.scenes.length}`;
  ctx.font = '600 15px ui-monospace, SFMono-Regular, monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  const scW = ctx.measureText(sceneCountText).width;
  ctx.fillText(sceneCountText, W - 56 - scW - 76, 55);

  // Audio waveform equalizer bars
  const barBaseX = W - 116;
  for (let b = 0; b < 7; b++) {
    const wave = isPlaying
      ? 0.25 + 0.75 * Math.abs(Math.sin(timeSec * 6.2 + b * 0.9)) * Math.max(0.35, audioLevel * 1.6)
      : 0.22;
    const barH = Math.max(5, wave * 24);
    ctx.fillStyle = palette.accent;
    drawRoundedRect(ctx, barBaseX + b * 9, 50 - barH / 2, 5, barH, 3);
    ctx.fill();
  }

  // Thin divider under top bar
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(56, 82);
  ctx.lineTo(W - 56, 82);
  ctx.stroke();

  // 3. Scene Tag + Headline (Animated slide-up entrance)
  const slideY = (1 - introT) * 22;
  ctx.save();
  ctx.globalAlpha = introT * outroFade;

  // Tag badge
  ctx.font = '700 16px ui-monospace, SFMono-Regular, monospace';
  const tagText = scene.tag.toUpperCase();
  const tagW = ctx.measureText(tagText).width + 28;
  ctx.fillStyle = palette.accentSoft;
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 1.2;
  drawRoundedRect(ctx, 56, 106 + slideY, tagW, 34, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = palette.accent;
  ctx.fillText(tagText, 70, 129 + slideY);

  // Optional highlight stat card at top-right of header area
  if (scene.highlightStat) {
    ctx.font = '700 17px Inter, system-ui, sans-serif';
    const statText = scene.highlightStat.slice(0, 44);
    const statW = Math.min(420, ctx.measureText(statText).width + 36);
    const statX = W - 56 - statW;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    drawRoundedRect(ctx, statX, 106 + slideY, statW, 38, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(statText, statX + 18, 131 + slideY);
  }

  // Main Headline
  ctx.font = '700 44px Georgia, "Times New Roman", serif';
  ctx.fillStyle = '#ffffff';
  const headlineLines = wrapCanvasText(ctx, scene.headline, W - 112, 2);
  headlineLines.forEach((line, idx) => {
    ctx.fillText(line, 56, 198 + idx * 54 + slideY);
  });
  ctx.restore();

  // 4. Visual Diagram Area (Adapts to visualType)
  const contentTop = headlineLines.length > 1 ? 286 : 244;
  const bullets = scene.keyBullets.slice(0, 3);
  const availableH = showSubtitles ? 270 : 350;

  if (scene.visualType === 'pillars' && bullets.length > 0) {
    const gap = 24;
    const count = bullets.length;
    const cardW = (W - 112 - gap * (count - 1)) / count;
    const cardH = Math.min(240, availableH);

    bullets.forEach((bullet, idx) => {
      const itemDelay = 0.08 + idx * 0.16;
      const itemT = easeOutCubic((sceneProgress - itemDelay) / 0.18);
      if (itemT <= 0) return;

      const x = 56 + idx * (cardW + gap);
      const y = contentTop + (1 - itemT) * 26;

      ctx.save();
      ctx.globalAlpha = itemT * outroFade;
      ctx.fillStyle = palette.cardBg;
      ctx.strokeStyle = idx === 0 ? palette.border : 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1.5;
      drawRoundedRect(ctx, x, y, cardW, cardH, 18);
      ctx.fill();
      ctx.stroke();

      // Number emblem
      ctx.fillStyle = palette.accentSoft;
      drawRoundedRect(ctx, x + 22, y + 22, 48, 36, 9);
      ctx.fill();
      ctx.font = '700 18px ui-monospace, SFMono-Regular, monospace';
      ctx.fillStyle = palette.accent;
      ctx.fillText(`0${idx + 1}`, x + 34, y + 46);

      // Accent top bar
      ctx.fillStyle = palette.accent;
      drawRoundedRect(ctx, x + 82, y + 38, Math.max(24, (cardW - 110) * itemT), 4, 2);
      ctx.fill();

      // Pillar text
      ctx.font = '500 22px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#f5f5f4';
      const lines = wrapCanvasText(ctx, bullet, cardW - 44, 5);
      lines.forEach((l, li) => {
        ctx.fillText(l, x + 22, y + 92 + li * 31);
      });
      ctx.restore();
    });
  } else if (scene.visualType === 'flow' && bullets.length > 0) {
    const count = bullets.length;
    const arrowGap = 48;
    const cardW = (W - 112 - arrowGap * (count - 1)) / count;
    const cardH = Math.min(230, availableH);

    bullets.forEach((bullet, idx) => {
      const itemDelay = 0.06 + idx * 0.2;
      const itemT = easeOutCubic((sceneProgress - itemDelay) / 0.18);
      if (itemT <= 0) return;

      const x = 56 + idx * (cardW + arrowGap);
      const y = contentTop + 8 + (1 - itemT) * 20;

      ctx.save();
      ctx.globalAlpha = itemT * outroFade;
      ctx.fillStyle = palette.cardBg;
      ctx.strokeStyle = palette.border;
      ctx.lineWidth = 1.5;
      drawRoundedRect(ctx, x, y, cardW, cardH, 18);
      ctx.fill();
      ctx.stroke();

      // Step header pill
      ctx.fillStyle = palette.accent;
      drawRoundedRect(ctx, x + 20, y + 20, 96, 30, 8);
      ctx.fill();
      ctx.font = '700 14px ui-monospace, SFMono-Regular, monospace';
      ctx.fillStyle = '#111827';
      ctx.fillText(`PASO 0${idx + 1}`, x + 35, y + 40);

      // Step text
      ctx.font = '500 21px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#f5f5f4';
      const lines = wrapCanvasText(ctx, bullet, cardW - 40, 5);
      lines.forEach((l, li) => {
        ctx.fillText(l, x + 20, y + 84 + li * 30);
      });

      // Connecting arrow to next step
      if (idx < count - 1) {
        const ax = x + cardW + 8;
        const ay = y + cardH / 2;
        ctx.strokeStyle = palette.accent;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + arrowGap - 18, ay);
        ctx.stroke();

        ctx.fillStyle = palette.accent;
        ctx.beginPath();
        ctx.moveTo(ax + arrowGap - 12, ay);
        ctx.lineTo(ax + arrowGap - 24, ay - 8);
        ctx.lineTo(ax + arrowGap - 24, ay + 8);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    });
  } else if (scene.visualType === 'case') {
    const leftW = 410;
    const rightX = 56 + leftW + 28;
    const rightW = W - rightX - 56;
    const boxH = Math.min(250, availableH);

    // Left spotlight editorial frame
    ctx.save();
    ctx.globalAlpha = introT * outroFade;
    ctx.fillStyle = palette.accentSoft;
    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 1.6;
    drawRoundedRect(ctx, 56, contentTop, leftW, boxH, 20);
    ctx.fill();
    ctx.stroke();

    ctx.font = '700 15px ui-monospace, SFMono-Regular, monospace';
    ctx.fillStyle = palette.accent;
    ctx.fillText('APLICACIÓN EN LA REALIDAD', 82, contentTop + 42);

    ctx.font = '700 28px Georgia, serif';
    ctx.fillStyle = '#ffffff';
    const spotlightText = scene.highlightStat || scene.headline;
    const spLines = wrapCanvasText(ctx, spotlightText, leftW - 52, 4);
    spLines.forEach((l, i) => {
      ctx.fillText(l, 82, contentTop + 92 + i * 38);
    });
    ctx.restore();

    // Right stacked case details
    const rowH = (boxH - (bullets.length - 1) * 14) / Math.max(1, bullets.length);
    bullets.forEach((bullet, idx) => {
      const itemT = easeOutCubic((sceneProgress - (0.1 + idx * 0.16)) / 0.18);
      if (itemT <= 0) return;
      const y = contentTop + idx * (rowH + 14) + (1 - itemT) * 14;

      ctx.save();
      ctx.globalAlpha = itemT * outroFade;
      ctx.fillStyle = palette.cardBg;
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1.2;
      drawRoundedRect(ctx, rightX, y, rightW, rowH, 14);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = palette.accent;
      ctx.beginPath();
      ctx.arc(rightX + 26, y + rowH / 2, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '500 21px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#f5f5f4';
      const lines = wrapCanvasText(ctx, bullet, rightW - 64, 2);
      const startY = y + rowH / 2 - ((lines.length - 1) * 26) / 2 + 7;
      lines.forEach((l, li) => {
        ctx.fillText(l, rightX + 46, startY + li * 28);
      });
      ctx.restore();
    });
  } else {
    // 'thesis' or 'takeaways': Clean wide editorial cards stacked with animated check/accent indicators
    const count = Math.max(1, bullets.length);
    const rowGap = 16;
    const rowH = Math.min(82, (availableH - rowGap * (count - 1)) / count);

    bullets.forEach((bullet, idx) => {
      const itemT = easeOutCubic((sceneProgress - (0.08 + idx * 0.16)) / 0.18);
      if (itemT <= 0) return;
      const y = contentTop + idx * (rowH + rowGap) + (1 - itemT) * 18;

      ctx.save();
      ctx.globalAlpha = itemT * outroFade;
      ctx.fillStyle = palette.cardBg;
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1.3;
      drawRoundedRect(ctx, 56, y, W - 112, rowH, 16);
      ctx.fill();
      ctx.stroke();

      // Left vertical accent stripe
      ctx.fillStyle = palette.accent;
      drawRoundedRect(ctx, 56, y, 7, rowH, 4);
      ctx.fill();

      // Number or check badge
      ctx.fillStyle = palette.accentSoft;
      drawRoundedRect(ctx, 82, y + rowH / 2 - 20, 40, 40, 10);
      ctx.fill();
      ctx.font = '700 17px ui-monospace, SFMono-Regular, monospace';
      ctx.fillStyle = palette.accent;
      const badgeSymbol = scene.visualType === 'takeaways' ? '✓' : `0${idx + 1}`;
      ctx.fillText(badgeSymbol, scene.visualType === 'takeaways' ? 95 : 92, y + rowH / 2 + 6);

      ctx.font = '500 23px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#fafaf9';
      const lines = wrapCanvasText(ctx, bullet, W - 210, 2);
      const startY = y + rowH / 2 - ((lines.length - 1) * 28) / 2 + 8;
      lines.forEach((l, li) => {
        ctx.fillText(l, 140, startY + li * 30);
      });
      ctx.restore();
    });
  }

  // 5. Synchronized Subtitles Box at Bottom
  if (showSubtitles && scene.narration) {
    const chunks = splitNarrationIntoChunks(scene.narration, 92);
    const chunkIdx = Math.min(chunks.length - 1, Math.floor(sceneProgress * chunks.length));
    const activeSubtitle = chunks[chunkIdx] || '';

    ctx.save();
    ctx.fillStyle = 'rgba(9, 11, 24, 0.82)';
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1.2;
    drawRoundedRect(ctx, 56, H - 122, W - 112, 82, 14);
    ctx.fill();
    ctx.stroke();

    ctx.font = '500 23px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    const subLines = wrapCanvasText(ctx, activeSubtitle, W - 180, 2);
    const subStartY = subLines.length > 1 ? H - 88 : H - 74;
    subLines.forEach((sl, sIdx) => {
      ctx.fillText(sl, W / 2, subStartY + sIdx * 30);
    });
    ctx.textAlign = 'left';
    ctx.restore();
  }

  ctx.restore();

  // 6. Bottom Segmented Timeline Progress Bar
  const segGap = 8;
  const totalBarW = W - 112;
  const segW = (totalBarW - segGap * (video.scenes.length - 1)) / video.scenes.length;
  const barY = H - 22;

  for (let s = 0; s < video.scenes.length; s++) {
    const sx = 56 + s * (segW + segGap);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    drawRoundedRect(ctx, sx, barY, segW, 6, 3);
    ctx.fill();

    let fillRatio = 0;
    if (s < sceneIndex) fillRatio = 1;
    else if (s === sceneIndex) fillRatio = Math.max(0.03, Math.min(1, sceneProgress));

    if (fillRatio > 0) {
      ctx.fillStyle = palette.accent;
      drawRoundedRect(ctx, sx, barY, segW * fillRatio, 6, 3);
      ctx.fill();
    }
  }
}

export default function ExplainerVideoStudio({
  source,
  cachedVideo,
  onVideoSaved,
}: ExplainerVideoStudioProps) {
  const [selectedStyle, setSelectedStyle] = useState<'ejecutivo' | 'storytelling' | 'didactico'>(
    cachedVideo?.style || 'ejecutivo'
  );
  const [selectedVoice, setSelectedVoice] = useState<string>(cachedVideo?.voiceName || 'Kore');
  const [video, setVideo] = useState<GeneratedExplainerVideo | null>(cachedVideo || null);

  // Generation progress states
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [genStatus, setGenStatus] = useState<string>('');
  const [audioLoadedCount, setAudioLoadedCount] = useState<number>(
    cachedVideo ? Object.keys(cachedVideo.audioByScene).length : 0
  );
  const [ttsWarning, setTtsWarning] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Playback states
  const [currentSceneIdx, setCurrentSceneIdx] = useState<number>(0);
  const [sceneProgress, setSceneProgress] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [showSubtitles, setShowSubtitles] = useState<boolean>(true);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [showScriptDrawer, setShowScriptDrawer] = useState<boolean>(false);

  // Export states
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportStatus, setExportStatus] = useState<string>('');
  const [exportProgressPct, setExportProgressPct] = useState<number>(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const decodedBuffersRef = useRef<Record<number, AudioBuffer>>({});
  const rafRef = useRef<number | null>(null);
  const exportCancelledRef = useRef<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Refs to keep animation loop fresh
  const isPlayingRef = useRef<boolean>(false);
  const sceneIdxRef = useRef<number>(0);
  const sceneStartPerfRef = useRef<number>(0);
  const sceneDurationRef = useRef<number>(8);
  const pausedProgressRef = useRef<number>(0);
  const showSubtitlesRef = useRef<boolean>(true);
  const isMutedRef = useRef<boolean>(false);
  const playbackRateRef = useRef<number>(1);
  const videoRef = useRef<GeneratedExplainerVideo | null>(cachedVideo || null);

  useEffect(() => {
    showSubtitlesRef.current = showSubtitles;
  }, [showSubtitles]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    playbackRateRef.current = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    videoRef.current = video;
  }, [video]);

  const stopActiveAudio = useCallback(() => {
    if (activeAudioSourceRef.current) {
      try {
        activeAudioSourceRef.current.onended = null;
        activeAudioSourceRef.current.stop();
        activeAudioSourceRef.current.disconnect();
      } catch {
        // Ignore already stopped source
      }
      activeAudioSourceRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }
  }, []);

  const stopPlayback = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    stopActiveAudio();
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, [stopActiveAudio]);

  // Sync when switching chapter/source cacheKey
  useEffect(() => {
    stopPlayback();
    decodedBuffersRef.current = {};
    setCurrentSceneIdx(0);
    sceneIdxRef.current = 0;
    setSceneProgress(0);
    pausedProgressRef.current = 0;
    setErrorMsg('');
    setTtsWarning('');
    if (cachedVideo) {
      setVideo(cachedVideo);
      videoRef.current = cachedVideo;
      setSelectedVoice(cachedVideo.voiceName);
      setSelectedStyle(cachedVideo.style);
      setAudioLoadedCount(Object.keys(cachedVideo.audioByScene).length);
    } else {
      setVideo(null);
      videoRef.current = null;
      setAudioLoadedCount(0);
    }
  }, [source.cacheKey, cachedVideo, stopPlayback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      exportCancelledRef.current = true;
      stopPlayback();
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, [stopPlayback]);

  const getOrCreateAudioContext = useCallback(async (): Promise<AudioContext> => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new AudioCtx();
    }
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const getDecodedBuffer = useCallback(
    async (sceneIndex: number, targetVideo: GeneratedExplainerVideo): Promise<AudioBuffer | null> => {
      if (decodedBuffersRef.current[sceneIndex]) {
        return decodedBuffersRef.current[sceneIndex];
      }
      const b64 = targetVideo.audioByScene[sceneIndex];
      if (!b64) return null;
      try {
        const ctx = await getOrCreateAudioContext();
        const arrayBuf = base64ToArrayBuffer(b64);
        const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
        decodedBuffersRef.current[sceneIndex] = decoded;
        return decoded;
      } catch {
        return null;
      }
    },
    [getOrCreateAudioContext]
  );

  // Draw static frame whenever paused or scene/subtitles change
  useEffect(() => {
    if (!video || isPlaying || isExporting) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderSceneFrame(
      ctx,
      video,
      currentSceneIdx,
      sceneProgress > 0 ? sceneProgress : 0.38,
      currentSceneIdx * 3.1,
      showSubtitles,
      0.2,
      false
    );
  }, [video, currentSceneIdx, sceneProgress, showSubtitles, isPlaying, isExporting]);

  // Start playing a specific scene
  const playSceneAt = useCallback(
    async (idx: number, startProgress = 0) => {
      const activeVideo = videoRef.current;
      if (!activeVideo || idx < 0 || idx >= activeVideo.scenes.length) {
        stopPlayback();
        return;
      }

      stopActiveAudio();
      sceneIdxRef.current = idx;
      setCurrentSceneIdx(idx);
      isPlayingRef.current = true;
      setIsPlaying(true);

      const scene = activeVideo.scenes[idx];
      const buffer = await getDecodedBuffer(idx, activeVideo);
      const rate = playbackRateRef.current;
      const naturalDuration = buffer ? buffer.duration : estimateSpeechDuration(scene.narration);
      const effectiveDuration = Math.max(2.5, naturalDuration / rate);
      sceneDurationRef.current = effectiveDuration;

      const offsetSec = Math.max(0, Math.min(0.95, startProgress)) * effectiveDuration;
      sceneStartPerfRef.current = performance.now() - offsetSec * 1000;

      // Play AI AudioBuffer via Web Audio API
      if (buffer && !isMutedRef.current) {
        try {
          const audioCtx = await getOrCreateAudioContext();
          const sourceNode = audioCtx.createBufferSource();
          sourceNode.buffer = buffer;
          sourceNode.playbackRate.value = rate;

          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 64;
          analyserRef.current = analyser;

          sourceNode.connect(analyser);
          analyser.connect(audioCtx.destination);
          sourceNode.start(0, Math.min(buffer.duration - 0.05, offsetSec * rate));
          activeAudioSourceRef.current = sourceNode;
        } catch {
          // Audio playback blocked or unavailable; visual timeline continues cleanly
        }
      } else if (!buffer && !isMutedRef.current && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        // Fallback browser speech synthesis if AI TTS audio wasn't ready for this scene
        try {
          const utter = new SpeechSynthesisUtterance(scene.narration);
          utter.lang = 'es-ES';
          utter.rate = rate;
          window.speechSynthesis.speak(utter);
        } catch {
          // Silent visual fallback
        }
      }

      const freqData = new Uint8Array(32);

      const tick = (now: number) => {
        if (!isPlayingRef.current) return;
        const vid = videoRef.current;
        if (!vid) return;

        const elapsedSec = (now - sceneStartPerfRef.current) / 1000;
        const progress = Math.min(1, elapsedSec / sceneDurationRef.current);
        pausedProgressRef.current = progress;
        setSceneProgress(progress);

        let audioLevel = 0.25;
        if (analyserRef.current && !isMutedRef.current) {
          analyserRef.current.getByteFrequencyData(freqData);
          let sum = 0;
          for (let i = 0; i < freqData.length; i++) sum += freqData[i];
          audioLevel = Math.min(1, sum / (freqData.length * 140));
        }

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (ctx) {
          renderSceneFrame(
            ctx,
            vid,
            sceneIdxRef.current,
            progress,
            now / 1000,
            showSubtitlesRef.current,
            audioLevel,
            true
          );
        }

        if (progress >= 1) {
          if (sceneIdxRef.current < vid.scenes.length - 1) {
            playSceneAt(sceneIdxRef.current + 1, 0);
          } else {
            // Reached end of video
            pausedProgressRef.current = 0;
            setSceneProgress(1);
            stopPlayback();
          }
          return;
        }

        rafRef.current = requestAnimationFrame(tick);
      };

      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(tick);
    },
    [getDecodedBuffer, getOrCreateAudioContext, stopActiveAudio, stopPlayback]
  );

  const handleTogglePlay = () => {
    if (!video) return;
    if (isPlaying) {
      stopPlayback();
    } else {
      const startFrom = pausedProgressRef.current >= 0.98 ? 0 : pausedProgressRef.current;
      const nextIdx =
        currentSceneIdx === video.scenes.length - 1 && pausedProgressRef.current >= 0.98
          ? 0
          : currentSceneIdx;
      playSceneAt(nextIdx, startFrom);
    }
  };

  const handleJumpToScene = (idx: number) => {
    if (!video) return;
    pausedProgressRef.current = 0;
    setCurrentSceneIdx(idx);
    sceneIdxRef.current = idx;
    setSceneProgress(0.35);
    if (isPlaying) {
      playSceneAt(idx, 0);
    }
  };

  // Generate Script + Gemini AI Voiceover for all scenes
  const handleGenerateExplainerVideo = async () => {
    stopPlayback();
    setErrorMsg('');
    setTtsWarning('');
    setIsGenerating(true);
    setGenStatus('Escribiendo guion visual y narración de 5 escenas con IA...');
    decodedBuffersRef.current = {};

    try {
      const scriptRes = await fetch(apiUrl('/api/video-script'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...source,
          style: selectedStyle,
        }),
      });
      const scriptData = await readApiJson<{
        videoTitle?: string;
        subtitle?: string;
        scenes?: VideoScene[];
        error?: string;
      }>(scriptRes);
      if (!scriptRes.ok) {
        throw new Error(scriptData.error || 'No se pudo generar el guion del video explicativo.');
      }

      const scenes: VideoScene[] = Array.isArray(scriptData.scenes) ? scriptData.scenes : [];
      if (scenes.length === 0) {
        throw new Error('El guion generado no contiene escenas válidas.');
      }

      const initialVideo: GeneratedExplainerVideo = {
        videoTitle: scriptData.videoTitle || source.chapterTitle || source.bookTitle,
        subtitle: scriptData.subtitle || source.bookTitle,
        voiceName: selectedVoice,
        style: selectedStyle,
        scenes,
        audioByScene: {},
      };

      setVideo(initialVideo);
      videoRef.current = initialVideo;
      setCurrentSceneIdx(0);
      sceneIdxRef.current = 0;
      setSceneProgress(0.38);
      setAudioLoadedCount(0);

      // Synthesize Gemini TTS audio for each scene (2 concurrent workers for fast readiness)
      const voiceOption = VOICE_OPTIONS.find((v) => v.id === selectedVoice) || VOICE_OPTIONS[0];
      const audioMap: Record<number, string> = {};
      let failedTtsCount = 0;
      let completedCount = 0;

      setGenStatus(`Sintetizando narración de voz IA (${voiceOption.id}) · 0/${scenes.length}...`);

      const fetchSceneAudio = async (idx: number) => {
        const sc = scenes[idx];
        try {
          const ttsRes = await fetch(apiUrl('/api/tts'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: sc.narration,
              voiceName: selectedVoice,
              style: voiceOption.style,
            }),
          });
          const ttsData = await readApiJson<{ audioBase64?: string }>(ttsRes);
          if (ttsRes.ok && ttsData.audioBase64) {
            audioMap[idx] = ttsData.audioBase64;
          } else {
            failedTtsCount++;
          }
        } catch {
          failedTtsCount++;
        } finally {
          completedCount++;
          setAudioLoadedCount(Object.keys(audioMap).length);
          setGenStatus(
            `Sintetizando narración de voz IA (${voiceOption.id}) · ${completedCount}/${scenes.length}...`
          );
          const updated: GeneratedExplainerVideo = {
            ...initialVideo,
            audioByScene: { ...audioMap },
          };
          setVideo(updated);
          videoRef.current = updated;
        }
      };

      // Scene 0 first so user gets immediate voice readiness, then remaining pairs
      await fetchSceneAudio(0);
      for (let i = 1; i < scenes.length; i += 2) {
        const batch = [fetchSceneAudio(i)];
        if (i + 1 < scenes.length) batch.push(fetchSceneAudio(i + 1));
        await Promise.all(batch);
      }

      const finalVideo: GeneratedExplainerVideo = {
        ...initialVideo,
        audioByScene: { ...audioMap },
      };
      setVideo(finalVideo);
      videoRef.current = finalVideo;
      onVideoSaved?.(source.cacheKey, finalVideo);

      if (failedTtsCount > 0 && Object.keys(audioMap).length === 0) {
        setTtsWarning(
          'La voz IA tuvo un límite temporal; el reproductor usará la voz de tu dispositivo para narrar el video.'
        );
      } else if (failedTtsCount > 0) {
        setTtsWarning(
          `Se generó voz IA para ${Object.keys(audioMap).length} de ${scenes.length} escenas.`
        );
      }
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : 'No se pudo crear el video explicativo.'
      );
    } finally {
      setIsGenerating(false);
      setGenStatus('');
    }
  };

  // Export real WebM Video with Canvas + Synchronized Gemini AI Audio Track
  const handleExportVideo = async () => {
    if (!video || isExporting) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) {
      setErrorMsg(
        'Tu navegador móvil no soporta grabación directa a archivo de video. Puedes reproducirlo aquí o descargar el guion completo.'
      );
      return;
    }

    stopPlayback();
    setErrorMsg('');
    setIsExporting(true);
    exportCancelledRef.current = false;
    setExportProgressPct(0);
    setExportStatus('Preparando pistas de video y narración IA...');

    try {
      const audioCtx = await getOrCreateAudioContext();
      const destNode = audioCtx.createMediaStreamDestination();

      // Pre-decode all available AI audio buffers
      const buffers: Array<AudioBuffer | null> = [];
      for (let i = 0; i < video.scenes.length; i++) {
        buffers.push(await getDecodedBuffer(i, video));
      }

      const canvasStream = canvas.captureStream(30);
      const combinedTracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
      const hasAudioBuffers = buffers.some(Boolean);
      if (hasAudioBuffers) {
        combinedTracks.push(...destNode.stream.getAudioTracks());
      }
      const combinedStream = new MediaStream(combinedTracks);

      const mimeCandidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
      ];
      const chosenMime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';

      const recorder = chosenMime
        ? new MediaRecorder(combinedStream, {
            mimeType: chosenMime,
            videoBitsPerSecond: 3200000,
          })
        : new MediaRecorder(combinedStream);
      mediaRecorderRef.current = recorder;

      const recordedChunks: BlobPart[] = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recordedChunks.push(ev.data);
      };

      const recordingDone = new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          const outType = chosenMime.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
          resolve(new Blob(recordedChunks, { type: outType }));
        };
      });

      recorder.start(250);

      const ctx = canvas.getContext('2d');
      const totalScenes = video.scenes.length;

      for (let sIdx = 0; sIdx < totalScenes; sIdx++) {
        if (exportCancelledRef.current) break;

        const sc = video.scenes[sIdx];
        const buf = buffers[sIdx];
        const durationSec = buf ? buf.duration : estimateSpeechDuration(sc.narration);
        setCurrentSceneIdx(sIdx);
        setExportStatus(`Grabando escena ${sIdx + 1} de ${totalScenes}...`);

        let srcNode: AudioBufferSourceNode | null = null;
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;

        if (buf) {
          srcNode = audioCtx.createBufferSource();
          srcNode.buffer = buf;
          srcNode.connect(analyser);
          analyser.connect(destNode);
          srcNode.start();
        }

        const startPerf = performance.now();
        const freqData = new Uint8Array(32);

        await new Promise<void>((resolveScene) => {
          const renderExportTick = (now: number) => {
            if (exportCancelledRef.current) {
              resolveScene();
              return;
            }
            const elapsed = (now - startPerf) / 1000;
            const prog = Math.min(1, elapsed / durationSec);
            const overallPct = Math.round(((sIdx + prog) / totalScenes) * 100);
            setExportProgressPct(overallPct);
            setSceneProgress(prog);

            let level = 0.25;
            if (buf) {
              analyser.getByteFrequencyData(freqData);
              let sum = 0;
              for (let k = 0; k < freqData.length; k++) sum += freqData[k];
              level = Math.min(1, sum / (freqData.length * 140));
            }

            if (ctx) {
              renderSceneFrame(ctx, video, sIdx, prog, now / 1000, showSubtitlesRef.current, level, true);
            }

            if (prog >= 1) {
              resolveScene();
              return;
            }
            requestAnimationFrame(renderExportTick);
          };
          requestAnimationFrame(renderExportTick);
        });

        if (srcNode) {
          try {
            srcNode.stop();
            srcNode.disconnect();
          } catch {
            // Ignore
          }
        }
      }

      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      const videoBlob = await recordingDone;

      if (!exportCancelledRef.current && videoBlob.size > 0) {
        const ext = chosenMime.startsWith('video/mp4') ? 'mp4' : 'webm';
        const slug = (video.videoTitle || 'video-explicativo')
          .toLowerCase()
          .replace(/[^a-z0-9áéíóúñ]+/gi, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 48);
        const url = URL.createObjectURL(videoBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `video-explicativo-${slug || 'lecturaviva'}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error
          ? `No se pudo exportar el archivo de video: ${err.message}`
          : 'No se pudo exportar el archivo de video en este dispositivo.'
      );
    } finally {
      setIsExporting(false);
      setExportStatus('');
      setExportProgressPct(0);
    }
  };

  const handleCancelExport = () => {
    exportCancelledRef.current = true;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Ignore
      }
    }
  };

  const handleDownloadScript = () => {
    if (!video) return;
    const lines = [
      `VIDEO EXPLICATIVO: ${video.videoTitle}`,
      `Subtítulo: ${video.subtitle}`,
      `Estilo: ${video.style} · Voz IA: ${video.voiceName}`,
      '====================================================',
      '',
      ...video.scenes.flatMap((sc) => [
        `[${sc.tag}] ${sc.headline}`,
        sc.highlightStat ? `Destacado: ${sc.highlightStat}` : '',
        'Puntos en pantalla:',
        ...sc.keyBullets.map((b) => `  • ${b}`),
        `Narración: ${sc.narration}`,
        '',
      ]),
    ].filter((l) => l !== undefined);

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `guion-video-${source.cacheKey}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  };

  const studioHeading =
    source.scope === 'book'
      ? 'Video-Resumen Explicativo del Libro Completo'
      : `Video Explicativo del Capítulo ${source.chapterNumber || ''}`;

  const studioSubheading =
    source.scope === 'book'
      ? 'Genera una presentación animada de 5 escenas con narración de voz IA, esquemas visuales, subtítulos y descarga en video.'
      : 'Convierte este capítulo en un video-resumen narrado con voz IA, diagramas en pantalla y subtítulos sincronizados.';

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden no-print">
      {/* Editorial Studio Header */}
      <div className="bg-gradient-to-r from-blue-950 via-blue-900 to-blue-950 text-white p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-orange-300">
            <Film className="w-4 h-4 shrink-0" />
            <span>Estudio de Video Explicativo · Narración IA + Diapositivas Animadas</span>
          </div>
          <h4 className="text-base sm:text-lg font-bold text-white leading-snug">
            {studioHeading}
          </h4>
          <p className="text-xs text-blue-100/85 leading-relaxed max-w-2xl">
            {studioSubheading}
          </p>
        </div>

        {video && !isGenerating && (
          <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-300 bg-emerald-950/60 border border-emerald-500/30 px-3 py-1.5 rounded-lg self-start sm:self-center shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>
              {audioLoadedCount}/{video.scenes.length} voces IA listas
            </span>
          </div>
        )}
      </div>

      {/* Controls Bar: Style + AI Voice + Generate CTA */}
      <div className="p-3.5 sm:p-5 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Style Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Estilo:</span>
              <div className="flex items-center gap-1 p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg">
                {STYLE_OPTIONS.map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    disabled={isGenerating || isExporting}
                    onClick={() => setSelectedStyle(st.id)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      selectedStyle === st.id
                        ? 'bg-blue-700 text-white font-semibold'
                        : 'text-slate-600 dark:text-slate-300 hover:text-blue-800 dark:hover:text-blue-300'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>

            {/* AI Voice Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Voz IA:</span>
              <select
                value={selectedVoice}
                disabled={isGenerating || isExporting}
                onChange={(e) => setSelectedVoice(e.target.value)}
                className="px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-500"
              >
                {VOICE_OPTIONS.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="button"
            disabled={isGenerating || isExporting}
            onClick={handleGenerateExplainerVideo}
            className="w-full lg:w-auto px-4 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-55 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Generando Video...</span>
              </>
            ) : (
              <>
                <Video className="w-4 h-4" />
                <span>{video ? 'Regenerar Video con IA' : 'Generar Video Explicativo con IA'}</span>
              </>
            )}
          </button>
        </div>

        {/* Live Generation Status Banner */}
        {isGenerating && genStatus && (
          <div className="p-3 rounded-xl bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800/70 flex items-center gap-2.5 text-xs text-orange-950 dark:text-orange-200">
            <RefreshCw className="w-4 h-4 text-orange-600 dark:text-orange-400 animate-spin shrink-0" />
            <span className="font-medium">{genStatus}</span>
          </div>
        )}

        {/* Warnings or Errors */}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 flex items-start gap-2.5 text-xs text-rose-900 dark:text-rose-200">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {ttsWarning && !errorMsg && (
          <div className="p-2.5 rounded-xl bg-orange-50/80 dark:bg-orange-950/40 border border-orange-200/80 dark:border-orange-800/70 text-xs text-orange-900 dark:text-orange-200">
            {ttsWarning}
          </div>
        )}
      </div>

      {/* Video Player Canvas & Playback Controls */}
      {video ? (
        <div className="p-3.5 sm:p-5 space-y-3.5 bg-white dark:bg-slate-900">
          {/* Responsive 16:9 Canvas Stage */}
          <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-[#0f172a] border border-slate-200 dark:border-slate-700 shadow-xs">
            <canvas
              ref={canvasRef}
              width={1280}
              height={720}
              onClick={() => {
                if (!isExporting) handleTogglePlay();
              }}
              className="w-full h-full block cursor-pointer"
            />

            {/* Center Play Overlay when paused */}
            {!isPlaying && !isExporting && (
              <button
                type="button"
                aria-label="Reproducir video explicativo"
                onClick={handleTogglePlay}
                className="absolute inset-0 flex items-center justify-center bg-blue-950/20 hover:bg-blue-950/30 transition-colors cursor-pointer group"
              >
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-orange-500 group-hover:bg-orange-400 text-white flex items-center justify-center shadow-lg transition-transform group-hover:scale-105">
                  <Play className="w-7 h-7 sm:w-8 sm:h-8 fill-current ml-1" />
                </div>
              </button>
            )}

            {/* Recording / Exporting Overlay Badge */}
            {isExporting && (
              <div className="absolute inset-x-3 top-3 sm:inset-x-4 sm:top-4 bg-blue-950/90 backdrop-blur border border-orange-400/50 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-white">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate">{exportStatus}</div>
                    <div className="text-[11px] font-mono text-orange-300 tabular-nums">
                      Progreso de exportación: {exportProgressPct}%
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCancelExport}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>Cancelar</span>
                </button>
              </div>
            )}
          </div>

          {/* Mobile-Friendly Playback Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 p-2.5 sm:p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
            {/* Transport Controls */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={isExporting || currentSceneIdx === 0}
                onClick={() => handleJumpToScene(Math.max(0, currentSceneIdx - 1))}
                aria-label="Escena anterior"
                className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-blue-900 dark:text-slate-200 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
              >
                <SkipBack className="w-4 h-4" />
              </button>

              <button
                type="button"
                disabled={isExporting}
                onClick={handleTogglePlay}
                className="px-3.5 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-4 h-4 text-orange-300" />
                    <span>Pausar</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 text-orange-300 fill-current" />
                    <span>Reproducir</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={isExporting || currentSceneIdx >= video.scenes.length - 1}
                onClick={() =>
                  handleJumpToScene(Math.min(video.scenes.length - 1, currentSceneIdx + 1))
                }
                aria-label="Escena siguiente"
                className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-blue-900 dark:text-slate-200 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>

            {/* Audio, CC, Speed & Export Actions */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const nextMuted = !isMuted;
                  setIsMuted(nextMuted);
                  if (nextMuted) stopActiveAudio();
                }}
                title={isMuted ? 'Activar voz' : 'Silenciar voz'}
                className={`p-2 rounded-lg border text-xs font-medium cursor-pointer ${
                  isMuted
                    ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:text-blue-800 dark:hover:text-blue-300'
                }`}
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={() => setShowSubtitles((prev) => !prev)}
                title="Mostrar u ocultar subtítulos"
                className={`px-2.5 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1 cursor-pointer ${
                  showSubtitles
                    ? 'bg-blue-700 border-blue-700 text-white'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                <Subtitles className="w-3.5 h-3.5" />
                <span>CC</span>
              </button>

              <select
                value={playbackRate}
                disabled={isExporting}
                onChange={(e) => setPlaybackRate(Number(e.target.value))}
                aria-label="Velocidad de reproducción"
                className="px-2 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono font-semibold text-slate-900 dark:text-slate-100 focus:outline-none"
              >
                <option value={0.9}>0.9x</option>
                <option value={1}>1.0x</option>
                <option value={1.15}>1.15x</option>
                <option value={1.25}>1.25x</option>
              </select>

              <button
                type="button"
                disabled={isGenerating || isExporting}
                onClick={handleExportVideo}
                className="px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Descargar Video</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadScript}
                className="px-2.5 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-orange-500 text-slate-700 dark:text-slate-200 text-xs font-medium flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <FileText className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
                <span className="hidden sm:inline">Guion</span>
              </button>
            </div>
          </div>

          {/* Interactive Swipeable Scene Timeline Strip */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            {video.scenes.map((sc, idx) => {
              const isCurrent = idx === currentSceneIdx;
              const hasAiVoice = Boolean(video.audioByScene[idx]);
              return (
                <button
                  key={sc.sceneNumber}
                  type="button"
                  disabled={isExporting}
                  onClick={() => handleJumpToScene(idx)}
                  className={`px-3 py-2 rounded-xl border text-left transition-colors shrink-0 max-w-[210px] cursor-pointer ${
                    isCurrent
                      ? 'bg-blue-700 border-blue-700 text-white'
                      : 'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-orange-500'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                    <span
                      className={
                        isCurrent
                          ? 'text-orange-200 font-bold'
                          : 'text-orange-600 dark:text-orange-400 font-semibold'
                      }
                    >
                      0{idx + 1} · {sc.visualType.toUpperCase()}
                    </span>
                    {hasAiVoice && (
                      <span
                        className={`text-[9px] font-sans font-semibold ${
                          isCurrent ? 'text-emerald-200' : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                        title="Voz IA lista"
                      >
                        Voz OK
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-semibold truncate mt-0.5">{sc.headline}</div>
                </button>
              );
            })}
          </div>

          {/* Collapsible Storyboard & Narration Script Viewer */}
          <div className="border-t border-slate-200 dark:border-slate-800 pt-2.5">
            <button
              type="button"
              onClick={() => setShowScriptDrawer((prev) => !prev)}
              className="w-full flex items-center justify-between text-xs font-semibold text-blue-900 dark:text-blue-300 hover:text-orange-600 dark:hover:text-orange-400 py-1 cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
                <span>Ver Guion Completo y Narración de las {video.scenes.length} Escenas</span>
              </span>
              {showScriptDrawer ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>

            {showScriptDrawer && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                {video.scenes.map((sc, idx) => (
                  <div
                    key={sc.sceneNumber}
                    onClick={() => handleJumpToScene(idx)}
                    className={`p-3.5 rounded-xl border text-xs space-y-1.5 cursor-pointer transition-colors ${
                      idx === currentSceneIdx
                        ? 'bg-orange-50/80 dark:bg-orange-950/30 border-orange-400 dark:border-orange-500'
                        : 'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 hover:border-orange-400'
                    }`}
                  >
                    <div className="font-mono font-bold text-orange-600 dark:text-orange-400">{sc.tag}</div>
                    <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{sc.headline}</div>
                    <p className="reading-content-sm text-slate-700 dark:text-slate-300">{sc.narration}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Clean Pre-Generation Preview Prompt */
        <div className="p-4 sm:p-6 bg-white dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
              ¿Qué incluirá este video explicativo?
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl">
              5 escenas animadas en formato panorámico (Tesis central, Pilares clave, Secuencia práctica, Caso en la vida real y Reglas accionables) narradas en español con voz IA, subtítulos sincronizados y descarga directa en video.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono text-slate-500 dark:text-slate-400 shrink-0">
            <span>1280×720 HD</span>
            <span aria-hidden="true">·</span>
            <span>Voz IA + Subtítulos</span>
          </div>
        </div>
      )}
    </section>
  );
}
