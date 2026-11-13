/**
 * Extrai o texto do GDD original em PDF, para o leitor de profissões.
 *
 *   npm install --no-save pdfjs-dist@4.10.38
 *   node cms-strapi/scripts/gdd-texto.mjs "<Smart Chain City.docx.pdf>" gdd.txt
 *
 * O PDF é da FGV Jr. e do cliente (Smart Chain City) e não é versionado; só o
 * catálogo que sai dele, em cms-strapi/seed/profissoes.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
const [file, out] = process.argv.slice(2);
if (!file || !out) {
  console.error('Uso: node cms-strapi/scripts/gdd-texto.mjs <gdd.pdf> <saida.txt>');
  process.exit(1);
}

const doc = await getDocument({ data: new Uint8Array(readFileSync(file)) }).promise;
let text = '';
for (let p = 1; p <= doc.numPages; p++) {
  const { items } = await (await doc.getPage(p)).getTextContent();
  let line = '';
  let lastY = null;
  for (const item of items) {
    const y = item.transform[5];
    // Mudou de altura: é outra linha.
    if (lastY !== null && Math.abs(y - lastY) > 2) {
      text += `${line.trimEnd()}\n`;
      line = '';
    }
    line += item.str + (item.hasEOL ? ' ' : '');
    lastY = y;
  }
  text += `${line.trimEnd()}\n\n=== página ${p} ===\n\n`;
}
writeFileSync(out, text);
console.log(`${doc.numPages} páginas, ${text.length} caracteres`);
