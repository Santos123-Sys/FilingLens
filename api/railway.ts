import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFile } from "node:fs/promises";
import app from "./boot";

const clientRoot = "./dist/client";
const indexPath = `${clientRoot}/index.html`;

// Serve the Vite production bundle directly from the Node service.
app.use("*", serveStatic({ root: clientRoot }));

// Preserve client-side routing for non-API routes.
app.get("*", async (c) => {
  try {
    const html = await readFile(indexPath, "utf8");
    return c.html(html);
  } catch (error) {
    console.error("Failed to serve SPA index:", error);
    return c.text("Application frontend is unavailable", 503);
  }
});

const port = Number.parseInt(process.env.PORT ?? "3000", 10);

serve(
  {
    fetch: app.fetch,
    port: Number.isFinite(port) ? port : 3000,
    hostname: "0.0.0.0",
  },
  (info) => {
    console.log(`FilingLens listening on http://0.0.0.0:${info.port}`);
  },
);
