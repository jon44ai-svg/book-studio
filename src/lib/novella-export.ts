// Pure export module: markdown, text, EPUB 3 (STORE zip), minimal PDF 1.4.
// Browser + Node safe: no node:* imports, no Buffer, no fs.

export type ExportDoc = {
  title: string
  author: string // may be empty
  date: string // ISO date string, e.g. '2026-10-14'
  chapters: Array<{ number: number; title: string; content: string }> // paragraphs separated by blank lines
}

const enc = new TextEncoder()
const dec = new TextDecoder()

const paras = (s: string) =>
  s
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)

const xesc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]!)

// ponytail: approximate Helvetica metrics (0.5em per char), good enough for wrapping.
const toAscii = (s: string) =>
  s
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u2014/g, '--')
    .replace(/\u2013/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '?')

const pdfEsc = (s: string) => s.replace(/[\\()]/g, '\\$&')

function wrap(s: string, size: number): string[] {
  const max = Math.floor(468 / (size * 0.5)) // 6.5in text width
  const out: string[] = []
  let cur = ''
  for (let w of toAscii(s).split(' ').filter(Boolean)) {
    if (w.length > max) {
      if (cur) out.push(cur)
      for (; w.length > max; w = w.slice(max)) out.push(w.slice(0, max))
      cur = w
      continue
    }
    if (cur && cur.length + 1 + w.length > max) {
      out.push(cur)
      cur = w
    } else cur = cur ? `${cur} ${w}` : w
  }
  if (cur) out.push(cur)
  return out
}

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(d: Uint8Array): number {
  let c = 0xffffffff
  for (const b of d) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const concat = (chunks: Uint8Array[]) => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

// STORE-only zip. DOS date 1980-01-01, time 0 => deterministic output.
function zip(files: Array<[string, string]>): Uint8Array {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [name, text] of files) {
    const nb = enc.encode(name)
    const data = enc.encode(text)
    const crc = crc32(data)
    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true)
    lh.setUint16(4, 20, true)
    lh.setUint16(6, 0x0800, true) // UTF-8 names
    lh.setUint16(12, 0x21, true)
    lh.setUint32(14, crc, true)
    lh.setUint32(18, data.length, true)
    lh.setUint32(22, data.length, true)
    lh.setUint16(26, nb.length, true)
    parts.push(new Uint8Array(lh.buffer), nb, data)

    const ch = new DataView(new ArrayBuffer(46))
    ch.setUint32(0, 0x02014b50, true)
    ch.setUint16(4, 20, true)
    ch.setUint16(6, 20, true)
    ch.setUint16(8, 0x0800, true)
    ch.setUint16(14, 0x21, true)
    ch.setUint32(16, crc, true)
    ch.setUint32(20, data.length, true)
    ch.setUint32(24, data.length, true)
    ch.setUint16(28, nb.length, true)
    ch.setUint32(42, offset, true)
    central.push(new Uint8Array(ch.buffer), nb)
    offset += 30 + nb.length + data.length
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0)
  const eo = new DataView(new ArrayBuffer(22))
  eo.setUint32(0, 0x06054b50, true)
  eo.setUint16(8, files.length, true)
  eo.setUint16(10, files.length, true)
  eo.setUint32(12, cdSize, true)
  eo.setUint32(16, offset, true)
  return concat([...parts, ...central, new Uint8Array(eo.buffer)])
}

