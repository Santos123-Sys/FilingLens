// Bundle one PDF.js version explicitly; dynamic filesystem imports cannot run on Sites.
// @ts-expect-error The legacy library does not ship TypeScript declarations.
import PDFJS from 'pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js';
export default async function pdfParse(bytes: Buffer, limits?:{maxPages:number;maxTextChars:number}): Promise<{text:string}> {
  PDFJS.disableWorker = true;
  const doc = await PDFJS.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,disableFontFace:true});
  try {
    if(limits&&doc.numPages>limits.maxPages)throw new Error('pdf_page_budget');
    let text = '';
    for (let i=1; i<=doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let y: number | undefined;
      for (const item of content.items) {
        text += (y !== undefined && y !== item.transform[5] ? '\n' : ' ') + item.str;
        if(limits&&text.length>limits.maxTextChars)throw new Error('pdf_text_budget');
        y = item.transform[5];
      }
      text += '\n\n';
      page.cleanup();
    }
    return {text};
  } finally { await doc.destroy(); }
}
