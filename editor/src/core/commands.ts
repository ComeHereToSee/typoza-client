// 编辑命令。快捷键、斜杠菜单、块菜单、原生菜单栏都调用这里,保证同一个功能只有一份实现。
import { lift, selectAll, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands'
import { redo, undo } from 'prosemirror-history'
import { Fragment, type Mark, type MarkType, type Node as PMNode, type NodeType, type ResolvedPos } from 'prosemirror-model'
import { liftListItem, sinkListItem, wrapInList } from 'prosemirror-schema-list'
import { type Command, type EditorState, NodeSelection, Selection, TextSelection, type Transaction } from 'prosemirror-state'
import { goToNextCell, isInTable } from 'prosemirror-tables'
import type { EditorView } from 'prosemirror-view'
import { blockAt, selectedBlock, selectedBlockRange } from './blocks'
import { type MediaKind, schema } from './schema'

const n = schema.nodes
const m = schema.marks

/** 只改界面状态(如折叠块展开)的事务带这个标记:不进撤销历史、不算文档修改。 */
export const UI_ONLY = 'tz-ui-only'

export function isUiOnly(tr: Transaction): boolean {
  return tr.getMeta(UI_ONLY) === true
}

// ---------- 通用工具 ----------

export function findAncestor($pos: ResolvedPos, type: NodeType): { node: PMNode; pos: number; depth: number } | null {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d)
    if (node.type === type) return { node, pos: $pos.before(d), depth: d }
  }
  return null
}

/** 光标处某个标记的连续范围(用于编辑链接、颜色)。光标在标记末尾时也算。 */
export function markRange($pos: ResolvedPos, type: MarkType): { from: number; to: number; mark: Mark } | null {
  const parent = $pos.parent
  const offset = $pos.parentOffset
  const after = parent.childAfter(offset)
  const before = offset > 0 ? parent.childBefore(offset) : null
  let found: Mark | undefined
  let index: number
  if (after.node && (found = type.isInSet(after.node.marks))) index = after.index
  else if (before?.node && (found = type.isInSet(before.node.marks))) index = before.index
  else return null
  const mark = found
  let first = index
  let last = index + 1
  while (first > 0 && mark.isInSet(parent.child(first - 1).marks)) first--
  while (last < parent.childCount && mark.isInSet(parent.child(last).marks)) last++
  let from = $pos.start()
  for (let i = 0; i < first; i++) from += parent.child(i).nodeSize
  let to = from
  for (let i = first; i < last; i++) to += parent.child(i).nodeSize
  return { from, to, mark }
}

function liftAllLists(view: EditorView): void {
  let guard = 0
  while (findAncestor(view.state.selection.$from, n.list_item) && guard++ < 20) {
    if (!liftListItem(n.list_item)(view.state, view.dispatch)) break
  }
}

// ---------- 块类型(Notion「转换为」) ----------

export type BlockKind =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'bullet'
  | 'numbered'
  | 'todo'
  | 'toggle'
  | 'quote'
  | 'callout'
  | 'code'
  | 'math'

/** 当前块的类型,用于菜单打勾。 */
export function currentBlockKind(state: EditorState): BlockKind | null {
  const $from = state.selection.$from
  const tb = $from.parent
  const item = findAncestor($from, n.list_item)
  if (item) {
    if (item.node.attrs.checked !== null) return 'todo'
    const list = $from.node(item.depth - 1)
    return list.type === n.ordered_list ? 'numbered' : 'bullet'
  }
  if (tb.type === n.toggle_summary) return 'toggle'
  if (tb.type === n.heading) return `h${tb.attrs.level}` as BlockKind
  if (tb.type === n.code_block) return 'code'
  if (tb.type === n.math_block) return 'math'
  if (findAncestor($from, n.callout)) return 'callout'
  if (findAncestor($from, n.blockquote)) return 'quote'
  if (tb.type === n.paragraph) return 'paragraph'
  return null
}

function unwrapToggle(view: EditorView): boolean {
  const { state } = view
  const $from = state.selection.$from
  const toggle = findAncestor($from, n.toggle)
  if (!toggle || $from.parent.type !== n.toggle_summary) return false
  const summary = toggle.node.firstChild!
  const blocks: PMNode[] = [n.paragraph.create(null, summary.content)]
  toggle.node.forEach((child, _o, i) => {
    if (i > 0) blocks.push(child)
  })
  const offset = $from.parentOffset
  const tr = state.tr.replaceWith(toggle.pos, toggle.pos + toggle.node.nodeSize, blocks)
  tr.setSelection(TextSelection.create(tr.doc, toggle.pos + 1 + offset))
  view.dispatch(tr)
  return true
}

