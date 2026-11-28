import dotenv from 'dotenv';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel, type GenerateContentResponse } from '@google/genai';
import stage3Router from './server/stage3Routes.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getAiClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const MODEL_CANDIDATES = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];

function getFinishReason(response: GenerateContentResponse): string {
  const reason = response.candidates?.[0]?.finishReason;
  return typeof reason === 'string' ? reason : 'UNKNOWN';
}

function parseGeminiJsonSafe<T>(
  rawText: string | undefined,
  fallback: T
): { data: T; ok: boolean } {
  if (!rawText) return { data: fallback, ok: false };
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return { data: JSON.parse(cleaned) as T, ok: true };
  } catch {
    // Attempt extracting outermost JSON object or array if stray prose wrapped it
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return { data: JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T, ok: true };
      } catch {
        // Fall through
      }
    }
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        return { data: JSON.parse(cleaned.slice(firstBracket, lastBracket + 1)) as T, ok: true };
      } catch {
        // Fall through
      }
    }
    return { data: fallback, ok: false };
  }
}

function parseGeminiJson<T>(rawText: string | undefined, fallback: T): T {
  return parseGeminiJsonSafe(rawText, fallback).data;
}

async function generateWithFallback(
  params: Omit<Parameters<ReturnType<typeof getAiClient>['models']['generateContent']>[0], 'model'>,
  preferredModel?: string
): Promise<GenerateContentResponse> {
  const ai = getAiClient();
  const candidates = preferredModel
    ? [preferredModel, ...MODEL_CANDIDATES.filter((m) => m !== preferredModel)]
    : MODEL_CANDIDATES;

  let lastError: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    try {
      const configWithThinking =
        model === 'gemini-4-hydrogen'
          ? {
              ...params.config,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            }
          : params.config;

      return await ai.models.generateContent({
        ...params,
        model,
        config: configWithThinking,
      });
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryableOnNextModel =
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('high demand') ||
        msg.includes('overloaded') ||
        msg.includes('429') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('404') ||
        msg.includes('NOT_FOUND') ||
        msg.includes('not found') ||
        msg.includes('not supported') ||
        msg.includes('500') ||
        msg.includes('INTERNAL');
      if (!isRetryableOnNextModel) {
        throw err;
      }
    }
  }
  throw lastError;
}

function formatGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('PERMISSION_DENIED') || raw.includes('403') || raw.includes('API_KEY_INVALID')) {
    return {
      status: 403,
      message:
        'Error de permisos o clave de API inválida. Verifica la clave configurada en el panel Settings > Secrets de AI Studio.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return {
      status: 429,
      message:
        'Límite de cuota excedido (429). Intenta nuevamente en unos segundos o actualiza tu clave en Settings > Secrets.',
    };
  }
  return {
    status: 500,
    message: `Error al procesar la solicitud con Gemini AI: ${raw}`,
  };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  const defaultAllowedOrigins = [
    'https://dtijerab-afk.github.io',
    'http://localhost:3000',
    'http://localhost:5173',
  ];
  const extraOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const allowedOrigins = new Set([...defaultAllowedOrigins, ...extraOrigins]);

  app.use((req, res, next) => {
    const origin = (req.headers.origin || '').replace(/\/+$/, '');
    if (origin && (allowedOrigins.has(origin) || allowedOrigins.has('*'))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, service: 'LecturaViva AI Backend' });
  });

  // Etapa 3: Evaluación Integral, Seguimiento del Aprendizaje y Control de Tokens
  app.use('/api/stage3', stage3Router);

  // 1. Endpoint: Análisis y Resumen Estructurado del Documento
  app.post('/api/analyze', async (req: Request, res: Response) => {
    try {
      const { documentText, fileName } = req.body as {
        documentText?: string;
        fileName?: string;
      };

      if (!documentText || documentText.trim().length < 20) {
        res.status(400).json({
          error: 'El contenido del documento está vacío o es demasiado corto para analizar.',
        });
        return;
      }

      const truncatedText = documentText.slice(0, 350000);

      const response = await generateWithFallback({
        contents: `Realiza un estudio exhaustivo, profundo y detallado del siguiente libro o documento titulado "${fileName || 'Libro adjunto'}".
Tu objetivo es abarcar el 100% del contenido sustancial, argumentos, matices, ejemplos, cifras y enseñanzas de la obra para que el lector comprenda el libro a profundidad capítulo por capítulo.

Instrucciones de profundidad para cada capítulo o sección en "chapters":
1. Extrae TODOS los capítulos o bloques temáticos principales del libro.
2. En "idea", explica con claridad la tesis central y argumento rector del capítulo.
3. En "analisisDetallado", desarrolla una explicación extensa y rigurosa (de 2 a 4 párrafos completos separados por saltos de línea "\\n\\n") desglosando todas las teorías, argumentos, pasos metodológicos, contrastes y matices que el autor expone en ese capítulo.
4. En "historia", relata con todo detalle las historias reales, estudios de caso, experimentos, ejemplos concretos o anécdotas mencionadas en ese capítulo.
5. En "conceptosClave", extrae de 3 a 5 términos, marcos o conceptos clave propios del capítulo con su definición detallada según el autor.
6. En "citaCapitulo", incluye una frase textual o idea memorable representativa del capítulo.
7. En "consejos", detalla de 4 a 6 lecciones prácticas, reglas de acción o conclusiones aplicables del capítulo.
8. En "preguntasReflexion", incluye 2 preguntas para aplicar lo aprendido en ese capítulo.
9. En "adaptacionMundoActual", adapta las enseñanzas del capítulo a un caso práctico de la vida real o del mundo actual (negocios, liderazgo, gestión de empresas, innovación o carrera profesional), incluyendo el escenario actual, el paralelo con el capítulo, un plan de acción de 3 a 4 pasos concretos, el error común a evitar y el indicador de éxito.

CONTENIDO DEL LIBRO / DOCUMENTO:\n${truncatedText}`,
        config: {
          systemInstruction:
            'Eres un Editor Literario y Consultor Estratégico especialista en síntesis exhaustiva de libros y su aplicación al mundo real de los negocios, el liderazgo y las empresas actuales. Tu misión es capturar el 100% del valor intelectual, narrativo y práctico del libro proporcionado, desarrollando cada capítulo con explicaciones completas de varios párrafos, definiciones precisas, casos reales y su adaptación práctica al mundo actual en español.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: {
                type: Type.STRING,
                description: 'Título completo del libro o documento analizado.',
              },
              authorOrSource: {
                type: Type.STRING,
                description: 'Nombre del autor o fuente principal identificada en el libro.',
              },
              executiveSummary: {
                type: Type.STRING,
                description: 'Sinopsis y síntesis ejecutiva amplia y profunda de 3 a 4 párrafos (separados por "\\n\\n") que abarque la tesis central, estructura y aporte completo de la obra.',
              },
              objectives: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Lista de 4 a 6 objetivos y pilares intelectuales del libro.',
              },
              keyPoints: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    heading: { type: Type.STRING, description: 'Título claro de la idea o tesis clave.' },
                    detail: {
                      type: Type.STRING,
                      description: 'Explicación completa y detallada de la idea con los argumentos, pruebas y matices del libro.',
                    },
                    category: {
                      type: Type.STRING,
                      description: 'Categoría temática corta (ej. Tesis, Estrategia, Psicología, Metodología, Práctica, Liderazgo).',
                    },
                  },
                  required: ['heading', 'detail', 'category'],
                },
                description: 'Lista de 8 a 12 ideas principales exhaustivamente explicadas.',
              },
              keyMetrics: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING, description: 'Nombre del principio, regla, cifra o ley del libro.' },
                    value: { type: Type.STRING, description: 'Valor, fórmula, regla o concepto corto.' },
                    context: { type: Type.STRING, description: 'Explicación de su significado e importancia dentro del libro.' },
                  },
                  required: ['label', 'value', 'context'],
                },
                description: 'Lista de 6 a 8 datos cuantitativos, principios, leyes o reglas clave de la obra.',
              },
              chapters: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    n: { type: Type.STRING, description: 'Número o identificador corto del capítulo (ej. "1", "2", "3").' },
                    titulo: { type: Type.STRING, description: 'Título completo del capítulo o sección.' },
                    subtitulo: { type: Type.STRING, description: 'Subtítulo descriptivo del enfoque o eje temático del capítulo.' },
                    idea: { type: Type.STRING, description: 'Tesis central del capítulo explicada con claridad y contundencia.' },
                    analisisDetallado: {
                      type: Type.STRING,
                      description: 'Desarrollo exhaustivo y profundo del capítulo en 2 a 4 párrafos detallados (separados por "\\n\\n") que abarquen el 100% de los argumentos, explicaciones y mecanismos expuestos en el capítulo.',
                    },
                    historia: {
                      type: Type.STRING,
                      description: 'Relato completo de los casos de estudio, ejemplos prácticos, experimentos, cifras y anécdotas narradas en el capítulo.',
                    },
                    conceptosClave: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          termino: { type: Type.STRING, description: 'Nombre del concepto, principio o término clave del capítulo.' },
                          definicion: { type: Type.STRING, description: 'Explicación detallada de cómo lo define y aplica el autor.' },
                        },
                        required: ['termino', 'definicion'],
                      },
                      description: 'De 3 a 5 conceptos o términos fundamentales explicados en este capítulo.',
                    },
                    citaCapitulo: {
                      type: Type.STRING,
                      description: 'Cita textual o frase clave destacada de este capítulo.',
                    },
                    consejos: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: 'De 4 a 6 lecciones prácticas, pasos accionables o reglas detalladas del capítulo.',
                    },
                    preguntasReflexion: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: '2 preguntas prácticas o de reflexión para aplicar este capítulo.',
                    },
                    adaptacionMundoActual: {
                      type: Type.OBJECT,
                      properties: {
                        ambito: {
                          type: Type.STRING,
                          description: 'Ámbito de aplicación (ej. "Negocios y Estrategia Empresarial", "Liderazgo y Gestión de Equipos", "Innovación y Startups").',
                        },
                        tituloCaso: {
                          type: Type.STRING,
                          description: 'Título atractivo del caso práctico en el mundo actual.',
                        },
                        escenarioActual: {
                          type: Type.STRING,
                          description: 'Descripción concreta de una situación o reto real en una empresa, equipo o negocio de hoy donde aplica este capítulo.',
                        },
                        paraleloConElLibro: {
                          type: Type.STRING,
                          description: 'Explicación de cómo la tesis y herramientas de este capítulo resuelven o transforman ese escenario actual.',
                        },
                        planDeAccion: {
                          type: Type.ARRAY,
                          items: { type: Type.STRING },
                          description: 'De 3 a 4 pasos tácticos concretos para ejecutar esta enseñanza en la empresa o vida real.',
                        },
                        errorComunEvitar: {
                          type: Type.STRING,
                          description: 'El error típico que cometen líderes o empresas hoy cuando ignoran este principio.',
                        },
                        indicadorExito: {
                          type: Type.STRING,
                          description: 'Métrica o señal práctica que confirma que la aplicación en el mundo real está dando resultados.',
                        },
                      },
                      required: [
                        'ambito',
                        'tituloCaso',
                        'escenarioActual',
                        'paraleloConElLibro',
                        'planDeAccion',
                        'errorComunEvitar',
                        'indicadorExito',
                      ],
                    },
                  },
                  required: [
                    'n',
                    'titulo',
                    'subtitulo',
                    'idea',
                    'analisisDetallado',
                    'historia',
                    'conceptosClave',
                    'citaCapitulo',
                    'consejos',
                    'preguntasReflexion',
                    'adaptacionMundoActual',
                  ],
                },
                description: 'Desglose exhaustivo de todos los capítulos o partes principales del libro.',
              },
              quotes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    texto: { type: Type.STRING, description: 'Cita textual o frase destacada extraída de la obra.' },
                    autor: { type: Type.STRING, description: 'Autor o capítulo de referencia de la cita.' },
                  },
                  required: ['texto', 'autor'],
                },
                description: 'Entre 6 y 10 frases o citas destacadas del libro.',
              },
              conclusions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Lista de 5 a 7 conclusiones profundas y enseñanzas prácticas aplicables de toda la obra.',
              },
              suggestedQuestions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '4 preguntas analíticas que el lector puede hacer al asistente sobre este libro.',
              },
            },
            required: [
              'title',
              'authorOrSource',
              'executiveSummary',
              'objectives',
              'keyPoints',
              'keyMetrics',
              'chapters',
              'quotes',
              'conclusions',
              'suggestedQuestions',
            ],
          },
        },
      });

      const parsed = parseGeminiJson<Record<string, unknown>>(response.text, {});
      res.json({
        title: typeof parsed.title === 'string' && parsed.title ? parsed.title : fileName || 'Libro Analizado',
        authorOrSource:
          typeof parsed.authorOrSource === 'string' && parsed.authorOrSource
            ? parsed.authorOrSource
            : 'Autor del libro',
        executiveSummary:
          typeof parsed.executiveSummary === 'string' && parsed.executiveSummary
            ? parsed.executiveSummary
            : 'Síntesis generada a partir del libro cargado.',
        objectives: Array.isArray(parsed.objectives) ? parsed.objectives : [],
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
        keyMetrics: Array.isArray(parsed.keyMetrics) ? parsed.keyMetrics : [],
        chapters: Array.isArray(parsed.chapters) ? parsed.chapters : [],
        quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [],
        conclusions: Array.isArray(parsed.conclusions) ? parsed.conclusions : [],
        suggestedQuestions: Array.isArray(parsed.suggestedQuestions) ? parsed.suggestedQuestions : [],
      });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 1B. Endpoint (Etapa 1): Detección y Validación de Estructura Completa de Capítulos
  app.post('/api/detect-structure', async (req: Request, res: Response) => {
    try {
      const {
        fileName,
        totalPages = 1,
        readablePages = 1,
        outline = [],
        tocExcerpt = '',
        headingCandidates = [],
        pageSamples = [],
      } = req.body as {
        fileName?: string;
        totalPages?: number;
        readablePages?: number;
        outline?: Array<{ title: string; pageNumber: number; level?: number }>;
        tocExcerpt?: string;
        headingCandidates?: Array<{ pageNumber: number; title: string; source?: string }>;
        pageSamples?: Array<{ pageNumber: number; preview: string }>;
      };

      if (!totalPages || totalPages < 1) {
        res.status(400).json({ error: 'Se requiere información estructural de páginas del documento.' });
        return;
      }

      const outlineBlock =
        Array.isArray(outline) && outline.length > 0
          ? outline.slice(0, 80).map((o) => `- Pág. ${o.pageNumber} (nivel ${o.level ?? 0}): ${o.title}`).join('\n')
          : 'No disponible.';

      const candidatesBlock =
        Array.isArray(headingCandidates) && headingCandidates.length > 0
          ? headingCandidates
              .slice(0, 120)
              .map((c) => `- Pág. ${c.pageNumber} [${c.source || 'texto'}]: ${c.title}`)
              .join('\n')
          : 'Sin candidatos automáticos explícitos.';

      const samplesBlock =
        Array.isArray(pageSamples) && pageSamples.length > 0
          ? pageSamples
              .slice(0, 70)
              .map((s) => `[Pág. ${s.pageNumber}] ${s.preview}`)
              .join('\n')
          : '';

      const response = await generateWithFallback({
        contents: `Identifica la estructura COMPLETA de TODOS los capítulos o secciones principales del libro "${fileName || 'Libro'}" (${totalPages} páginas totales, ${readablePages} páginas con texto legible).

REGLAS CRÍTICAS:
1. Devuelve TODOS los capítulos reales del libro desde el inicio hasta la página ${totalPages}. NUNCA colapses varios capítulos en uno solo.
2. Usa los números de página reales del archivo PDF (entre 1 y ${totalPages}) basándote en el índice nativo, los encabezados detectados y las muestras de páginas.
3. No incluyas como capítulos la portada, página de créditos/copyright ni la propia página de tabla de contenidos.
4. Si el libro no tiene títulos explícitos de capítulo pero tiene múltiples temas o bloques a lo largo de ${totalPages} páginas, divídelo en secciones lógicas ordenadas con sus páginas exactas de inicio y fin cubriendo todo el documento.
5. Los rangos startPage..endPage deben estar en orden creciente y cubrir el cuerpo completo del libro sin omitir los capítulos finales.

ÍNDICE NATIVO DEL PDF (OUTLINE):
${outlineBlock}

EXTRACTO DE TABLA DE CONTENIDOS (SI EXISTE):
${tocExcerpt || 'No detectada.'}

ENCABEZADOS CANDIDATOS DETECTADOS EN TODAS LAS PÁGINAS:
${candidatesBlock}

MUESTRAS DE INICIO DE PÁGINAS A LO LARGO DEL LIBRO:
${samplesBlock}`,
        config: {
          systemInstruction:
            'Eres un Especialista en Arquitectura Editorial y Segmentación de Libros. Tu única tarea es identificar con máxima precisión el título del libro, el autor y la lista completa de TODOS los capítulos/secciones con su página real de inicio (startPage) y fin (endPage) dentro del documento.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: 'Título completo del libro.' },
              authorOrSource: { type: Type.STRING, description: 'Autor o fuente principal del libro.' },
              chapters: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    n: { type: Type.STRING, description: 'Número o etiqueta corta del capítulo (ej. "1", "2", "Prólogo").' },
                    titulo: { type: Type.STRING, description: 'Título exacto y limpio del capítulo.' },
                    startPage: { type: Type.INTEGER, description: 'Página de inicio en el documento (1..totalPages).' },
                    endPage: { type: Type.INTEGER, description: 'Página final en el documento (startPage..totalPages).' },
                  },
                  required: ['n', 'titulo', 'startPage', 'endPage'],
                },
                description: 'Lista ordenada de TODOS los capítulos del libro.',
              },
            },
            required: ['title', 'authorOrSource', 'chapters'],
          },
        },
      });

      const { data: parsed, ok } = parseGeminiJsonSafe<Record<string, unknown>>(response.text, {});
      const finishReason = getFinishReason(response);

      res.json({
        title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : fileName || 'Libro Analizado',
        authorOrSource:
          typeof parsed.authorOrSource === 'string' && parsed.authorOrSource.trim()
            ? parsed.authorOrSource.trim()
            : 'Autor del libro',
        chapters: Array.isArray(parsed.chapters) ? parsed.chapters : [],
        finishReason,
        parsedOk: ok,
      });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 1C. Endpoint (Etapa 1): Análisis Profundo de un Capítulo Individual (con sub-fragmentación para capítulos extensos)
  app.post('/api/analyze-chapter', async (req: Request, res: Response) => {
    try {
      const {
        bookTitle,
        authorOrSource,
        chapterNumber,
        chapterTitle,
        startPage,
        endPage,
        chapterText,
      } = req.body as {
        bookTitle?: string;
        authorOrSource?: string;
        chapterNumber?: string;
        chapterTitle?: string;
        startPage?: number;
        endPage?: number;
        chapterText?: string;
      };

      if (!chapterText || chapterText.trim().length < 20) {
        res.status(400).json({
          error: `El capítulo "${chapterTitle || chapterNumber || ''}" no contiene texto digital legible suficiente para analizar.`,
        });
        return;
      }

      const rawText = chapterText.trim();
      let preparedChapterInput = rawText;
      let wasChunked = false;

      // Internal chunking for extraordinarily long chapters (> 90,000 chars) so nothing is silently truncated
      const MAX_SINGLE_CHAPTER_CHARS = 90000;
      if (rawText.length > MAX_SINGLE_CHAPTER_CHARS) {
        wasChunked = true;
        const CHUNK_SIZE = 72000;
        const subChunks: string[] = [];
        for (let offset = 0; offset < rawText.length; offset += CHUNK_SIZE) {
          subChunks.push(rawText.slice(offset, offset + CHUNK_SIZE));
        }

        const chunkSummaries: string[] = [];
        for (let cIdx = 0; cIdx < subChunks.length; cIdx++) {
          const chunkResp = await generateWithFallback({
            contents: `Resume de forma exhaustiva y fiel la parte ${cIdx + 1} de ${subChunks.length} del Capítulo ${chapterNumber || ''} ("${chapterTitle || ''}") del libro "${bookTitle || 'Libro'}". Conserva TODOS los argumentos, ejemplos, historias, cifras, conceptos definidos y citas textuales relevantes.\n\nTEXTO DE LA PARTE ${cIdx + 1}:\n${subChunks[cIdx]}`,
            config: {
              systemInstruction:
                'Eres un analista literario experto. Extraes síntesis detalladas y fieles por bloque sin omitir argumentos, ejemplos ni terminología del autor.',
            },
          });
          chunkSummaries.push(
            `=== BLOQUE ${cIdx + 1} DE ${subChunks.length} ===\n${chunkResp.text || subChunks[cIdx].slice(0, 6000)}`
          );
        }
        preparedChapterInput = chunkSummaries.join('\n\n');
      }

      const buildChapterPrompt = (conciseMode: boolean) => `Analiza en profundidad el siguiente capítulo del libro "${bookTitle || 'Libro'}"${authorOrSource ? ` (${authorOrSource})` : ''}.

CAPÍTULO ${chapterNumber || '1'}: "${chapterTitle || 'Capítulo'}"${startPage && endPage ? ` (Páginas ${startPage} a ${endPage})` : ''}

Instrucciones:
1. "idea": Tesis central y argumento rector del capítulo.
2. "analisisDetallado": ${conciseMode ? '2 párrafos claros y densos (separados por "\\n\\n")' : '2 a 4 párrafos completos y rigurosos (separados por "\\n\\n")'} cubriendo todos los argumentos, mecanismos y matices de este capítulo.
3. "historia": Relato concreto de los estudios de caso, historias, experimentos, cifras o ejemplos presentes en este capítulo.
4. "conceptosClave": 3 a 5 términos, marcos o conceptos clave propios de este capítulo con su definición según el autor.
5. "citaCapitulo": Una frase textual o pasaje representativo extraído de este capítulo.
6. "consejos": 4 a 5 lecciones prácticas o reglas accionables derivadas de este capítulo.
7. "preguntasReflexion": 2 preguntas prácticas para aplicar este capítulo.
8. "adaptacionMundoActual": Adapta las enseñanzas de ESTE capítulo a un caso realista del mundo actual (negocios, liderazgo o empresa) con escenario actual, paralelo con el capítulo, 3 a 4 pasos de plan de acción, error común a evitar e indicador de éxito.

CONTENIDO ÍNTEGRO DEL CAPÍTULO:
${preparedChapterInput}`;

      const chapterSchema = {
        type: Type.OBJECT,
        properties: {
          n: { type: Type.STRING },
          titulo: { type: Type.STRING },
          subtitulo: { type: Type.STRING },
          idea: { type: Type.STRING },
          analisisDetallado: { type: Type.STRING },
          historia: { type: Type.STRING },
          conceptosClave: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                termino: { type: Type.STRING },
                definicion: { type: Type.STRING },
              },
              required: ['termino', 'definicion'],
            },
          },
          citaCapitulo: { type: Type.STRING },
          consejos: { type: Type.ARRAY, items: { type: Type.STRING } },
          preguntasReflexion: { type: Type.ARRAY, items: { type: Type.STRING } },
          adaptacionMundoActual: {
            type: Type.OBJECT,
            properties: {
              ambito: { type: Type.STRING },
              tituloCaso: { type: Type.STRING },
              escenarioActual: { type: Type.STRING },
              paraleloConElLibro: { type: Type.STRING },
              planDeAccion: { type: Type.ARRAY, items: { type: Type.STRING } },
              errorComunEvitar: { type: Type.STRING },
              indicadorExito: { type: Type.STRING },
            },
            required: [
              'ambito',
              'tituloCaso',
              'escenarioActual',
              'paraleloConElLibro',
              'planDeAccion',
              'errorComunEvitar',
              'indicadorExito',
            ],
          },
        },
        required: [
          'n',
          'titulo',
          'subtitulo',
          'idea',
          'analisisDetallado',
          'historia',
          'conceptosClave',
          'citaCapitulo',
          'consejos',
          'preguntasReflexion',
          'adaptacionMundoActual',
        ],
      };

      const systemPrompt =
        'Eres un Editor Literario y Consultor Estratégico especialista en análisis profundo de capítulos de libros en español. Basas cada campo estrictamente en el texto real del capítulo proporcionado.';

      let response = await generateWithFallback({
        contents: buildChapterPrompt(false),
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
          responseSchema: chapterSchema,
        },
      });

      let finishReason = getFinishReason(response);
      let { data: parsed, ok } = parseGeminiJsonSafe<Record<string, unknown>>(response.text, {});

      // If truncated by MAX_TOKENS or unparseable JSON, retry once with tighter concise guard
      if (!ok || finishReason === 'MAX_TOKENS') {
        response = await generateWithFallback({
          contents: buildChapterPrompt(true),
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: 'application/json',
            responseSchema: chapterSchema,
          },
        });
        finishReason = getFinishReason(response);
        const retryResult = parseGeminiJsonSafe<Record<string, unknown>>(response.text, {});
        parsed = retryResult.data;
        ok = retryResult.ok;
      }

      if (!ok || (!parsed.idea && !parsed.analisisDetallado)) {
        res.status(502).json({
          error: `No se pudo obtener una respuesta estructurada completa para el Capítulo ${chapterNumber || ''} (finishReason: ${finishReason}).`,
          finishReason,
        });
        return;
      }

      res.json({
        n: typeof parsed.n === 'string' && parsed.n.trim() ? parsed.n.trim() : String(chapterNumber || '1'),
        titulo:
          typeof parsed.titulo === 'string' && parsed.titulo.trim()
            ? parsed.titulo.trim()
            : chapterTitle || `Capítulo ${chapterNumber || '1'}`,
        subtitulo: typeof parsed.subtitulo === 'string' ? parsed.subtitulo : '',
        idea: typeof parsed.idea === 'string' ? parsed.idea : '',
        analisisDetallado: typeof parsed.analisisDetallado === 'string' ? parsed.analisisDetallado : '',
        historia: typeof parsed.historia === 'string' ? parsed.historia : '',
        conceptosClave: Array.isArray(parsed.conceptosClave) ? parsed.conceptosClave : [],
        citaCapitulo: typeof parsed.citaCapitulo === 'string' ? parsed.citaCapitulo : '',
        consejos: Array.isArray(parsed.consejos) ? parsed.consejos.map(String) : [],
        preguntasReflexion: Array.isArray(parsed.preguntasReflexion)
          ? parsed.preguntasReflexion.map(String)
          : [],
        adaptacionMundoActual:
          parsed.adaptacionMundoActual && typeof parsed.adaptacionMundoActual === 'object'
            ? parsed.adaptacionMundoActual
            : undefined,
        startPage,
        endPage,
        charCount: rawText.length,
        wasChunked,
        finishReason,
        status: 'completed',
      });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 1D. Endpoint (Etapa 1): Síntesis Global Basada en TODOS los Capítulos Procesados
  app.post('/api/analyze-overview', async (req: Request, res: Response) => {
    try {
      const {
        fileName,
        bookTitle,
        authorOrSource,
        totalPages = 0,
        chapterSummaries = [],
      } = req.body as {
        fileName?: string;
        bookTitle?: string;
        authorOrSource?: string;
        totalPages?: number;
        chapterSummaries?: Array<{
          n: string;
          titulo: string;
          startPage?: number;
          endPage?: number;
          idea?: string;
          analisisDetallado?: string;
          historia?: string;
          conceptosClave?: Array<{ termino: string; definicion: string }>;
          citaCapitulo?: string;
          consejos?: string[];
        }>;
      };

      if (!Array.isArray(chapterSummaries) || chapterSummaries.length === 0) {
        res.status(400).json({ error: 'Se requieren capítulos procesados para generar la síntesis global.' });
        return;
      }

      // Build balanced digest across ALL processed chapters (never omitting closing chapters)
      const perChapterMax = Math.max(900, Math.floor(140000 / chapterSummaries.length));
      const chaptersDigest = chapterSummaries
        .map((ch) => {
          const range = ch.startPage && ch.endPage ? ` (Págs. ${ch.startPage}–${ch.endPage})` : '';
          const concepts = Array.isArray(ch.conceptosClave)
            ? ch.conceptosClave.map((c) => `${c.termino}: ${c.definicion}`).join(' | ')
            : '';
          const tips = Array.isArray(ch.consejos) ? ch.consejos.join(' ; ') : '';
          const block = [
            `### Capítulo ${ch.n}: ${ch.titulo}${range}`,
            ch.idea ? `Tesis: ${ch.idea}` : '',
            ch.analisisDetallado ? `Desarrollo: ${ch.analisisDetallado}` : '',
            ch.historia ? `Casos: ${ch.historia}` : '',
            concepts ? `Conceptos: ${concepts}` : '',
            ch.citaCapitulo ? `Cita: "${ch.citaCapitulo}"` : '',
            tips ? `Lecciones: ${tips}` : '',
          ]
            .filter(Boolean)
            .join('\n');
          return block.slice(0, perChapterMax);
        })
        .join('\n\n');

      const response = await generateWithFallback({
        contents: `Genera la síntesis ejecutiva global, pilares, ideas principales, métricas/leyes clave, citas destacadas, conclusiones y preguntas sugeridas para el libro "${bookTitle || fileName || 'Libro'}"${authorOrSource ? ` de ${authorOrSource}` : ''} (${totalPages} páginas, ${chapterSummaries.length} capítulos procesados).

IMPORTANTE: Integra equilibradamente TODOS los capítulos del libro (desde el Capítulo ${chapterSummaries[0].n} hasta el Capítulo ${chapterSummaries[chapterSummaries.length - 1].n}), reflejando la evolución completa de la obra.

SÍNTESIS COMPLETA DE TODOS LOS CAPÍTULOS:
${chaptersDigest}`,
        config: {
          systemInstruction:
            'Eres un Editor Jefe especialista en síntesis estratégica de libros completos en español. Integras el contenido de todos los capítulos procesados en una visión global coherente, rigurosa y accionable.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              authorOrSource: { type: Type.STRING },
              executiveSummary: {
                type: Type.STRING,
                description: 'Sinopsis ejecutiva global de 3 a 4 párrafos separados por "\\n\\n" cubriendo toda la obra.',
              },
              objectives: { type: Type.ARRAY, items: { type: Type.STRING } },
              keyPoints: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    heading: { type: Type.STRING },
                    detail: { type: Type.STRING },
                    category: { type: Type.STRING },
                  },
                  required: ['heading', 'detail', 'category'],
                },
              },
              keyMetrics: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    value: { type: Type.STRING },
                    context: { type: Type.STRING },
                  },
                  required: ['label', 'value', 'context'],
                },
              },
              quotes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    texto: { type: Type.STRING },
                    autor: { type: Type.STRING },
                  },
                  required: ['texto', 'autor'],
                },
              },
              conclusions: { type: Type.ARRAY, items: { type: Type.STRING } },
              suggestedQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: [
              'title',
              'authorOrSource',
              'executiveSummary',
              'objectives',
              'keyPoints',
              'keyMetrics',
              'quotes',
              'conclusions',
              'suggestedQuestions',
            ],
          },
        },
      });

      const parsed = parseGeminiJson<Record<string, unknown>>(response.text, {});
      res.json({
        title:
          typeof parsed.title === 'string' && parsed.title.trim()
            ? parsed.title.trim()
            : bookTitle || fileName || 'Libro Analizado',
        authorOrSource:
          typeof parsed.authorOrSource === 'string' && parsed.authorOrSource.trim()
            ? parsed.authorOrSource.trim()
            : authorOrSource || 'Autor del libro',
        executiveSummary:
          typeof parsed.executiveSummary === 'string' && parsed.executiveSummary.trim()
            ? parsed.executiveSummary.trim()
            : 'Síntesis global generada a partir de todos los capítulos procesados.',
        objectives: Array.isArray(parsed.objectives) ? parsed.objectives : [],
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
        keyMetrics: Array.isArray(parsed.keyMetrics) ? parsed.keyMetrics : [],
        quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [],
        conclusions: Array.isArray(parsed.conclusions) ? parsed.conclusions : [],
        suggestedQuestions: Array.isArray(parsed.suggestedQuestions) ? parsed.suggestedQuestions : [],
      });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 2. Endpoint: Generador Dinámico de Preguntas (Quiz de Opción Múltiple + Respuesta Abierta)
  app.post('/api/quiz', async (req: Request, res: Response) => {
    try {
      const {
        documentText,
        balancedContext,
        fileName,
        questionCount = 6,
        difficulty = 'Intermedio',
        quizMode = 'mixed',
      } = req.body as {
        documentText?: string;
        balancedContext?: string;
        fileName?: string;
        questionCount?: number;
        difficulty?: string;
        quizMode?: 'multiple_choice' | 'open' | 'mixed';
      };

      const sourceMaterial =
        balancedContext && balancedContext.trim().length >= 20
          ? balancedContext.slice(0, 140000)
          : (documentText || '').slice(0, 180000);

      if (!sourceMaterial || sourceMaterial.trim().length < 20) {
        res.status(400).json({
          error: 'Se requiere un documento cargado para generar la evaluación.',
        });
        return;
      }

      const count = Math.min(Math.max(Number(questionCount) || 6, 3), 12);

      const modeInstruction =
        quizMode === 'multiple_choice'
          ? 'Todas las preguntas deben ser de tipo "multiple_choice" con exactamente 4 opciones cada una.'
          : quizMode === 'open'
          ? 'Todas las preguntas deben ser de tipo "open" (respuesta abierta reflexiva/analítica).'
          : `Combina preguntas de opción múltiple ("multiple_choice", ~70%) y preguntas de respuesta abierta ("open", ~30%).`;

      const response = await generateWithFallback({
        contents: `Genera un cuestionario interactivo de ${count} preguntas con nivel de dificultad "${difficulty}" basado estrictamente en el libro "${fileName || 'Documento'}".
Distribuye las preguntas equitativamente a lo largo de TODOS los capítulos/secciones proporcionados (inicio, desarrollo y cierre del libro).
${modeInstruction}

CONTENIDO DEL DOCUMENTO:
${sourceMaterial}`,
        config: {
          systemInstruction:
            'Eres un Diseñador Instruccional y Evaluador Académico. Crea preguntas rigurosas que evalúen la comprensión real del documento proporcionado. Para opción múltiple, incluye exactamente 4 opciones plausibles donde solo 1 es correcta (correctIndex de 0 a 3). Incluye siempre una explicación clara basada en el texto y una cita o referencia concreta del documento.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                type: {
                  type: Type.STRING,
                  description: 'Valores permitidos: "multiple_choice" o "open".',
                },
                question: { type: Type.STRING, description: 'Enunciado claro de la pregunta.' },
                options: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: '4 opciones para multiple_choice, o arreglo vacío para open.',
                },
                correctIndex: {
                  type: Type.INTEGER,
                  description: 'Índice 0-3 de la respuesta correcta para multiple_choice, o 0 para open.',
                },
                explanation: {
                  type: Type.STRING,
                  description: 'Explicación detallada de la respuesta correcta basada en el documento.',
                },
                referenceQuote: {
                  type: Type.STRING,
                  description: 'Referencia o fragmento del documento que sustenta la respuesta.',
                },
                rubricKeyPoints: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: '2 a 4 puntos clave que debe incluir una buena respuesta.',
                },
              },
              required: [
                'id',
                'type',
                'question',
                'options',
                'correctIndex',
                'explanation',
                'referenceQuote',
                'rubricKeyPoints',
              ],
            },
          },
        },
      });

      const rawQuestions = parseGeminiJson<Array<Record<string, unknown>>>(response.text, []);
      const normalizedQuestions = (Array.isArray(rawQuestions) ? rawQuestions : []).map((q, idx) => ({
        id: typeof q.id === 'string' && q.id ? q.id : `q-${Date.now()}-${idx}`,
        type: q.type === 'open' ? 'open' : 'multiple_choice',
        question: typeof q.question === 'string' ? q.question : `Pregunta ${idx + 1}`,
        options: Array.isArray(q.options) ? q.options.map(String) : [],
        correctIndex: typeof q.correctIndex === 'number' ? q.correctIndex : 0,
        explanation: typeof q.explanation === 'string' ? q.explanation : '',
        referenceQuote: typeof q.referenceQuote === 'string' ? q.referenceQuote : '',
        rubricKeyPoints: Array.isArray(q.rubricKeyPoints) ? q.rubricKeyPoints.map(String) : [],
      }));
      res.json({ questions: normalizedQuestions });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 3. Endpoint: Evaluador de Respuestas Abiertas con Retroalimentación Inmediata
  app.post('/api/evaluate-open', async (req: Request, res: Response) => {
    try {
      const {
        documentText,
        retrievedContext,
        question,
        userAnswer,
        rubricKeyPoints,
        explanation,
      } = req.body as {
        documentText?: string;
        retrievedContext?: string;
        question?: string;
        userAnswer?: string;
        rubricKeyPoints?: string[];
        explanation?: string;
      };

      if (!question || !userAnswer || !userAnswer.trim()) {
        res.status(400).json({ error: 'Debes escribir una respuesta para poder evaluarla.' });
        return;
      }

      const contextExcerpt =
        retrievedContext && retrievedContext.trim().length >= 20
          ? retrievedContext.slice(0, 90000)
          : (documentText || '').slice(0, 120000);

      const response = await generateWithFallback({
        contents: `Evalúa la respuesta del usuario a la siguiente pregunta abierta basándote exclusivamente en el documento.\n\nPREGUNTA: ${question}\nCRITERIOS ESPERADOS: ${(rubricKeyPoints || []).join('; ')}\nRESPUESTA MODELO: ${explanation || ''}\nRESPUESTA DEL USUARIO: ${userAnswer}\n\nPASAJES RELEVANTES DEL DOCUMENTO:\n${contextExcerpt}`,
        config: {
          systemInstruction:
            'Eres un evaluador objetivo y pedagógico. Evalúa la respuesta del usuario del 0 al 100 según su fidelidad al documento. Considera isCorrect = true si el puntaje es >= 70. Explica qué acertó y qué le faltó mencionar según el texto.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isCorrect: { type: Type.BOOLEAN },
              score: { type: Type.INTEGER, description: 'Puntaje de 0 a 100.' },
              feedback: {
                type: Type.STRING,
                description: 'Retroalimentación directa, clara y constructiva basada en el texto.',
              },
              missingConcepts: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Conceptos clave del documento que faltaron o pueden profundizarse.',
              },
            },
            required: ['isCorrect', 'score', 'feedback', 'missingConcepts'],
          },
        },
      });

      const parsed = parseGeminiJson<Record<string, unknown>>(response.text, {});
      const score = typeof parsed.score === 'number' ? parsed.score : 0;
      res.json({
        isCorrect: typeof parsed.isCorrect === 'boolean' ? parsed.isCorrect : score >= 70,
        score,
        feedback:
          typeof parsed.feedback === 'string' && parsed.feedback
            ? parsed.feedback
            : 'Evaluación completada.',
        missingConcepts: Array.isArray(parsed.missingConcepts)
          ? parsed.missingConcepts.map(String)
          : [],
      });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 4. Endpoint: Chat Asistente sobre el Documento (RAG Contextual)
  app.post('/api/chat', async (req: Request, res: Response) => {
    try {
      const {
        documentText,
        retrievedContext,
        chapterDirectory,
        totalPages,
        fileName,
        history = [],
        message,
      } = req.body as {
        documentText?: string;
        retrievedContext?: string;
        chapterDirectory?: string;
        totalPages?: number;
        fileName?: string;
        history?: Array<{ role: 'user' | 'assistant'; content: string }>;
        message?: string;
      };

      const hasContext =
        (retrievedContext && retrievedContext.trim().length >= 20) ||
        (documentText && documentText.trim().length >= 20);

      if (!hasContext || !message || !message.trim()) {
        res.status(400).json({ error: 'Se requiere un documento cargado y una pregunta válida.' });
        return;
      }

      const contextBody =
        retrievedContext && retrievedContext.trim().length >= 20
          ? retrievedContext.slice(0, 90000)
          : (documentText || '').slice(0, 220000);

      const directorySection = chapterDirectory
        ? `\nÍNDICE COMPLETO DE CAPÍTULOS DEL LIBRO (${totalPages ? `${totalPages} páginas` : 'obra completa'}):\n${chapterDirectory.slice(0, 18000)}\n`
        : '';

      const historyContext = history
        .slice(-8)
        .map((m) => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`)
        .join('\n\n');

      const response = await generateWithFallback({
        contents: `DOCUMENTO DE REFERENCIA ("${fileName || 'Documento'}"):${directorySection}
PASAJES RECUPERADOS DEL DOCUMENTO (CON NÚMERO DE PÁGINA Y CAPÍTULO):
${contextBody}

---
HISTORIAL RECIENTE:
${historyContext || 'Sin mensajes previos.'}

---
PREGUNTA ACTUAL DEL USUARIO:
${message}`,
        config: {
          systemInstruction:
            'Eres un Asistente RAG (Retrieval-Augmented Generation) especializado exclusivamente en el documento cargado. Responde ÚNICAMENTE con base en la información contenida en los pasajes e índice del documento (incluyendo páginas intermedias o finales). Cuando cites información, indica la página o capítulo cuando esté disponible. Si la pregunta no puede responderse con el documento, indícalo explícitamente y señala qué temas relacionados sí aborda el texto.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              answer: {
                type: Type.STRING,
                description: 'Respuesta clara, bien estructurada (puede usar viñetas o párrafos) basada estrictamente en el documento.',
              },
              citations: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '1 a 3 fragmentos, datos o referencias textuales del documento que respaldan la respuesta.',
              },
              groundingStatus: {
                type: Type.STRING,
                description: 'Estado de respaldo: "Fundamentado en el documento", "Parcialmente en el documento" o "No mencionado en el documento".',
              },
            },
            required: ['answer', 'citations', 'groundingStatus'],
          },
        },
      });

      const parsed = parseGeminiJson<Record<string, unknown>>(response.text, {});
      res.json({
        answer:
          typeof parsed.answer === 'string' && parsed.answer
            ? parsed.answer
            : 'No se pudo extraer una respuesta directa del documento.',
        citations: Array.isArray(parsed.citations) ? parsed.citations.map(String) : [],
        groundingStatus:
          typeof parsed.groundingStatus === 'string' && parsed.groundingStatus
            ? parsed.groundingStatus
            : 'Fundamentado en el documento',
      });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 5. Endpoint: Adaptador Interactivo de Capítulo a Caso de la Vida Real / Mundo Actual
  app.post('/api/adapt-chapter', async (req: Request, res: Response) => {
    try {
      const {
        bookTitle,
        chapterNumber,
        chapterTitle,
        chapterIdea,
        chapterAnalysis,
        chapterStory,
        chapterConcepts = [],
        chapterTips = [],
        targetDomain = 'Negocios y Estrategia Empresarial',
        customContext = '',
      } = req.body as {
        bookTitle?: string;
        chapterNumber?: string;
        chapterTitle?: string;
        chapterIdea?: string;
        chapterAnalysis?: string;
        chapterStory?: string;
        chapterConcepts?: Array<{ termino: string; definicion: string }>;
        chapterTips?: string[];
        targetDomain?: string;
        customContext?: string;
      };

      if (!chapterTitle && !chapterIdea) {
        res.status(400).json({ error: 'Se requiere la información del capítulo para adaptarlo.' });
        return;
      }

      const conceptsText = Array.isArray(chapterConcepts)
        ? chapterConcepts.map((c) => `- ${c.termino}: ${c.definicion}`).join('\n')
        : '';
      const tipsText = Array.isArray(chapterTips) ? chapterTips.map((t) => `- ${t}`).join('\n') : '';

      const prompt = `Adapta de manera profunda, realista y accionable el siguiente capítulo del libro "${bookTitle || 'Libro en estudio'}" a un caso práctico de la vida real en el mundo actual.

ÁMBITO DE APLICACIÓN SELECCIONADO: ${targetDomain}
${customContext.trim() ? `CONTEXTO O CASO ESPECÍFICO DEL USUARIO: ${customContext.trim()}` : 'Crea un escenario contemporáneo sumamente realista (empresa moderna, equipo de trabajo, liderazgo directivo, startup o situación profesional actual) representativo de este ámbito.'}

DATOS DEL CAPÍTULO ${chapterNumber || ''}: "${chapterTitle || ''}"
- Tesis central: ${chapterIdea || ''}
- Análisis detallado: ${chapterAnalysis || ''}
- Casos del libro: ${chapterStory || ''}
- Conceptos clave:\n${conceptsText}
- Reglas prácticas:\n${tipsText}

Construye una adaptación completa que conecte directamente la teoría y ejemplos de este capítulo con decisiones reales que un líder, emprendedor, directivo o profesional debe tomar hoy.`;

      const response = await generateWithFallback({
        contents: prompt,
        config: {
          systemInstruction:
            'Eres un Consultor Senior de Estrategia, Liderazgo y Negocios (nivel Harvard Business Review / McKinsey). Tu especialidad es traducir capítulos de libros en casos prácticos del mundo actual (empresas reales, liderazgo de equipos, toma de decisiones, innovación, ventas y vida profesional) con planes de acción ejecutables paso a paso.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              ambito: {
                type: Type.STRING,
                description: 'Ámbito o sector aplicado (ej. "Liderazgo y Gestión de Equipos").',
              },
              tituloCaso: {
                type: Type.STRING,
                description: 'Título ejecutivo y concreto del caso práctico en el mundo actual.',
              },
              escenarioActual: {
                type: Type.STRING,
                description: 'Relato detallado (1 a 2 párrafos) del caso o dilema real en una empresa, equipo, negocio o entorno actual.',
              },
              paraleloConElLibro: {
                type: Type.STRING,
                description: 'Explicación profunda de cómo los conceptos, leyes y argumentos específicos de este capítulo se aplican para diagnosticar y resolver este caso actual.',
              },
              planDeAccion: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '4 pasos prácticos, concretos y medibles para implementar la solución desde mañana.',
              },
              errorComunEvitar: {
                type: Type.STRING,
                description: 'El error más frecuente en el mundo corporativo/profesional actual frente a esta situación y cómo evitarlo según el capítulo.',
              },
              indicadorExito: {
                type: Type.STRING,
                description: 'Métrica, KPI o señal observable que demuestra que la aplicación tuvo éxito en la realidad.',
              },
            },
            required: [
              'ambito',
              'tituloCaso',
              'escenarioActual',
              'paraleloConElLibro',
              'planDeAccion',
              'errorComunEvitar',
              'indicadorExito',
            ],
          },
        },
      });

      const parsed = parseGeminiJson<Record<string, unknown>>(response.text, {});
      res.json({
        ambito: typeof parsed.ambito === 'string' && parsed.ambito ? parsed.ambito : targetDomain,
        tituloCaso:
          typeof parsed.tituloCaso === 'string' && parsed.tituloCaso
            ? parsed.tituloCaso
            : `Aplicación práctica en ${targetDomain}`,
        escenarioActual:
          typeof parsed.escenarioActual === 'string' ? parsed.escenarioActual : '',
        paraleloConElLibro:
          typeof parsed.paraleloConElLibro === 'string' ? parsed.paraleloConElLibro : '',
        planDeAccion: Array.isArray(parsed.planDeAccion) ? parsed.planDeAccion.map(String) : [],
        errorComunEvitar:
          typeof parsed.errorComunEvitar === 'string' ? parsed.errorComunEvitar : '',
        indicadorExito:
          typeof parsed.indicadorExito === 'string' ? parsed.indicadorExito : '',
      });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // Helper: ensure returned TTS audio buffer has a valid WAV RIFF header (passes through untouched if already WAV)
  function ensureWavBuffer(rawBuffer: Buffer, sampleRate = 24000): Buffer {
    if (
      rawBuffer.length >= 12 &&
      rawBuffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      rawBuffer.subarray(8, 12).toString('ascii') === 'WAVE'
    ) {
      return rawBuffer;
    }
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = rawBuffer.length;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // PCM chunk size
    header.writeUInt16LE(1, 20); // PCM format
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    return Buffer.concat([header, rawBuffer]);
  }

  // 6. Endpoint: Generador de Guion y Escenas para Video Explicativo Narrado con IA
  app.post('/api/video-script', async (req: Request, res: Response) => {
    try {
      const {
        bookTitle,
        author,
        scope = 'chapter',
        chapterNumber,
        chapterTitle,
        chapterIdea,
        chapterAnalysis,
        chapterStory,
        chapterConcepts = [],
        chapterTips = [],
        realWorldCase,
        executiveSummary,
        keyPoints = [],
        conclusions = [],
        style = 'ejecutivo',
      } = req.body as {
        bookTitle?: string;
        author?: string;
        scope?: 'chapter' | 'book';
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
        style?: 'ejecutivo' | 'storytelling' | 'didactico';
      };

      const styleTone =
        style === 'storytelling'
          ? 'narrativo, envolvente y cinematográfico, conectando con historias y ejemplos memorables'
          : style === 'didactico'
          ? 'pedagógico, claro y paso a paso, ideal para aprender y recordar conceptos clave'
          : 'ejecutivo, directo y estratégico, orientado a decisiones y alto impacto';

      let sourceContext = '';
      if (scope === 'book') {
        if (!bookTitle && !executiveSummary) {
          res.status(400).json({ error: 'Se requiere la información del libro para crear el video.' });
          return;
        }
        const pointsText = (Array.isArray(keyPoints) ? keyPoints : [])
          .slice(0, 8)
          .map((kp) => `- ${kp.heading} (${kp.category}): ${kp.detail}`)
          .join('\n');
        const concText = (Array.isArray(conclusions) ? conclusions : [])
          .slice(0, 6)
          .map((c) => `- ${c}`)
          .join('\n');
        sourceContext = `TIPO DE VIDEO: Video-resumen explicativo completo del libro "${bookTitle || 'Libro'}"${author ? ` de ${author}` : ''}.
SINOPSIS EJECUTIVA:\n${executiveSummary || ''}
IDEAS PRINCIPALES:\n${pointsText}
CONCLUSIONES CLAVE:\n${concText}`;
      } else {
        if (!chapterTitle && !chapterIdea) {
          res.status(400).json({ error: 'Se requiere la información del capítulo para crear el video.' });
          return;
        }
        const conceptsText = (Array.isArray(chapterConcepts) ? chapterConcepts : [])
          .slice(0, 5)
          .map((c) => `- ${c.termino}: ${c.definicion}`)
          .join('\n');
        const tipsText = (Array.isArray(chapterTips) ? chapterTips : [])
          .slice(0, 5)
          .map((t) => `- ${t}`)
          .join('\n');
        const caseText = realWorldCase?.tituloCaso
          ? `\nCASO ACTUAL (${realWorldCase.ambito || 'Mundo actual'}): ${realWorldCase.tituloCaso}. ${realWorldCase.escenarioActual || ''}`
          : '';
        sourceContext = `TIPO DE VIDEO: Video explicativo del Capítulo ${chapterNumber || ''} ("${chapterTitle || ''}") del libro "${bookTitle || 'Libro'}"${author ? ` de ${author}` : ''}.
TESIS CENTRAL: ${chapterIdea || ''}
ANÁLISIS DETALLADO:\n${(chapterAnalysis || '').slice(0, 5000)}
HISTORIAS Y CASOS:\n${(chapterStory || '').slice(0, 2500)}
CONCEPTOS CLAVE:\n${conceptsText}
LECCIONES PRÁCTICAS:\n${tipsText}${caseText}`;
      }

      const response = await generateWithFallback({
        contents: `Crea un guion profesional de video explicativo de exactamente 5 escenas con estilo ${styleTone}, en español natural y fluido para ser narrado en voz alta.

${sourceContext}

REGLAS ESTRICTAS PARA LAS 5 ESCENAS:
1. Escena 1 (visualType: "thesis"): Gancho de apertura + tesis central.
2. Escena 2 (visualType: "pillars"): Los 3 pilares, conceptos o mecanismos fundamentales explicados de forma visual.
3. Escena 3 (visualType: "flow"): Cómo funciona en la práctica o secuencia paso a paso (3 pasos cortos).
4. Escena 4 (visualType: "case"): Historia, ejemplo concreto o aplicación al mundo real actual.
5. Escena 5 (visualType: "takeaways"): Cierre poderoso con 3 reglas accionables para aplicar hoy.

REGLAS DE REDACCIÓN:
- "headline": Título corto y visual de 4 a 8 palabras máximo (se verá grande en pantalla).
- "keyBullets": Entre 2 y 3 puntos visuales concisos (máximo 14 palabras por punto, ideales para leer en diapositiva animada).
- "highlightStat": Una frase corta, dato o regla memorable de máximo 6 palabras para destacar en tarjeta visual.
- "narration": Guion hablado en español natural (entre 35 y 55 palabras por escena, sin asteriscos, sin corchetes, sin markdown, listo para leer en voz alta por un narrador profesional).`,
        config: {
          systemInstruction:
            'Eres un Director Creativo y Guionista de Videos Explicativos Educativos y Ejecutivos (estilo TED-Ed / Harvard Business Review). Diseñas guiones visuales claros, rítmicos y precisos en español sin formato markdown en la narración.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              videoTitle: {
                type: Type.STRING,
                description: 'Título atractivo del video explicativo.',
              },
              subtitle: {
                type: Type.STRING,
                description: 'Subtítulo breve del tema del video.',
              },
              scenes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    sceneNumber: { type: Type.INTEGER },
                    tag: {
                      type: Type.STRING,
                      description: 'Etiqueta corta de la escena (ej. "01 · Tesis Central", "02 · Conceptos Clave").',
                    },
                    headline: {
                      type: Type.STRING,
                      description: 'Titular visual corto en pantalla (4 a 8 palabras).',
                    },
                    visualType: {
                      type: Type.STRING,
                      description: 'Uno de: "thesis", "pillars", "flow", "case", "takeaways".',
                    },
                    keyBullets: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: '2 a 3 puntos visuales cortos para mostrar en pantalla.',
                    },
                    highlightStat: {
                      type: Type.STRING,
                      description: 'Dato, principio o frase breve destacada (máximo 6 palabras).',
                    },
                    narration: {
                      type: Type.STRING,
                      description: 'Texto limpio y fluido para narrar en voz alta (35-55 palabras, sin markdown).',
                    },
                    accentTheme: {
                      type: Type.STRING,
                      description: 'Uno de: "amber", "indigo", "emerald", "rose".',
                    },
                  },
                  required: [
                    'sceneNumber',
                    'tag',
                    'headline',
                    'visualType',
                    'keyBullets',
                    'highlightStat',
                    'narration',
                    'accentTheme',
                  ],
                },
              },
            },
            required: ['videoTitle', 'subtitle', 'scenes'],
          },
        },
      });

      const parsed = parseGeminiJson<Record<string, unknown>>(response.text, {});
      const rawScenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
      const validTypes = ['thesis', 'pillars', 'flow', 'case', 'takeaways'];
      const validThemes = ['amber', 'indigo', 'emerald', 'rose'];

      const normalizedScenes = rawScenes.slice(0, 6).map((s: Record<string, unknown>, idx: number) => ({
        sceneNumber: idx + 1,
        tag: typeof s.tag === 'string' && s.tag ? s.tag : `Escena 0${idx + 1}`,
        headline: typeof s.headline === 'string' && s.headline ? s.headline : `Idea Clave ${idx + 1}`,
        visualType:
          typeof s.visualType === 'string' && validTypes.includes(s.visualType)
            ? s.visualType
            : validTypes[idx % validTypes.length],
        keyBullets: Array.isArray(s.keyBullets) ? s.keyBullets.map(String).slice(0, 4) : [],
        highlightStat: typeof s.highlightStat === 'string' ? s.highlightStat : '',
        narration:
          typeof s.narration === 'string'
            ? s.narration.replace(/[*_`#]/g, '').trim()
            : '',
        accentTheme:
          typeof s.accentTheme === 'string' && validThemes.includes(s.accentTheme)
            ? s.accentTheme
            : validThemes[idx % validThemes.length],
      }));

      res.json({
        videoTitle:
          typeof parsed.videoTitle === 'string' && parsed.videoTitle
            ? parsed.videoTitle
            : chapterTitle || bookTitle || 'Video Explicativo',
        subtitle:
          typeof parsed.subtitle === 'string' && parsed.subtitle
            ? parsed.subtitle
            : bookTitle || 'LecturaViva Studio',
        scenes: normalizedScenes,
      });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 7. Endpoint: Síntesis de Voz con IA (Gemini TTS - gemini-3.8-flash-lite-tts)
  app.post('/api/tts', async (req: Request, res: Response) => {
    try {
      const {
        text,
        voiceName = 'Kore',
        style = 'Narrador profesional en español claro, cálido y articulado para video explicativo',
      } = req.body as {
        text?: string;
        voiceName?: string;
        style?: string;
      };

      if (!text || !text.trim()) {
        res.status(400).json({ error: 'Se requiere texto para generar la narración de voz.' });
        return;
      }

      const allowedVoices = ['Kore', 'Charon', 'Puck', 'Fenrir', 'Zephyr'];
      const safeVoice = allowedVoices.includes(voiceName) ? voiceName : 'Kore';
      const cleanText = text.replace(/[*_`#]/g, '').trim().slice(0, 1200);

      const aiBeta = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        apiVersion: 'v1beta',
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const ttsAttempts: Array<{ model: string; withMetadata: boolean }> = [
        { model: 'gemini-3.8-flash-lite-tts', withMetadata: true },
        { model: 'gemini-3.8-flash-lite-tts', withMetadata: false },
        { model: 'gemini-3.8-flash-tts', withMetadata: false },
        { model: 'gemini-2.5-flash-preview-tts', withMetadata: false },
      ];
      let lastErr: unknown;

      for (const attempt of ttsAttempts) {
        try {
          const part: Record<string, unknown> = attempt.withMetadata
            ? {
                text: cleanText,
                speechMetadata: { style },
              }
            : {
                text: `Narra con tono profesional y natural en español: ${cleanText}`,
              };

          const response = await aiBeta.models.generateContent({
            model: attempt.model,
            contents: [
              {
                role: 'user',
                parts: [part],
              },
            ],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: safeVoice },
                },
              },
            },
          });

          const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
          if (inlineData?.data) {
            const rawBytes = Buffer.from(inlineData.data, 'base64');
            const wavBytes = ensureWavBuffer(rawBytes, 24000);
            res.json({
              audioBase64: wavBytes.toString('base64'),
              mimeType: 'audio/wav',
              voiceName: safeVoice,
            });
            return;
          }
        } catch (err: unknown) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          const canTryNext =
            msg.includes('503') ||
            msg.includes('UNAVAILABLE') ||
            msg.includes('429') ||
            msg.includes('404') ||
            msg.includes('NOT_FOUND') ||
            msg.includes('INVALID_ARGUMENT') ||
            msg.includes('400') ||
            msg.includes('overloaded');
          if (!canTryNext) {
            throw err;
          }
        }
      }

      throw lastErr || new Error('No se recibió audio del modelo de síntesis de voz.');
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`DocuMind AI Server running on http://localhost:${PORT}`);
  });
}

startServer();
