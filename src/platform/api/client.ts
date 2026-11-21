export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
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

/** Fetch that rejects with the API's own message. Every local endpoint goes through here. */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, init);
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