export function turnInto(view: EditorView, kind: BlockKind, attrs: Record<string, unknown> = {}): boolean {
  const $from = view.state.selection.$from
  if (!$from.parent.isTextblock) return false
  if ($from.parent.type === n.toggle_summary && kind !== 'toggle') unwrapToggle(view)

  switch (kind) {
    case 'paragraph':
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
    case 'code':
    case 'math': {
      liftAllLists(view)
      if (kind === 'paragraph') {
        // 引用 / 提示框里的段落再「转为文本」时,先移出容器(Notion:引用转文本就是普通文本)
        const s = view.state
        if (s.selection.$from.parent.type === n.paragraph && (findAncestor(s.selection.$from, n.blockquote) || findAncestor(s.selection.$from, n.callout))) {
          return lift(s, view.dispatch)
        }
      }
      const type = kind === 'paragraph' ? n.paragraph : kind === 'code' ? n.code_block : kind === 'math' ? n.math_block : n.heading
      const a = kind.startsWith('h') ? { level: Number(kind.slice(1)) } : kind === 'code' ? { language: attrs.language ?? '' } : null
      return setBlockType(type, a)(view.state, view.dispatch)
    }
    case 'bullet':
    case 'numbered':
    case 'todo':
      return toList(view, kind)
    case 'toggle': {
      liftAllLists(view)
      const s = view.state
      const $f = s.selection.$from
      const tb = $f.parent
      if (tb.type === n.toggle_summary) return true
      if (!(tb.type === n.paragraph || tb.type === n.heading)) return false
      const start = $f.before()
      const toggle = n.toggle.create(null, [n.toggle_summary.create(null, tb.content)])
      const tr = s.tr.replaceWith(start, start + tb.nodeSize, toggle)
      tr.setSelection(TextSelection.create(tr.doc, start + 2 + $f.parentOffset))
      view.dispatch(tr)
      return true
    }
    case 'quote':
      if (findAncestor($from, n.blockquote)) return lift(view.state, view.dispatch)
      liftAllLists(view)
      return wrapIn(n.blockquote)(view.state, view.dispatch)
    case 'callout':
      if (findAncestor($from, n.callout)) return lift(view.state, view.dispatch)
      liftAllLists(view)
      return wrapIn(n.callout, { kind: attrs.kind ?? 'tip', title: '' })(view.state, view.dispatch)
  }
}

function toList(view: EditorView, kind: 'bullet' | 'numbered' | 'todo'): boolean {
  const state = view.state
  const $from = state.selection.$from
  const listType = kind === 'numbered' ? n.ordered_list : n.bullet_list
  const checked = kind === 'todo' ? false : null
  const item = findAncestor($from, n.list_item)
  if (item) {
    const listDepth = item.depth - 1
    const list = $from.node(listDepth)
    const listPos = $from.before(listDepth)
    const tr = state.tr
    if (list.type !== listType) tr.setNodeMarkup(listPos, listType, listType === n.ordered_list ? { start: 1, tight: list.attrs.tight } : { tight: list.attrs.tight })
    const current = item.node.attrs.checked
    if ((checked === null) !== (current === null)) tr.setNodeMarkup(item.pos, null, { checked })
    view.dispatch(tr)
    return true
  }
  if (!wrapInList(listType)(state, view.dispatch)) return false
  if (checked !== null) {
    const it = findAncestor(view.state.selection.$from, n.list_item)
    if (it) view.dispatch(view.state.tr.setNodeMarkup(it.pos, null, { checked }))
  }
  return true
}

// ---------- 块操作 ----------

export const selectCurrentBlock: Command = (state, dispatch) => {
  const block = selectedBlock(state.selection)
  if (!block) return false
  if (dispatch) dispatch(state.tr.setSelection(NodeSelection.create(state.doc, block.pos)))
  return true
}

export const duplicateBlock: Command = (state, dispatch) => {
  const range = selectedBlockRange(state)
  if (!range) return false
  const content = state.doc.slice(range.from, range.to).content
  if (dispatch) {
    const size = range.to - range.from
    const tr = state.tr.insert(range.to, content)
    const sel = state.selection
    if (sel instanceof NodeSelection) tr.setSelection(NodeSelection.create(tr.doc, sel.from + size))
    else tr.setSelection(TextSelection.create(tr.doc, sel.anchor + size, sel.head + size))
    dispatch(tr.scrollIntoView())
  }
  return true
}

