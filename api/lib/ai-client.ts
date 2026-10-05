/**
 * ai-client.ts — 网站大模型能力客户端（平台预置，拷进项目后请勿改契约）
 *
 * OpenAI API error classification for the filing-analysis workflow.
 *
 * **对话本身不在这里** —— 对话直接用预装的 AI SDK（`ai` + `@ai-sdk/openai`）：
 * `streamText` / `generateText` / `generateObject`，见 skill `website-ai`。
 * It maps SDK errors to user-recoverable application states.
 *
 * 生图/生视频/生语音**不在本技能范围**（本批只有 LLM 接入）。
 *
 * Environment variable: OPENAI_API_KEY. It is server-only and must never reach the browser.
 *
 * 这两个变量由平台写进项目根的 .env。网站运行时由后端加载；独立脚本
 * （npx tsx xxx.ts）不会自动加载 —— 本模块兜底调一次 process.loadEnvFile()
 * （Node >= 20.12，已存在的变量优先），仍读不到才报 AiMisconfigured。
 * If the key is not configured, the site returns an explicit setup error.
 *
 * 运行环境适配：不声明 process / Buffer 等全局（会与 @types/node 打架），
 * 环境变量用 globalThis 收窄读取。
 */

interface NodeLikeProcess {
  env?: Record<string, string | undefined>;
  /** Node >= 20.12：把 .env 加载进 process.env（已存在的变量优先，不覆盖） */
  loadEnvFile?: (path?: string) => void;
}

let envFileLoaded = false;

function loadEnvFileOnce(): void {
  if (envFileLoaded) return;
  envFileLoaded = true;
  const proc = (globalThis as { process?: NodeLikeProcess }).process;
  if (typeof proc?.loadEnvFile !== "function") return;
  try {
    proc.loadEnvFile();
  } catch {
    // 没有 .env / 运行时不支持 —— 保持原样，走正常的「未供给」报错
  }
}

function readEnv(key: string): string | undefined {
  const proc = (globalThis as { process?: NodeLikeProcess }).process;
  const value = proc?.env?.[key];
  if (value !== undefined && value !== "") return value;
  loadEnvFileOnce();
  return proc?.env?.[key];
}

// ---------- 错误类型（调用方直接分支，不必再解 HTTP 码） ----------

/** 终态：额度耗尽 / 权益不可用。**不要重试** */
export class AiUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailable";
  }
}

/** 终态：内容/安全拒绝。提示用户改写输入 */
export class ContentRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentRejected";
  }
}

/** 终态：凭证无效/缺失 —— 配置问题，需重新部署 */
export class AiMisconfigured extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiMisconfigured";
  }
}

/** 终态：入参非法。开发期错误，应上报日志 */
export class AiInvalidRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiInvalidRequest";
  }
}

/**
 * 可重试：429 / 408 / 424 / 5xx。
 *
 * **本模块自己不重试** —— 是否重试由调用方决定（见 skill `website-ai` 的错误一节）：
 * 计费型调用重试可能重复扣站长额度（5xx 或客户端超时都不能证明服务端没执行）。
 * `classifyAiError` 只是把这类错误标出来，不会替你重发请求。
 */
export class AiTransient extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiTransient";
  }
}

interface ErrorBody {
  error?: { type?: string; message?: string; code?: string };
  message?: string;
}

// ---------- 配置与错误映射 ----------

/**
 * 把网关的 HTTP 状态与 error.type 映射成带语义的类型。
 *
 * 注意：**非法枚举值网关不报错**（归一化后仍 200），所以枚举校验只能放在客户端。
 */