function uuidFrom(s: string): string {
  const bytes = enc.encode(s)
  let hex = ''
  for (let k = 0; k < 4; k++) {
    let h = 0x811c9dc5 ^ Math.imul(k + 1, 0x9e3779b9)
    for (const b of bytes) h = Math.imul(h ^ b, 0x01000193)
    hex += (h >>> 0).toString(16).padStart(8, '0')
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export function validateDoc(doc: ExportDoc): string[] {
  const errs: string[] = []
  if (!doc.title.trim()) errs.push('title is empty')
  if (!doc.chapters.length) errs.push('no chapters')
  const seen = new Set<number>()
  for (const c of doc.chapters) {
    if (!c.content.trim()) errs.push(`chapter ${c.number} has empty content`)
    if (seen.has(c.number)) errs.push(`duplicate chapter number ${c.number}`)
    seen.add(c.number)
  }
  return errs
}

export function wordCount(doc: ExportDoc): number {
  return doc.chapters.reduce((n, c) => n + c.content.split(/\s+/).filter(Boolean).length, 0)
}

export function buildMarkdown(doc: ExportDoc): string {
  const lines = [`# ${doc.title}`, '']
  if (doc.author) lines.push(`By ${doc.author}`, '')
  lines.push(doc.date, '')
  for (const c of doc.chapters)
    lines.push(`## Chapter ${c.number}: ${c.title}`, '', ...paras(c.content).flatMap((p) => [p, '']))
  return lines.join('\n')
}

export function buildText(doc: ExportDoc): string {
  const lines = [doc.title, ...(doc.author ? [`By ${doc.author}`] : []), doc.date, '']
  for (const c of doc.chapters)
    lines.push(`CHAPTER ${c.number}`, c.title, '', ...paras(c.content).flatMap((p) => [p, '']))
  return lines.join('\n')
}

export function buildEpub(doc: ExportDoc): Uint8Array {
  const id = `urn:uuid:${uuidFrom(`${doc.title}|${doc.date}`)}`
  const modified = doc.date.includes('T') ? doc.date : `${doc.date}T00:00:00Z`
  const chs = doc.chapters.map((c, i) => ({
    n: i + 1,
    href: `chapters/ch${String(i + 1).padStart(2, '0')}.xhtml`,
    c,
  }))
  const page = (title: string, body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en"><head><title>${xesc(title)}</title></head><body>${body}</body></html>`
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${id}</dc:identifier>
<dc:title>${xesc(doc.title)}</dc:title>
<dc:language>en</dc:language>
${doc.author ? `<dc:creator>${xesc(doc.author)}</dc:creator>` : ''}
<dc:date>${xesc(doc.date)}</dc:date>
<meta property="dcterms:modified">${xesc(modified)}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="title" href="chapters/title.xhtml" media-type="application/xhtml+xml"/>
${chs.map((x) => `<item id="ch${x.n}" href="${x.href}" media-type="application/xhtml+xml"/>`).join('\n')}
</manifest>
<spine>
<itemref idref="title"/>
${chs.map((x) => `<itemref idref="ch${x.n}"/>`).join('\n')}
</spine>
</package>`
  const nav = page(
    'Contents',
    `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol><li><a href="chapters/title.xhtml">${xesc(doc.title)}</a></li>${chs
      .map((x) => `<li><a href="${x.href}">Chapter ${x.c.number}: ${xesc(x.c.title)}</a></li>`)
      .join('')}</ol></nav>`,
  )
  const titlePage = page(
    doc.title,
    `<h1>${xesc(doc.title)}</h1>${doc.author ? `<p>By ${xesc(doc.author)}</p>` : ''}<p>${xesc(doc.date)}</p>`,
  )
  const files: Array<[string, string]> = [
    ['mimetype', 'application/epub+zip'],
    [
      'META-INF/container.xml',
      `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    ],
    ['OEBPS/content.opf', opf],
    ['OEBPS/nav.xhtml', nav],
    ['OEBPS/chapters/title.xhtml', titlePage],
    ...chs.map((x): [string, string] => [
      `OEBPS/${x.href}`,
      page(
        `Chapter ${x.c.number}`,
        `<h2>Chapter ${x.c.number}: ${xesc(x.c.title)}</h2>${paras(x.c.content)
          .map((p) => `<p>${xesc(p)}</p>`)
          .join('')}`,
      ),
    ]),
  ]
  return zip(files)
}

export function buildPdf(doc: ExportDoc): Uint8Array {
  const pages: string[][] = []
  let ops: string[] = []
  let y = 720
  const newPage = () => {
    ops = []
    pages.push(ops)
    y = 720
  }
  const draw = (s: string, bold: boolean, size: number, x: number, yy: number) =>
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${yy} Td (${pdfEsc(toAscii(s))}) Tj ET`)
  const flow = (s: string, bold: boolean, size: number, lead: number) => {
    for (const line of wrap(s, size)) {
      if (y - lead < 72) newPage()
      draw(line, bold, size, 72, y)
      y -= lead
    }
  }

  // Title page
  newPage()
  let cy = 520
  const center = (s: string, bold: boolean, size: number) => {
    draw(s, bold, size, Math.max(36, (612 - toAscii(s).length * size * 0.5) / 2), cy)
    cy -= size * 1.5
  }
  for (const s of wrap(doc.title, 24)) center(s, true, 24)
  cy -= 12
  if (doc.author) center(doc.author, false, 14)
  center(doc.date, false, 12)

  // Chapters: each starts on a fresh page
  for (const c of doc.chapters) {
    newPage()
    flow(`Chapter ${c.number}: ${c.title}`, true, 16, 22)
    y -= 10
    for (const p of paras(c.content)) {
      flow(p, false, 11, 14)
      y -= 8
    }
  }

  // Footer page numbers
  pages.forEach((p, i) => p.push(`BT /F1 9 Tf 300 40 Td (${i + 1}) Tj ET`))

  // Objects: 1 catalog, 2 pages, 3 F1, 4 F2, 5 info, then (page, content) pairs
  const objs: string[] = []
  objs[1] = '<</Type/Catalog/Pages 2 0 R>>'
  objs[2] = `<</Type/Pages/Kids[${pages.map((_, i) => `${6 + 2 * i} 0 R`).join(' ')}]/Count ${pages.length}>>`
  objs[3] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'
  objs[4] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold>>'
  objs[5] = `<</Title(${pdfEsc(toAscii(doc.title))})/Author(${pdfEsc(toAscii(doc.author))})/Producer(book-studio)>>`
  pages.forEach((p, i) => {
    const body = p.join('\n')
    objs[6 + 2 * i] =
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 3 0 R/F2 4 0 R>>>>/Contents ${7 + 2 * i} 0 R>>`
    objs[7 + 2 * i] = `<</Length ${enc.encode(body).length}>>\nstream\n${body}\nendstream`
  })

  const offs: number[] = []
  let out = '%PDF-1.4\n'
  let len = enc.encode(out).length
  for (let id = 1; id < objs.length; id++) {
    const s = `${id} 0 obj\n${objs[id]}\nendobj\n`
    offs[id] = len
    out += s
    len += enc.encode(s).length
  }
  out +=
    `xref\n0 ${objs.length}\n0000000000 65535 f \n` +
    offs
      .slice(1)
      .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
      .join('') +
    `trailer\n<</Size ${objs.length}/Root 1 0 R/Info 5 0 R>>\nstartxref\n${len}\n%%EOF\n`
  return enc.encode(out)
}