export function moveBlock(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const range = selectedBlockRange(state)
    if (!range) return false
    const $start = state.doc.resolve(range.from)
    const container = $start.node(range.depth)
    const first = $start.index(range.depth)
    const after = state.doc.resolve(range.to).index(range.depth)
    const sel = state.selection
    const tr = state.tr
    let delta: number
    if (dir < 0) {
      if (first === 0) return false
      const prev = container.child(first - 1)
      if (prev.type === n.frontmatter || prev.type === n.toggle_summary) return false
      tr.delete(range.from - prev.nodeSize, range.from)
      tr.insert(range.to - prev.nodeSize, prev)
      delta = -prev.nodeSize
    } else {
      if (after >= container.childCount) return false
      const next = container.child(after)
      tr.delete(range.to, range.to + next.nodeSize)
      tr.insert(range.from, next)
      delta = next.nodeSize
    }
    if (dispatch) {
      if (sel instanceof NodeSelection) tr.setSelection(NodeSelection.create(tr.doc, sel.from + delta))
      else tr.setSelection(TextSelection.create(tr.doc, sel.anchor + delta, sel.head + delta))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

export const deleteBlock: Command = (state, dispatch) => {
  const range = selectedBlockRange(state)
  if (!range) return false
  if (dispatch) {
    const container = state.doc.resolve(range.from).node(range.depth)
    const removesAll = range.to - range.from >= container.content.size
    const tr = removesAll
      ? state.tr.replaceWith(range.from, range.to, n.paragraph.create())
      : state.tr.delete(range.from, range.to)
    const pos = Math.min(range.from, tr.doc.content.size)
    tr.setSelection(Selection.near(tr.doc.resolve(pos)))
    dispatch(tr.scrollIntoView())
  }
  return true
}

/** Cmd+A:先选中当前块的文字,再按一次全选(Notion 行为)。 */
export const progressiveSelectAll: Command = (state, dispatch) => {
  const { $from, $to } = state.selection
  if ($from.sameParent($to) && $from.parent.isTextblock) {
    const start = $from.start()
    const end = $from.end()
    if (!(state.selection.from === start && state.selection.to === end) && end > start) {
      if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, start, end)))
      return true
    }
  }
  return selectAll(state, dispatch)
}

// ---------- 缩进 ----------

function indentCode(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, dir: 1 | -1): boolean {
  const { $from, from, to } = state.selection
  if ($from.parent.type !== n.code_block && $from.parent.type !== n.math_block) return false
  if (!dispatch) return true
  const start = $from.start()
  const text = $from.parent.textContent
  const tr = state.tr
  // 逐行处理选区覆盖的行;从后往前改,位置不受前面修改影响
  const lineStarts: number[] = []
  let offset = 0
  for (const line of text.split('\n')) {
    const lineFrom = start + offset
    const lineTo = lineFrom + line.length
    if (lineTo >= from && lineFrom <= to) lineStarts.push(lineFrom)
    offset += line.length + 1
  }
  if (dir > 0 && state.selection.empty) {
    dispatch(tr.insertText('  '))
    return true
  }
  for (const ls of lineStarts.reverse()) {
    if (dir > 0) tr.insertText('  ', ls)
    else {
      const lineText = text.slice(ls - start)
      const spaces = /^( {1,2}|\t)/.exec(lineText)
      if (spaces) tr.delete(ls, ls + spaces[0].length)
    }
  }
  dispatch(tr)
  return true
}

/** Tab:列表项下沉;代码块缩进;表格跳下一格;段落紧跟在列表后时并入上一个列表项(Notion 的「嵌套到上一块」)。 */
export const indent: Command = (state, dispatch) => {
  if (isInTable(state)) return goToNextCell(1)(state, dispatch)
  if (indentCode(state, dispatch, 1)) return true
  if (findAncestor(state.selection.$from, n.list_item)) return sinkListItem(n.list_item)(state, dispatch) || true
  const block = blockAt(state.selection.$from)
  if (!block) return true
  const $b = state.doc.resolve(block.pos)
  const index = $b.index(block.depth)
  if (index === 0) return true
  const prev = $b.node(block.depth).child(index - 1)
  if (prev.type !== n.bullet_list && prev.type !== n.ordered_list) return true
  if (dispatch) {
    // 插入点:上一个列表最后一项的内容末尾(列表项结束标记之前)
    const insertAt = block.pos - 2
    const offset = state.selection.from - block.pos
    const tr = state.tr.delete(block.pos, block.pos + block.node.nodeSize).insert(insertAt, block.node)
    tr.setSelection(TextSelection.create(tr.doc, insertAt + offset))
    dispatch(tr)
  }
  return true
}

