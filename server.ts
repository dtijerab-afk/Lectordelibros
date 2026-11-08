import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type, GenerateContentResponse, ThinkingLevel } from '@google/genai';

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

const MODEL_CANDIDATES = ['gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];

function parseGeminiJson<T>(rawText: string | undefined, fallback: T): T {
  if (!rawText) return fallback;
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
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
        model === 'gemini-3.8-flash'
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
  const PORT = 3000;

  app.use(express.json({ limit: '15mb' }));

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
Tu objetivo es abarcar el 90% del contenido sustancial, argumentos, matices, ejemplos, cifras y enseñanzas de la obra para que el lector comprenda el libro a profundidad capítulo por capítulo.

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
            'Eres un Editor Literario y Consultor Estratégico especialista en síntesis exhaustiva de libros y su aplicación al mundo real de los negocios, el liderazgo y las empresas actuales. Tu misión es capturar el 90% del valor intelectual, narrativo y práctico del libro proporcionado, desarrollando cada capítulo con explicaciones completas de varios párrafos, definiciones precisas, casos reales y su adaptación práctica al mundo actual en español.',
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
                      description: 'Desarrollo exhaustivo y profundo del capítulo en 2 a 4 párrafos detallados (separados por "\\n\\n") que abarquen el 90% de los argumentos, explicaciones y mecanismos expuestos en el capítulo.',
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

  // 2. Endpoint: Generador Dinámico de Preguntas (Quiz de Opción Múltiple + Respuesta Abierta)
  app.post('/api/quiz', async (req: Request, res: Response) => {
    try {
      const {
        documentText,
        fileName,
        questionCount = 6,
        difficulty = 'Intermedio',
        quizMode = 'mixed',
      } = req.body as {
        documentText?: string;
        fileName?: string;
        questionCount?: number;
        difficulty?: string;
        quizMode?: 'multiple_choice' | 'open' | 'mixed';
      };

      if (!documentText || documentText.trim().length < 20) {
        res.status(400).json({
          error: 'Se requiere un documento cargado para generar la evaluación.',
        });
        return;
      }

      const count = Math.min(Math.max(Number(questionCount) || 6, 3), 12);
      const truncatedText = documentText.slice(0, 120000);

      const modeInstruction =
        quizMode === 'multiple_choice'
          ? 'Todas las preguntas deben ser de tipo "multiple_choice" con exactamente 4 opciones cada una.'
          : quizMode === 'open'
          ? 'Todas las preguntas deben ser de tipo "open" (respuesta abierta reflexiva/analítica).'
          : `Combina preguntas de opción múltiple ("multiple_choice", ~70%) y preguntas de respuesta abierta ("open", ~30%).`;

      const response = await generateWithFallback({
        contents: `Genera un cuestionario interactivo de ${count} preguntas con nivel de dificultad "${difficulty}" basado estrictamente en el documento "${fileName || 'Documento'}".\n${modeInstruction}\n\nCONTENIDO DEL DOCUMENTO:\n${truncatedText}`,
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
      const { documentText, question, userAnswer, rubricKeyPoints, explanation } = req.body as {
        documentText?: string;
        question?: string;
        userAnswer?: string;
        rubricKeyPoints?: string[];
        explanation?: string;
      };

      if (!question || !userAnswer || !userAnswer.trim()) {
        res.status(400).json({ error: 'Debes escribir una respuesta para poder evaluarla.' });
        return;
      }

      const contextExcerpt = (documentText || '').slice(0, 60000);

      const response = await generateWithFallback({
        contents: `Evalúa la respuesta del usuario a la siguiente pregunta abierta basándote exclusivamente en el documento.\n\nPREGUNTA: ${question}\nCRITERIOS ESPERADOS: ${(rubricKeyPoints || []).join('; ')}\nRESPUESTA MODELO: ${explanation || ''}\nRESPUESTA DEL USUARIO: ${userAnswer}\n\nEXTRACTO DEL DOCUMENTO:\n${contextExcerpt}`,
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
      const { documentText, fileName, history = [], message } = req.body as {
        documentText?: string;
        fileName?: string;
        history?: Array<{ role: 'user' | 'assistant'; content: string }>;
        message?: string;
      };

      if (!documentText || !message || !message.trim()) {
        res.status(400).json({ error: 'Se requiere un documento cargado y una pregunta válida.' });
        return;
      }

      const truncatedText = documentText.slice(0, 120000);
      const historyContext = history
        .slice(-8)
        .map((m) => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`)
        .join('\n\n');

      const response = await generateWithFallback({
        contents: `DOCUMENTO DE REFERENCIA ("${fileName || 'Documento'}"):\n${truncatedText}\n\n---\nHISTORIAL RECIENTE:\n${historyContext || 'Sin mensajes previos.'}\n\n---\nPREGUNTA ACTUAL DEL USUARIO:\n${message}`,
        config: {
          systemInstruction:
            'Eres un Asistente RAG (Retrieval-Augmented Generation) especializado exclusivamente en el documento cargado. Responde ÚNICAMENTE con base en la información contenida en el documento. Si la pregunta no puede responderse con el documento, indícalo explícitamente y señala qué temas relacionados sí aborda el texto. Incluye citas o referencias breves del documento.',
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

  if (process.env.NODE_ENV !== 'production') {
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
