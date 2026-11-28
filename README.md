# LecturaViva

Plataforma web de lectura profunda, análisis integral de libros en PDF/texto y evaluación interactiva con seguimiento del aprendizaje.

## Funcionalidades actuales (5 secciones)

1. **Mapa y Resumen:** síntesis ejecutiva, esquema estructural de la obra y verificación real de cobertura de páginas y capítulos.
2. **Ruta de Capítulos:** extracción estructurada por páginas, detección integral de capítulos y estudio progresivo capítulo por capítulo.
3. **Principios y Cifras Clave:** principios fundamentales, métricas, objetivos centrales y citas relevantes.
4. **Evaluación Interactiva:** evaluaciones por capítulo, evaluaciones integrales multi-capítulo (opción múltiple, verdadero/falso y preguntas abiertas con calificación asistida), seguimiento del aprendizaje y registro de tokens.
5. **Dialogar con el Libro:** chat contextual respaldado con recuperación de pasajes del documento completo.

Incluye además personalización de lectura (modo claro/oscuro, 6 tipografías y controles `A-`/`A+`) y persistencia local en IndexedDB (`LecturaVivaDB` y `LecturaVivaStage3DB`).

## Requisitos previos

- **Node.js 22+** (requerido para ejecutar `node server.ts` en producción con soporte nativo de TypeScript).
- **npm 10+** (incluido con Node.js).
- Una clave de API de Gemini configurada como variable de entorno en tu entorno local o proveedor de despliegue.

## Variables de entorno

Copia `.env.example` a `.env` y completa los valores correspondientes (nunca subas `.env` ni claves reales al repositorio):

```bash
cp .env.example .env
```

Variables definidas en `.env.example`:

- `GEMINI_API_KEY`: clave del backend para el procesamiento con Gemini AI.
- `APP_URL`: URL pública donde se aloja la aplicación.
- `VITE_API_BASE_URL`: opcional; URL del backend si el frontend estático se sirve desde otro dominio.
- `ALLOWED_ORIGINS`: opcional; lista separada por comas de orígenes permitidos en CORS.

## Instalación y ejecución local

```bash
# 1. Instalar dependencias
npm install

# 2. Verificar tipos de TypeScript
npm run lint

# 3. Ejecutar en modo desarrollo (Express + Vite en http://localhost:3000)
npm run dev
```

## Compilación y ejecución en producción

```bash
# 1. Compilar el frontend en dist/
npm run build

# 2. Iniciar servidor Express en producción (Node.js 22+)
NODE_ENV=production npm start
```

El servidor escucha en el puerto definido por `PORT` (por defecto `3000`) y expone:

- `GET /api/health`
- Endpoints de análisis, capítulos, cuestionario rápido y chat en `server.ts`
- Endpoints de evaluación integral, calificación abierta y modelos en `server/stage3Routes.ts` (`/api/stage3/models`, `/api/stage3/evaluation`, `/api/stage3/evaluate-open`)

## Estructura principal del paquete

- `index.html`, `vite.config.ts`, `tsconfig.json`, `package.json`, `metadata.json`
- `.env.example`, `.gitignore`, `.github/workflows/deploy.yml`
- `server.ts` y `server/stage3Routes.ts` (backend Express)
- `src/` (interfaz React, componentes, configuración de navegación, utilidades de PDF, segmentación, recuperación y persistencia IndexedDB)

## Notas para transferencia manual a GitHub

Este paquete está preparado para transferirse manualmente al repositorio destino `dtijerab-afk/Lectordelibros` en la rama `vercel-deployment`, excluyendo `node_modules/`, `dist/`, respaldos internos, archivos temporales y secretos:

1. Descomprime el archivo ZIP en una copia local de la rama `vercel-deployment`.
2. Revisa los cambios con `git status` y `git diff`.
3. Ejecuta `npm install`, `npm run lint` y `npm run build` para confirmar la integridad local.
4. Configura `GEMINI_API_KEY` únicamente en las variables de entorno del proveedor (nunca en el código ni en Git).
