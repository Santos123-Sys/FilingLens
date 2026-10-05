import app from "../api/boot";

type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  OPENAI_API_KEY?: string;
};

export default {
  async fetch(request: Request, env: Env) {
    // Sites/Workers bindings live on `env`; mirror the server-side secret into
    // process.env before Hono handles the request so the OpenAI provider and
    // /api/status read the same configuration source.
    if (env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = env.OPENAI_API_KEY;

    if (new URL(request.url).pathname.startsWith("/api/")) return app.fetch(request);
    const asset = await env.ASSETS.fetch(request);
    if (asset.status === 404 && request.headers.get("accept")?.includes("text/html")) {
      return env.ASSETS.fetch(new Request(new URL("/", request.url), request));
    }
    return asset;
  },
};
