declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfData { text: string; numpages: number; info?: unknown }
  function pdfParse(dataBuffer: Buffer, options?: unknown): Promise<PdfData>;
  export = pdfParse;
}
