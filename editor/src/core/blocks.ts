// Notion 的「块」在 Markdown 文档模型里的对应:
// - 列表项里的内容 → 块是整个列表项(移动、复制、删除都以列表项为单位);
// - 折叠块标题 → 块是整个折叠块;
// - 其余文本块(段落、标题、代码块……)→ 块就是它本身。
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model'
import { type EditorState, NodeSelection, type Selection } from 'prosemirror-state'
import { schema } from './schema'

export interface BlockInfo {
  node: PMNode
  /** 块起始位置(块节点之前) */
  pos: number
  /** 块所在容器的深度($pos.node(depth) 是容器) */
  depth: number
}

/** 光标所在的块。 */
export function blockAt($pos: ResolvedPos): BlockInfo | null {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d)
    const parent = $pos.node(d - 1)
    if (node.type === schema.nodes.list_item) return { node, pos: $pos.before(d), depth: d - 1 }
    if (node.type === schema.nodes.toggle_summary) {
      return { node: parent, pos: $pos.before(d - 1), depth: d - 2 }
    }
    if (node.type === schema.nodes.table_cell || node.type === schema.nodes.table_header || node.type === schema.nodes.table_row) {
      continue
    }
    if (node.isBlock && (parent.type === schema.nodes.doc || isContainer(parent))) {
      return { node, pos: $pos.before(d), depth: d - 1 }
    }
  }
  return null
}

/** 能包含若干块的容器。 */
export function isContainer(node: PMNode): boolean {
  const n = schema.nodes
  return [n.doc, n.blockquote, n.callout, n.toggle, n.list_item, n.footnote_def].includes(node.type)
}

/** 当前选区对应的块:节点选区直接取被选节点,否则取光标所在块。 */
export function selectedBlock(selection: Selection): BlockInfo | null {
  if (selection instanceof NodeSelection && selection.node.isBlock) {
    return { node: selection.node, pos: selection.from, depth: selection.$from.depth }
  }
  return blockAt(selection.$from)
}

/** 选区覆盖的同级块范围(用于多块操作)。 */
export function selectedBlockRange(state: EditorState): { from: number; to: number; depth: number } | null {
  const sel = state.selection
  const a = selectedBlock(sel)
  if (!a) return null
  if (sel.empty || sel instanceof NodeSelection) return { from: a.pos, to: a.pos + a.node.nodeSize, depth: a.depth }
  const b = blockAt(sel.$to)
  if (!b || b.depth !== a.depth) return { from: a.pos, to: a.pos + a.node.nodeSize, depth: a.depth }
  const $a = state.doc.resolve(a.pos)
  const $b = state.doc.resolve(b.pos)
  if ($a.node(a.depth) !== $b.node(b.depth)) return { from: a.pos, to: a.pos + a.node.nodeSize, depth: a.depth }
  return { from: Math.min(a.pos, b.pos), to: Math.max(a.pos + a.node.nodeSize, b.pos + b.node.nodeSize), depth: a.depth }
}

/** 文档的标题大纲(用于大纲面板、目录块、跳转)。 */
export interface HeadingItem {
  level: number
  text: string
  pos: number
  /** 锚点 id(与导出 HTML 一致的 slug) */
  id: string
}

export function collectHeadings(doc: PMNode): HeadingItem[] {
  const out: HeadingItem[] = []
  const used = new Map<string, number>()
  doc.descendants((node, pos) => {
    if (node.type === schema.nodes.heading) {
      const text = node.textContent
      let id = slugify(text)
      const n = used.get(id) ?? 0
      used.set(id, n + 1)
      if (n > 0) id = `${id}-${n}`
      out.push({ level: node.attrs.level, text, pos, id })
      return false
    }
    return node.type !== schema.nodes.code_block && node.type !== schema.nodes.table
  })
  return out
}

/** 与 GitHub / Typora 一致的标题锚点:小写、去标点、空白变连字符,保留中文。 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
}
