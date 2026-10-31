import { inflateRawSync } from 'zlib';

// Text out of the document types the knowledge sync reads, with no extra
// dependency: plain text, Markdown, CSV, HTML, and the zip-based office
// formats (docx, odt, pptx, xlsx shared strings) through a small zip reader.
// PDF is not read here: upload PDFs to Kara's knowledge page, which extracts
// them, or keep a text/Word copy next to them in Nextcloud.

/** The entries of a zip archive, by name → bytes (stored or deflated). */
export function unzip(buf: Buffer, wanted: (name: string) => boolean): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // End of central directory: scan back from the end for its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + size);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data));
  }
  return out;
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : entities[e.toLowerCase()] ?? m);

/** XML or HTML → text, paragraphs kept as line breaks. */
export function xmlText(xml: string): string {
  return decode(xml
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(w:p|text:p|text:h|a:p|p|div|li|tr|h[1-6]|br)\s*>|<br\s*\/?>/gi, '\n')
    .replace(/<w:tab\/>|<text:tab\/>/g, '\t')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

const EXT = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '');

export const READABLE = new Set(['txt', 'md', 'csv', 'html', 'htm', 'docx', 'odt', 'pptx', 'odp', 'xlsx']);

/** The document's text, or null when its type is not read. */
export function extractText(name: string, buf: Buffer): string | null {
  const ext = EXT(name);
  switch (ext) {
    case 'txt': case 'md': case 'csv': return buf.toString('utf8');
    case 'html': case 'htm': return xmlText(buf.toString('utf8'));
    case 'docx': {
      const z = unzip(buf, (n) => n === 'word/document.xml');
      return xmlText(z.get('word/document.xml')?.toString('utf8') ?? '');
    }
    case 'odt': case 'odp': {
      const z = unzip(buf, (n) => n === 'content.xml');
      return xmlText(z.get('content.xml')?.toString('utf8') ?? '');
    }
    case 'pptx': {
      const z = unzip(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
      return [...z.entries()].sort(([a], [b]) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
        .map(([, v]) => xmlText(v.toString('utf8'))).join('\n\n');
    }
    case 'xlsx': {
      const z = unzip(buf, (n) => n === 'xl/sharedStrings.xml');
      return xmlText((z.get('xl/sharedStrings.xml')?.toString('utf8') ?? '').replace(/<\/si>/g, '</si>\n'));
    }
    default: return null;
  }
}