export function mapAiError(status: number, body: ErrorBody | undefined, raw: string): Error {
  const type = body?.error?.type ?? "";
  const detail = body?.error?.message ?? body?.message ?? raw.slice(0, 300);

  // 额度耗尽：PRD 写 402，现网实际是 403 + access_terminated_error
  if (type === "access_terminated_error") {
    return new AiUnavailable("额度耗尽，此功能不可用");
  }
  if (type.includes("content") || type.includes("moderation")) {
    return new ContentRejected(detail || "内容被拒绝");
  }
  switch (status) {
    case 401:
      return new AiMisconfigured("OpenAI API key is invalid or missing");
    case 402:
      return new AiUnavailable("OpenAI billing is unavailable");
    case 400:
      return type === "payment_required"
        ? new AiUnavailable("OpenAI billing is unavailable")
        : new AiInvalidRequest(detail || "Invalid OpenAI request");
    case 403:
      return new AiUnavailable(detail || "OpenAI access is unavailable");
    case 429:
      return new AiTransient("OpenAI is rate-limiting requests");
    case 408:
    case 424:
      return new AiTransient(detail || "OpenAI is temporarily unavailable");
    default:
      if (status >= 500) return new AiTransient("OpenAI is temporarily unavailable");
      return new AiInvalidRequest(detail || `OpenAI request failed (HTTP ${status})`);
  }
}

/**
 * 把 AI SDK 抛出的错误归类成上面的类型。
 *
 * SDK 的错误里带着网关响应的状态与 body（不同版本字段名略有差异，这里都兜），
 * 拿不到结构化信息时按可重试处理 —— 网络层错误通常确实是瞬时的。
 *
 * 用法：
 * ```ts
 * try {
 *   return await streamText({ model, messages });
 * } catch (err) {
 *   throw classifyAiError(err);   // 调用方据此分支，不必再解 HTTP 码
 * }
 * ```
 *
 * 注意：本函数**不重试**。拿到 `AiTransient` 后要不要重发由调用方决定 ——
 * 计费型调用重试可能重复扣费，见 skill `website-ai` 的错误一节。
 */
export function classifyAiError(err: unknown): Error {
  if (
    err instanceof AiUnavailable ||
    err instanceof ContentRejected ||
    err instanceof AiMisconfigured ||
    err instanceof AiInvalidRequest ||
    err instanceof AiTransient
  ) {
    return err;
  }

  const anyErr = err as {
    status?: number;
    statusCode?: number;
    response?: { status?: number; body?: unknown };
    data?: unknown;
    error?: unknown;
    cause?: unknown;
    message?: string;
    responseBody?: unknown;
  };

  const status = anyErr?.status ?? anyErr?.statusCode ?? anyErr?.response?.status;
  let body: ErrorBody | undefined;
  // 提取优先级：结构化 data / response.body / error，最后兜 responseBody。
  // 兜底那一项是必要的：ai@6 的 APICallError 只在 body 能过 provider error
  // schema 时才带 `data`；body 不合 schema（如缺 error.message）时它停在
  // catch 分支，**只带 responseBody 裸 JSON 串**。少了这一项，403 +
  // access_terminated_error 会从「额度耗尽」静默降级成 ContentRejected。
  const rawBody =
    anyErr?.response?.body ?? anyErr?.data ?? anyErr?.error ?? anyErr?.responseBody;
  if (rawBody && typeof rawBody === "object") {
    body = rawBody as ErrorBody;
  } else if (typeof rawBody === "string") {
    try {
      body = JSON.parse(rawBody) as ErrorBody;
    } catch {
      body = undefined;
    }
  }

  if (typeof status === "number") {
    return mapAiError(status, body, typeof rawBody === "string" ? rawBody : "");
  }

  // 无结构化状态：HTTP 之外的错误（连接失败、超时、流中断）
  return new AiTransient(anyErr?.message || "OpenAI request failed");
}

/** 该错误是否值得重试（只有 AiTransient 是） */
export function isRetryableAiError(err: unknown): boolean {
  return err instanceof AiTransient;
}

// ---------- 对外方法 ----------

/**
 * 可用模型清单。**站点不要硬编码模型 id**：可用集合由该站点的 scope/权益决定，
 * 会不告而变。显式传一个过期 id 不会被网关拒绝（原样回显），因此硬编码是静默降级。
 */
