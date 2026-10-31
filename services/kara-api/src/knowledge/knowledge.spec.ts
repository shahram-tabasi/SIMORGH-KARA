import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { crc32 } from 'node:zlib';
import { extractText, unzip } from './extract';
import { parseMultistatus } from './knowledge.service';
import { unitForPath, visible } from './visibility';

const units = [['Engineering'], ['Engineering', 'Electrical'], ['Finance']];

test('exit check: a person cannot get a document of a unit they are not in', () => {
  assert.equal(visible(['Finance'], [['Engineering', 'Electrical']]), false);
  assert.equal(visible(['Engineering', 'Electrical'], [['Engineering']]), false); // a sub-unit's own item
  assert.equal(visible(['Engineering'], [['Engineering', 'Electrical']]), true);  // the parent unit's rule reaches below
  assert.equal(visible([], [['Finance']]), true);                                 // the whole company
  assert.equal(visible(['Finance'], []), false);                                  // no unit: only company-wide items
});

test('Nextcloud folders → units, deny by default', () => {
  assert.deepEqual(unitForPath('handbook.docx', units), []);
  assert.deepEqual(unitForPath('_all/policy.md', units), []);
  assert.deepEqual(unitForPath('Engineering/Electrical/spec.docx', units), ['Engineering', 'Electrical']);
  assert.deepEqual(unitForPath('Engineering/Electrical/2026/q1/notes.txt', units), ['Engineering', 'Electrical']);
  assert.deepEqual(unitForPath('Engineering/Mechanical/x.txt', units), ['Engineering']);
  assert.equal(unitForPath('Private-CEO/salaries.xlsx', units), null);
});

test('WebDAV multistatus', () => {
  const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
<d:response><d:href>/remote.php/dav/files/kara-reader/Kara/ekc/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:getetag>&quot;abc&quot;</d:getetag><oc:fileid>10</oc:fileid></d:prop></d:propstat></d:response>
<d:response><d:href>/remote.php/dav/files/kara-reader/Kara/ekc/%D9%82%D9%88%D8%A7%D9%86%DB%8C%D9%86.docx</d:href><d:propstat><d:prop><d:resourcetype/><d:getetag>&quot;e1&quot;</d:getetag><oc:fileid>42</oc:fileid><d:getcontentlength>1234</d:getcontentlength></d:prop></d:propstat></d:response>
</d:multistatus>`;
  const e = parseMultistatus(xml);
  assert.equal(e.length, 2);
  assert.equal(e[0].isDir, true);
  assert.equal(e[1].href.endsWith('قوانین.docx'), true);
  assert.equal(e[1].fileId, '42');
  assert.equal(e[1].etag, 'e1');
  assert.equal(e[1].size, 1234);
});

/** A zip with stored entries, enough to test the reader. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text); const n = Buffer.from(name); const crc = crc32(data);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt32LE(crc, 14);
    l.writeUInt32LE(data.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(l, n, data); centrals.push(c, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals); const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, e]);
}

test('docx text through the zip reader', () => {
  const docx = zip({ '[Content_Types].xml': '<x/>', 'word/document.xml':
    '<w:document><w:body><w:p><w:r><w:t>آیین‌نامه مرخصی</w:t></w:r></w:p><w:p><w:r><w:t>Rule &amp; 2</w:t></w:r></w:p></w:body></w:document>' });
  assert.equal(unzip(docx, () => true).size, 2);
  assert.equal(extractText('a.docx', docx), 'آیین‌نامه مرخصی\nRule & 2');
  assert.equal(extractText('a.md', Buffer.from('# hi')), '# hi');
  assert.equal(extractText('a.pdf', Buffer.from('%PDF')), null);
});