export const outdent: Command = (state, dispatch) => {
  if (isInTable(state)) return goToNextCell(-1)(state, dispatch)
  if (indentCode(state, dispatch, -1)) return true
  if (findAncestor(state.selection.$from, n.list_item)) return liftListItem(n.list_item)(state, dispatch) || true
  return true
}

// ---------- 待办与折叠 ----------

/** Cmd+Enter:切换待办勾选;在折叠块标题里则展开/收起。 */
export const toggleCheckOrFold: Command = (state, dispatch) => {
  const $from = state.selection.$from
  const item = findAncestor($from, n.list_item)
  if (item && item.node.attrs.checked !== null) {
    if (dispatch) dispatch(state.tr.setNodeMarkup(item.pos, null, { checked: !item.node.attrs.checked }))
    return true
  }
  const toggle = findAncestor($from, n.toggle)
  if (toggle && $from.parent.type === n.toggle_summary) {
    if (dispatch) dispatch(setToggleOpen(state.tr, toggle.pos, !toggle.node.attrs.open))
    return true
  }
  return false
}

export function setToggleOpen(tr: Transaction, pos: number, open: boolean): Transaction {
  const node = tr.doc.nodeAt(pos)
  if (!node || node.type !== n.toggle) return tr
  return tr.setNodeMarkup(pos, null, { ...node.attrs, open }).setMeta(UI_ONLY, true).setMeta('addToHistory', false)
}

/** Cmd+Option+T:全部展开 / 全部收起(有任何收起的就全部展开)。 */
export const toggleAllFolds: Command = (state, dispatch) => {
  const toggles: { pos: number; open: boolean }[] = []
  state.doc.descendants((node, pos) => {
    if (node.type === n.toggle) toggles.push({ pos, open: node.attrs.open })
  })
  if (toggles.length === 0) return false
  const open = toggles.some((t) => !t.open)
  if (dispatch) {
    let tr = state.tr
    for (const t of toggles) tr = setToggleOpen(tr, t.pos, open)
    dispatch(tr)
  }
  return true
}

// ---------- 标题级别 ----------

export function setHeading(level: number): Command {
  return (state, dispatch) => {
    const tb = state.selection.$from.parent
    if (tb.type === n.heading && tb.attrs.level === level) return setBlockType(n.paragraph)(state, dispatch)
    return setBlockType(n.heading, { level })(state, dispatch)
  }
}

export function shiftHeading(delta: 1 | -1): Command {
  return (state, dispatch) => {
    const tb = state.selection.$from.parent
    if (tb.type === n.paragraph && delta > 0) return setBlockType(n.heading, { level: 6 })(state, dispatch)
    if (tb.type !== n.heading) return false
    const level = tb.attrs.level - delta
    if (level > 6) return setBlockType(n.paragraph)(state, dispatch)
    return setBlockType(n.heading, { level: Math.max(1, level) })(state, dispatch)
  }
}

// ---------- 行内格式 ----------

export function toggleFormat(type: MarkType): Command {
  return toggleMark(type)
}

export function setColor(color: string | null, background: string | null): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection
    const type = m.color
    if (!dispatch) return true
    const tr = state.tr
    if (empty) {
      if (!color && !background) tr.removeStoredMark(type)
      else tr.addStoredMark(type.create({ color, background }))
    } else {
      tr.removeMark(from, to, type)
      if (color || background) tr.addMark(from, to, type.create({ color, background }))
    }
    dispatch(tr)
    return true
  }
}

export function setLink(href: string, title: string | null = null): Command {
  return (state, dispatch) => {
    const { from, to, empty, $from } = state.selection
    if (!dispatch) return true
    const tr = state.tr
    if (empty) {
      const existing = markRange($from, m.link)
      if (existing) {
        tr.removeMark(existing.from, existing.to, m.link).addMark(existing.from, existing.to, m.link.create({ href, title }))
      } else {
        const text = href
        tr.insertText(text, from).addMark(from, from + text.length, m.link.create({ href, title }))
      }
    } else {
      tr.removeMark(from, to, m.link).addMark(from, to, m.link.create({ href, title }))
    }
    dispatch(tr)
    return true
  }
}

export const removeLink: Command = (state, dispatch) => {
  const { from, to, empty, $from } = state.selection
  const range = empty ? markRange($from, m.link) : { from, to }
  if (!range) return false
  if (dispatch) dispatch(state.tr.removeMark(range.from, range.to, m.link))
  return true
}

