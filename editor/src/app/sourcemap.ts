// 源代码模式来回切换保持光标位置(PRD 3.10):文档位置 ↔ Markdown 原文偏移。
// 先按 serializeMarkdown 的拼接规则算出每个顶层块在原文里的起止,再在块内把「显示出来的文字」按顺序对齐到原文:
// 原文里多出来的是标记符号,顺序查找时自然跳过;原文里没有的字符(如 :smile: 显示成表情)直接略过。
import type { Node as PMNode } from 'prosemirror-model'
import { blockSources, type DocMeta } from '../core/markdown/parse'
import { markdownOptions, serializeBlock, type SerializeOptions } from '../core/markdown/serialize'
import { schema } from '../core/schema'

export interface SourceRange {
  from: number
  to: number
}

/** 每个顶层块在序列化文本里的范围。文本按源码编辑器的口径:换行统一为 \n,文首 BOM 算一个字符。 */
export function blockRanges(doc: PMNode, meta: DocMeta, options: SerializeOptions): SourceRange[] {
  const md = markdownOptions(meta, options)
  const ranges: SourceRange[] = []
  let offset = meta.bom ? 1 : 0
  let prev: PMNode | null = null
  doc.forEach((node, _pos, index) => {
    const src = blockSources.get(node)
    if (index === 0) {
      if (src?.index === 0) offset += meta.leading.length
    } else {
      const prevSrc = prev ? blockSources.get(prev) : undefined
      offset += (src && prevSrc && src.index === prevSrc.index + 1 ? src.gapBefore : '\n\n').length
    }
    const length = src ? src.text.length : index === 0 && node.type === schema.nodes.horizontal_rule ? 3 : serializeBlock(node, md).length
    ranges.push({ from: offset, to: offset + length })
    offset += length
    prev = node
  })
  return ranges
}

function blockStart(doc: PMNode, index: number): number {
  let pos = 0
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize
  return pos
}

/** 文档位置 → 原文偏移(进入源码模式时放光标)。 */
export function docPosToSource(doc: PMNode, pos: number, text: string, meta: DocMeta, options: SerializeOptions): number {
  if (doc.childCount === 0) return 0
  const ranges = blockRanges(doc, meta, options)
  const clamped = Math.max(0, Math.min(pos, doc.content.size))
  const index = Math.min(doc.resolve(clamped).index(0), doc.childCount - 1)
  const start = blockStart(doc, index)
  const end = start + doc.child(index).nodeSize
  const limit = Math.min(ranges[index].to, text.length)
  const at = Math.max(start, Math.min(clamped, end))
  let cur = Math.min(ranges[index].from, text.length)
  for (const ch of doc.textBetween(start, at, '', '')) {
    const i = text.indexOf(ch, cur)
    if (i < 0 || i >= limit) continue
    cur = i + ch.length
  }
  // 光标后的字前面紧挨着标记符(如 `# 标题`、`**粗体` 的开头)时,光标放到标记符之后
  const next = doc.textBetween(at, end, '', '')[0]
  if (next) {
    const i = text.indexOf(next, cur)
    if (i >= 0 && i < limit && i - cur <= 6 && !text.slice(cur, i).includes('\n')) cur = i
  }
  return cur
}

/** 原文偏移 → 文档位置(退出源码模式时放光标)。doc 须是由 text 刚解析出来的文档。 */
export function sourceToDocPos(doc: PMNode, offset: number, text: string, meta: DocMeta, options: SerializeOptions): number {
  if (doc.childCount === 0) return 0
  const ranges = blockRanges(doc, meta, options)
  let index = ranges.findIndex((r) => offset <= r.to)
  if (index < 0) index = ranges.length - 1
  const start = blockStart(doc, index)
  const block = doc.child(index)
  const limit = Math.min(ranges[index].to, text.length)
  let cur = ranges[index].from
  let result = -1
  let done = false
  block.descendants((node, rel) => {
    if (done) return false
    if (!node.isText) return true
    const base = start + 1 + rel
    const s = node.text ?? ''
    for (let k = 0; k < s.length; k++) {
      const i = text.indexOf(s[k], cur)
      if (i < 0 || i >= limit) continue
      if (i >= offset) {
        // 偏移正好在上一个字之后(如列表项末尾):留在上一个字后面;夹在标记符中间:放到下一个字前面
        if (result < 0 || cur < offset) result = base + k
        done = true
        return false
      }
      cur = i + 1
      result = base + k + 1
    }
    return false
  })
  if (result >= 0) return result
  // 块里没有文字(分割线、单独的图片等):放到块内第一个文本块开头,没有文本块就放在块前
  let first = -1
  block.descendants((node, rel) => {
    if (first < 0 && node.isTextblock) first = start + 1 + rel + 1
    return first < 0
  })
  return first >= 0 ? first : start
}
