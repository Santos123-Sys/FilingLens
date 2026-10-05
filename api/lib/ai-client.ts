interface ErrorBody {
  error?: { type?: string; message?: string; code?: string };
  message?: string;
}

export class AiUnavailable extends Error {
  constructor(message: string) { super(message); this.name = "AiUnavailable"; }
}
export class ContentRejected extends Error {
  constructor(message: string) { super(message); this.name = "ContentRejected"; }
}
export class AiMisconfigured extends Error {
  constructor(message: string) { super(message); this.name = "AiMisconfigured"; }
}
export class AiInvalidRequest extends Error {
  constructor(message: string) { super(message); this.name = "AiInvalidRequest"; }
}
export class AiTransient extends Error {
  constructor(message: string) { super(message); this.name = "AiTransient"; }
}

export function mapAiError(status: number, body?: ErrorBody, raw = ""): Error {
  const type = body?.error?.type ?? "";
  const detail = body?.error?.message ?? body?.message ?? raw.slice(0, 300);
  if (type === "access_terminated_error" || type === "payment_required") {
    return new AiUnavailable(detail || "AI access is unavailable");
  }
  if (type.includes("content") || type.includes("moderation")) {
    return new ContentRejected(detail || "Content was rejected");
  }
  if (status === 401) return new AiMisconfigured("OpenAI API key is invalid or missing");
  if (status === 402 || status === 403) return new AiUnavailable(detail || "AI access is unavailable");
  if (status === 408 || status === 424 || status === 429 || status >= 500) {
    return new AiTransient(detail || "AI service is temporarily unavailable");
  }
  return new AiInvalidRequest(detail || `AI request failed (HTTP ${status})`);
}

export function classifyAiError(err: unknown): Error {
  if (err instanceof AiUnavailable || err instanceof ContentRejected || err instanceof AiMisconfigured || err instanceof AiInvalidRequest || err instanceof AiTransient) return err;
  const source = err as {
    status?: number;
    statusCode?: number;
    response?: { status?: number; body?: unknown };
    data?: unknown;
    error?: unknown;
    responseBody?: unknown;
    message?: string;
  };
  const status = source?.status ?? source?.statusCode ?? source?.response?.status;
  const rawBody = source?.response?.body ?? source?.data ?? source?.error ?? source?.responseBody;
  let body: ErrorBody | undefined;
  if (rawBody && typeof rawBody === "object") body = rawBody as ErrorBody;
  else if (typeof rawBody === "string") {
    try { body = JSON.parse(rawBody) as ErrorBody; } catch { /* ignore non-JSON provider body */ }
  }
  if (typeof status === "number") return mapAiError(status, body, typeof rawBody === "string" ? rawBody : "");
  return new AiTransient(source?.message || "AI request failed");
}

export function isRetryableAiError(err: unknown): boolean {
  return err instanceof AiTransient;
}
