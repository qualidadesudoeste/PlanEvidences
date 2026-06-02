// Extração de texto de PDF e DOCX. Usa dynamic import pra não inflar o bundle
// inicial — as libs (~600KB) só são baixadas quando o usuário clica em importar.

let pdfWorkerConfigured = false;

async function getPdfJs() {
  // Pega o módulo ESM. A v6 do pdfjs-dist é ESM-only e usa worker .mjs.
  const pdfjs: any = await import('pdfjs-dist');
  if (!pdfWorkerConfigured) {
    const workerUrl = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    pdfWorkerConfigured = true;
  }
  return pdfjs;
}

export async function extrairTextoPDF(file: File): Promise<string> {
  const pdfjs = await getPdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const linhas: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let ultimoY: number | null = null;
    let buf: string[] = [];
    for (const item of content.items as Array<{ str?: string; transform?: number[] }>) {
      if (!item.str || !item.transform) continue;
      const y = item.transform[5];
      if (ultimoY !== null && Math.abs(y - ultimoY) > 3) {
        const linha = buf.join('').trim();
        if (linha) linhas.push(linha);
        buf = [];
      }
      ultimoY = y;
      buf.push(item.str);
    }
    if (buf.length) {
      const linha = buf.join('').trim();
      if (linha) linhas.push(linha);
    }
  }

  return linhas
    .filter((l) => !/^P[áa]gina\s+\d+\s+de\s+\d+$/i.test(l)) // rodapé "Página N de M"
    .join('\n')
    .replace(/P[áa]gina\s+\d+\s+de\s+\d+/gi, '');
}

function decodeXmlEntities(s: string): string {
  return (s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

export async function extrairTextoDOCX(file: File): Promise<string> {
  const { default: JSZip } = await import('jszip');
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('DOCX inválido: word/document.xml não encontrado');

  const xml = await docFile.async('string');
  const linhas: string[] = [];
  const paraRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let paraMatch: RegExpExecArray | null;
  while ((paraMatch = paraRegex.exec(xml)) !== null) {
    const textoRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    const partes: string[] = [];
    let textoMatch: RegExpExecArray | null;
    while ((textoMatch = textoRegex.exec(paraMatch[0])) !== null) {
      partes.push(textoMatch[1]);
    }
    const linha = decodeXmlEntities(partes.join('')).trim();
    if (linha) linhas.push(linha);
  }
  return linhas.join('\n');
}

export async function extrairTextoDeArquivo(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return extrairTextoPDF(file);
  if (ext === 'docx') return extrairTextoDOCX(file);
  throw new Error(`Formato não suportado: ${ext}`);
}
