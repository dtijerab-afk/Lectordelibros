const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return RAW_API_BASE ? `${RAW_API_BASE}${normalizedPath}` : normalizedPath;
}

export async function readApiJson<T = Record<string, unknown>>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const isGitHubPages =
      typeof window !== 'undefined' && window.location.hostname.endsWith('.github.io');
    if (isGitHubPages && !RAW_API_BASE) {
      throw new Error(
        'GitHub Pages solo aloja la interfaz estática. Para activar la IA aquí, configura la variable VITE_API_BASE_URL en tu repositorio de GitHub con la URL pública de tu servidor en Cloud Run y vuelve a ejecutar el despliegue.'
      );
    }
    throw new Error(
      `El servidor devolvió una respuesta inesperada (HTTP ${res.status}). Verifica que el backend de IA esté activo y accesible públicamente.`
    );
  }
  return (await res.json()) as T;
}
