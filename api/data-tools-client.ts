import { executionAbortSignal } from "./ai/execution";

const DATA_TOOLS_TIMEOUT_MS = 60_000;

export function dataToolsBaseUrl(): string | null {
  const value = process.env.FINANCIAL_DATA_SERVICE_URL?.trim();
  return value ? value.replace(/\/$/, "") : null;
}

export function dataToolsConfigured(): boolean {
  return Boolean(dataToolsBaseUrl());
}

export async function dataToolsJson<T>(path: string, payload: unknown, timeoutMs = DATA_TOOLS_TIMEOUT_MS): Promise<T> {
  const base = dataToolsBaseUrl();
  if (!base) throw new Error("financial_data_service_not_configured");
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
    signal: executionAbortSignal(timeoutMs),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`financial_data_service_${response.status}:${detail.slice(0, 500)}`);
  }
  return await response.json() as T;
}

export async function dataToolsBinary(path: string, payload: unknown, timeoutMs = 90_000): Promise<Response> {
  const base = dataToolsBaseUrl();
  if (!base) throw new Error("financial_data_service_not_configured");
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
    body: JSON.stringify(payload),
    signal: executionAbortSignal(timeoutMs),
  });
}
