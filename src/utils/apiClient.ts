/**
 * Resilient API client for ForeverYou.
 * Prevents "JSON.parse: unexpected character at line 1 column 1" when responses
 * are not valid JSON (e.g. HTML 500/404 pages or server cold starts),
 * and provides retry logic for transient NetworkErrors.
 */

export interface ApiResponse<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export interface ApiFetchOptions extends RequestInit {
  retries?: number;
  retryDelayMs?: number;
}

export async function apiFetch<T = any>(
  url: string,
  options: ApiFetchOptions = {}
): Promise<ApiResponse<T>> {
  const { retries = 1, retryDelayMs = 800, ...fetchInit } = options;

  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(url, fetchInit);
      const contentType = res.headers.get('content-type') || '';

      let payload: any = null;
      if (contentType.includes('application/json')) {
        try {
          payload = await res.json();
        } catch (jsonErr) {
          console.warn(`[apiClient] Failed to parse JSON from ${url}:`, jsonErr);
          return {
            ok: false,
            status: res.status,
            error: 'No pudimos procesar la respuesta en este momento. Por favor intenta de nuevo.',
          };
        }
      } else {
        const text = await res.text();
        return {
          ok: res.ok,
          status: res.status,
          error: res.ok
            ? undefined
            : 'Ocurrió un inconveniente al comunicar tu solicitud. Por favor intenta nuevamente.',
        };
      }

      if (!res.ok) {
        const errorMsg =
          payload?.error || payload?.message || 'No pudimos completar esta acción en este momento. Inténtalo de nuevo.';
        return {
          ok: false,
          status: res.status,
          data: payload?.data,
          error: errorMsg,
        };
      }

      return {
        ok: true,
        status: res.status,
        data: payload?.data !== undefined ? payload.data : payload,
      };
    } catch (err: unknown) {
      attempt++;
      const isNetworkError =
        err instanceof TypeError ||
        (err instanceof Error &&
          (err.name === 'NetworkError' ||
            err.message.includes('fetch') ||
            err.message.includes('Network') ||
            err.message.includes('Failed to fetch')));

      if (isNetworkError && attempt <= retries) {
        console.debug(`[apiClient] Transient network error on ${url}, retrying (${attempt}/${retries})...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        status: 0,
        error: 'No pudimos conectar en este momento. Revisa tu conexión a internet e intenta de nuevo.',
      };
    }
  }
}