export function selfCheck(): void {
  const check = (ok: boolean, msg: string) => {
    if (!ok) throw new Error(`novella-export selfCheck failed: ${msg}`)
  }
  const good: ExportDoc = {
    title: 'Test Book',
    author: 'A & B "Q"',
    date: '2026-10-14',
    chapters: [{ number: 1, title: 'Start', content: 'Hello \u201cworld\u201d.\n\nSecond \u2014 para.' }],
  }
  check(validateDoc(good).length === 0, 'validateDoc(good) should be []')
  check(validateDoc({ ...good, chapters: [] }).length > 0, 'zero chapters should be flagged')
  check(wordCount(good) === 5, `wordCount expected 5, got ${wordCount(good)}`)

  const text = buildText(good)
  check(text.includes('CHAPTER 1'), 'buildText missing "CHAPTER 1"')
  check(!/[#*]/.test(text), 'buildText contains markdown artifacts')
  check(buildMarkdown(good).startsWith('# '), 'buildMarkdown should start with "# "')

  check(crc32(enc.encode('123456789')) === 0xcbf43926, 'crc32("123456789") mismatch')
  const ep = buildEpub(good)
  const dv = new DataView(ep.buffer, ep.byteOffset, ep.byteLength)
  check(dec.decode(ep.subarray(0, 2)) === 'PK', 'epub should start with PK')
  check(dv.getUint32(0, true) === 0x04034b50, 'epub first local header signature missing')
  const nlen = dv.getUint16(26, true)
  check(dec.decode(ep.subarray(30, 30 + nlen)) === 'mimetype', 'first epub entry must be mimetype')
  check(dv.getUint16(8, true) === 0, 'mimetype must be STORE')
  const dstart = 30 + nlen
  check(
    dec.decode(ep.subarray(dstart, dstart + dv.getUint32(18, true))) === 'application/epub+zip',
    'mimetype content mismatch',
  )
  check(dv.getUint32(14, true) === crc32(enc.encode('application/epub+zip')), 'mimetype CRC mismatch')

  const pdf = buildPdf(good)
  const s = dec.decode(pdf)
  check(s.startsWith('%PDF-1.4'), 'pdf should start with %PDF-1.4')
  check(s.trimEnd().endsWith('%%EOF'), 'pdf should end with %%EOF')
  const sx = Number(s.trimEnd().split('\n').slice(-2)[0])
  check(s.startsWith('xref', sx), 'startxref does not point at xref')
  const entries = [...s.matchAll(/^(\d{10}) 00000 n/gm)].map((m) => Number(m[1]))
  check(entries.length > 0, 'no xref entries')
  entries.forEach((o, i) => check(s.startsWith(`${i + 1} 0 obj`, o), `xref entry ${i + 1} has wrong offset`))
}
