import { getDesktopBridge } from "../desktop";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let sessionToken = "";
let mediaAuthToken = "";
let bootstrapPromise: Promise<void> | null = null;
let localOnlyEnabled = false;

export function setLocalOnlyMode(enabled: boolean): void {
  localOnlyEnabled = Boolean(enabled);
}

export function isLocalOnlyMode(): boolean {
  return localOnlyEnabled;
}

export function getMediaTokenSync(): string {
  return mediaAuthToken;
}

/** Appends the HMAC media token for <video>, <audio>, HLS, or direct media downloads so protected routes authenticate. */
export function mediaAuthUrl(url: string): string {
  if (!url) return url;
  if (!mediaAuthToken) return url;
  if (!/^\/(?:stream|media(?:\/clip)?|api\/workspace\/file|api\/render\/native\/result)(?:$|\?)/i.test(url)) {
    return url;
  }
  if (/[?&]token=/.test(url)) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(mediaAuthToken)}`;
}

async function fetchBootstrapTokens(forceRefresh = false): Promise<void> {
  if (typeof window === "undefined") return;
  if (sessionToken && !forceRefresh) return;
  if (bootstrapPromise && !forceRefresh) return bootstrapPromise;

  bootstrapPromise = (async () => {
    try {
      const bridge = getDesktopBridge();
      if (bridge?.getBootstrapToken) {
        const res = await bridge.getBootstrapToken();
        if (res?.token) {
          sessionToken = res.token;
          mediaAuthToken = res.mediaToken || "";
          return;
        }
      }
      const res = await fetch("/api/auth/bootstrap", { method: "GET" });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (data && typeof data.token === "string") {
        sessionToken = data.token;
        mediaAuthToken = typeof data.mediaToken === "string" ? data.mediaToken : "";
      }
    } catch {
      /* server may still be starting */
    } finally {
      bootstrapPromise = null;
    }
  })();

  return bootstrapPromise;
}

export async function bootstrapAuth(forceRefresh = false): Promise<{ token: string; mediaToken: string }> {
  await fetchBootstrapTokens(forceRefresh);
  return { token: sessionToken, mediaToken: mediaAuthToken };
}

export function buildAuthHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  if (sessionToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${sessionToken}`);
  }
  if (localOnlyEnabled) {
    headers.set("X-Clipweave-Local-Only", "1");
  }
  return headers;
}

export async function getAuthHeaders(extra?: HeadersInit): Promise<Headers> {
  if (typeof window !== "undefined" && !sessionToken) {
    await fetchBootstrapTokens(false);
  }
  return buildAuthHeaders(extra);
}

function messageFrom(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const bag = data as Record<string, unknown>;
    const nested = bag.error;
    if (nested && typeof nested === "object" && typeof (nested as { message?: unknown }).message === "string") {
      return String((nested as { message: string }).message);
    }
    const value = bag.error ?? bag.detail ?? bag.message;
    if (typeof value === "string" && value.trim()) return value;
    if (value !== undefined && value !== null) return JSON.stringify(value);
  }
  return fallback;
}

async function throwFor(res: Response): Promise<never> {
  const text = await res.text().catch(() => "");
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  throw new ApiError(messageFrom(data, text.trim().slice(0, 200) || `Request failed (${res.status})`), res.status);
}

/** Fetch that rejects with the API's own message and transparently injects session + local-only headers. */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const isBrowser = typeof window !== "undefined";
  if (isBrowser && !sessionToken && path !== "/api/auth/bootstrap" && path !== "/api/health") {
    await fetchBootstrapTokens(false);
  }
  const hasAuthContext = Boolean(sessionToken || localOnlyEnabled);
  const nextInit: RequestInit | undefined = hasAuthContext
    ? { ...init, headers: buildAuthHeaders(init?.headers) }
    : init;

  let res = await fetch(path, nextInit);
  if (res.status === 401 && isBrowser && path !== "/api/auth/bootstrap") {
    await fetchBootstrapTokens(true);
    res = await fetch(path, { ...init, headers: buildAuthHeaders(init?.headers) });
  }
  if (!res.ok) await throwFor(res);
  return res;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  const text = await res.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError("The local API returned unreadable JSON.", res.status);
  }
}

export function apiPostJson<T>(path: string, body: unknown): Promise<T> {
  return apiJson<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
