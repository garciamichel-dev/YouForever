/**
 * Safe fetch utility to guarantee all responses are cleanly parsed without
 * throwing 'JSON.parse: unexpected character at line 1 column 1' on HTML fallbacks.
 */
export async function safeFetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<{ success: boolean; data?: T; error?: string; status: number }> {
  try {
    const res = await fetch(input, init);
    const text = await res.text();
    let parsed: any = null;
    if (text && text.trim()) {
      try {
        parsed = JSON.parse(text);
      } catch (_e) {
        // Plain text or HTML error page caught safely
        parsed = null;
      }
    }

    if (!res.ok) {
      return {
        success: false,
        error: parsed?.error || 'No pudimos completar tu solicitud en este momento. Inténtalo nuevamente.',
        status: res.status,
      };
    }

    if (parsed && typeof parsed === 'object') {
      return {
        success: parsed.success !== false,
        data: parsed.data !== undefined ? parsed.data : parsed,
        error: parsed.error,
        status: res.status,
      };
    }

    return {
      success: true,
      data: parsed as T,
      status: res.status,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: (err as Error)?.message || 'Error de conexión de red',
      status: 0,
    };
  }
}
