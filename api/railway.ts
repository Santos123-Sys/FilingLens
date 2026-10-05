import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import app from "./boot";

const CLIENT_DIR = "./dist/client";
const INDEX_HTML = resolve(process.cwd(), CLIENT_DIR, "index.html");

// Serve the built frontend. Registered after the /api routes in ./boot, which
// terminate their own requests (including the /api/* 404 catch-all), so this
// only ever sees non-API traffic.
app.use("*", serveStatic({ root: CLIENT_DIR }));

// SPA fallback: unmatched GET requests that accept HTML get index.html so
// client-side routing works on deep links and refreshes.
app.get("*", async (c) => {
  if (c.req.path.startsWith("/api/") || !c.req.header("accept")?.includes("text/html")) {
    return c.notFound();
  }
  try {
    return c.html(await readFile(INDEX_HTML, "utf8"));
  } catch {
    return c.notFound();
  }
});

const port = Number(process.env.PORT || 3000);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`FilingLens listening on http://0.0.0.0:${info.port}`);
});
