import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFile } from "node:fs/promises";
import app, { registerRegulatoryArchiver } from "./boot";
import { persistPublicRegulatorySnapshot, readPublicRegulatorySnapshots } from "./regulatory-snapshot-store";
import { registerHistoryApi } from "./history-api";
import { registerPrivateHistory } from "./private-history";

registerHistoryApi(app);
registerPrivateHistory(app);
registerRegulatoryArchiver(persistPublicRegulatorySnapshot);
app.get("/api/regulatory-history/:jurisdiction/:registryId",async c=>{
  const jurisdiction=c.req.param("jurisdiction");
  if(jurisdiction!=="us"&&jurisdiction!=="br")return c.json({error:"invalid_jurisdiction"},400);
  try{
   const snapshots=await readPublicRegulatorySnapshots(jurisdiction,c.req.param("registryId"));
   c.header("Cache-Control","no-store");
   return c.json({jurisdiction,registryId:c.req.param("registryId"),snapshots});
  }catch(error){
   console.warn("[regulatory-history] retrieval unavailable",error instanceof Error?error.name:"unknown");
   return c.json({error:"regulatory_history_unavailable"},503);
  }
});

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