export const clearFormatting: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection
  if (empty) return false
  if (dispatch) {
    const tr = state.tr
    for (const type of Object.values(schema.marks)) if (type !== m.link) tr.removeMark(from, to, type)
    dispatch(tr)
  }
  return true
}

// ---------- 插入 ----------

/** 插入块:当前是空段落就替换它,否则插在当前块之后。光标放进新块(或其后的段落)。 */
export function insertBlock(node: PMNode, cursorInside = true): Command {
  return (state, dispatch) => {
    const $from = state.selection.$from
    const tb = $from.parent
    if (!dispatch) return true
    const tr = state.tr
    let pos: number
    if (tb.type === n.paragraph && tb.content.size === 0) {
      pos = $from.before()
      tr.replaceWith(pos, pos + tb.nodeSize, node)
    } else {
      const block = blockAt($from)
      pos = block ? block.pos + block.node.nodeSize : $from.after(1)
      tr.insert(pos, node)
    }
    if (cursorInside && (node.isTextblock || node.firstChild?.isTextblock || node.type === n.table)) {
      tr.setSelection(Selection.near(tr.doc.resolve(pos + 1)))
    } else {
      const after = pos + node.nodeSize
      const next = tr.doc.resolve(after).nodeAfter
      if (!next || !next.isTextblock) tr.insert(after, n.paragraph.create())
      tr.setSelection(TextSelection.create(tr.doc, after + 1))
    }
    dispatch(tr.scrollIntoView())
    return true
  }
}

export function createTable(rows: number, cols: number): PMNode {
  const cells = (type: NodeType) => Array.from({ length: cols }, () => type.create())
  const header = n.table_row.create(null, cells(n.table_header))
  const body = Array.from({ length: Math.max(0, rows - 1) }, () => n.table_row.create(null, cells(n.table_cell)))
  return n.table.create(null, [header, ...body])
}

export const insertTable = (rows = 3, cols = 3): Command => insertBlock(createTable(rows, cols))
export const insertDivider: Command = (s, d) => insertBlock(n.horizontal_rule.create(), false)(s, d)
export const insertToc: Command = (s, d) => insertBlock(n.toc.create(), false)(s, d)
export const insertMathBlock: Command = (s, d) => insertBlock(n.math_block.create())(s, d)
export const insertCodeBlock = (language = ''): Command => insertBlock(n.code_block.create({ language }))
export const insertCallout = (kind = 'tip'): Command => insertBlock(n.callout.create({ kind }, n.paragraph.create()))
export const insertToggle: Command = (s, d) => insertBlock(n.toggle.create(null, [n.toggle_summary.create()]))(s, d)

export function insertMedia(kind: MediaKind, src: string, title = ''): Command {
  return insertBlock(n.media.create({ kind, src, title }), false)
}

export function insertImage(src: string, alt = ''): Command {
  return (state, dispatch) => {
    if (dispatch) dispatch(state.tr.replaceSelectionWith(n.image.create({ src, alt })).scrollIntoView())
    return true
  }
}

export const insertInlineMath: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection
  const tex = empty ? '' : state.doc.textBetween(from, to)
  if (dispatch) {
    const tr = state.tr.replaceSelectionWith(n.math_inline.create({ tex }))
    tr.setSelection(NodeSelection.create(tr.doc, from))
    dispatch(tr)
  }
  return true
}

export const insertFootnote: Command = (state, dispatch) => {
  let max = 0
  state.doc.descendants((node) => {
    if (node.type === n.footnote_ref || node.type === n.footnote_def) {
      const v = Number.parseInt(node.attrs.label, 10)
      if (Number.isFinite(v)) max = Math.max(max, v)
    }
  })
  const label = String(max + 1)
  if (dispatch) {
    const tr = state.tr.replaceSelectionWith(n.footnote_ref.create({ label }), false)
    tr.insert(tr.doc.content.size, n.footnote_def.create({ label }, n.paragraph.create()))
    dispatch(tr.scrollIntoView())
  }
  return true
}

export const insertFrontMatter: Command = (state, dispatch) => {
  const first = state.doc.firstChild
  if (dispatch) {
    if (first?.type === n.frontmatter) {
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1 + first.content.size)).scrollIntoView())
    } else {
      const tr = state.tr.insert(0, n.frontmatter.create())
      tr.setSelection(TextSelection.create(tr.doc, 1))
      dispatch(tr.scrollIntoView())
    }
  }
  return true
}

// ---------- 撤销 ----------

export { redo, undo }

/** 把节点列表包成片段,供外部插入。 */
export function fragmentOf(nodes: PMNode[]): Fragment {
  return Fragment.fromArray(nodes)
}
