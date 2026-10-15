// Markdown 内嵌 HTML 的识别与生成。只认少数几种标签(媒体、图片、折叠块、颜色),其余原样保留。

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;')
}

let parser: DOMParser | null = null

/** 把一段 HTML 解析成元素列表(忽略空白文本)。解析失败或含非空文本时返回 null。 */
export function parseHtmlElements(html: string): Element[] | null {
  parser ??= new DOMParser()
  const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html')
  const out: Element[] = []
  for (const child of Array.from(doc.body.childNodes)) {
    if (child.nodeType === 1) out.push(child as Element)
    else if (child.nodeType === 3 && (child.textContent ?? '').trim() !== '') return null
    else if (child.nodeType === 8) return null // 注释
  }
  return out
}

/** 恰好是一个元素时返回它。 */
export function parseSingleElement(html: string): Element | null {
  const els = parseHtmlElements(html)
  return els && els.length === 1 ? els[0] : null
}

export function parseInlineStyle(style: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!style) return out
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const key = decl.slice(0, i).trim().toLowerCase()
    const value = decl.slice(i + 1).trim()
    if (key && value) out[key] = value
  }
  return out
}

const OPEN_TAG = /^<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>$/
const CLOSE_TAG = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>$/

export function openTagName(html: string): string | null {
  const m = OPEN_TAG.exec(html.trim())
  return m && !m[0].endsWith('/>') ? m[1].toLowerCase() : null
}

export function closeTagName(html: string): string | null {
  const m = CLOSE_TAG.exec(html.trim())
  return m ? m[1].toLowerCase() : null
}
