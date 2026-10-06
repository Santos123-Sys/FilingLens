import fs from "node:fs";

function replaceRequired(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`missing replacement target: ${label}`);
  return text.replace(from, to);
}

let home = fs.readFileSync("src/pages/Home.tsx", "utf8");
home = replaceRequired(home, "  Download,\n", "", "unused Download import");
home = replaceRequired(
  home,
  '        setPresentationBlob(new Blob([deck.bytes], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }));',
  '        const pptxBuffer = new ArrayBuffer(deck.bytes.byteLength);\n        new Uint8Array(pptxBuffer).set(deck.bytes);\n        setPresentationBlob(new Blob([pptxBuffer], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }));',
  "PowerPoint BlobPart",
);
home = replaceRequired(
  home,
  '      const planBody = await requestJson("/api/analysis-plan", { method: "GET" }, undefined, 1).catch(() => ({}));',
  '      const planBody: Record<string, unknown> = await requestJson("/api/analysis-plan", { method: "GET" }, undefined, 1).catch(() => ({}));',
  "analysis plan typing",
);
home = replaceRequired(
  home,
  '          diagnostics[agent] = (abody.diagnostic as ModuleDiagnostic | undefined)?.status\n            ? abody.diagnostic\n            : { status: "incomplete", reason: "response_diagnostic_missing" };',
  '          diagnostics[agent] = (abody.diagnostic as ModuleDiagnostic | undefined)?.status\n            ? (abody.diagnostic as ModuleDiagnostic)\n            : { status: "incomplete", reason: "response_diagnostic_missing" };',
  "diagnostic typing",
);
fs.writeFileSync("src/pages/Home.tsx", home);

let ppt = fs.readFileSync("src/lib/powerpoint.ts", "utf8");
ppt = replaceRequired(ppt, "const SLIDE_H = 7.5;\n", "", "unused slide height");
fs.writeFileSync("src/lib/powerpoint.ts", ppt);

let provider = fs.readFileSync("api/ai/provider.ts", "utf8");
provider = replaceRequired(
  provider,
  'const DEFAULT_MODEL = "gpt-6-sol";',
  'const DEFAULT_MODEL = "gpt-5.6-terra";',
  "default model pin",
);
fs.writeFileSync("api/ai/provider.ts", provider);

let contractTest = fs.readFileSync("api/analysis-contract.test.ts", "utf8");
contractTest = replaceRequired(
  contractTest,
  '    expect(computed.find(metric => metric.key === "roic")?.values).toEqual([null, 13.24]);\n  });',
  '    expect(computed.find(metric => metric.key === "roic")?.values).toEqual([null, 13.24]);\n  }, 20_000);',
  "exact Python integration test timeout",
);
fs.writeFileSync("api/analysis-contract.test.ts", contractTest);

// Remove this one-shot fixer and its trigger from the final tree.
fs.rmSync("scripts/fix-ci.mjs");
fs.rmSync(".github/workflows/fix-ci.yml");
