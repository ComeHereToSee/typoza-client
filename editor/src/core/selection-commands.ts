// 选择与删除类命令(Typora「选择」菜单)、块选中态的方向键(Notion)、最近颜色、⌘↩「修改当前块」。
import type { MarkType } from 'prosemirror-model'
import { type Command, NodeSelection, Selection, TextSelection } from 'prosemirror-state'
import { addRowAfter, isInTable } from 'prosemirror-tables'
import { selectedBlock } from './blocks'
import { markRange, setColor, toggleCheckOrFold } from './commands'
import { schema } from './schema'

// ---------- 最近使用的颜色(Notion ⇧⌘H) ----------

let lastColor: { color: string | null; background: string | null } = { color: null, background: '#FBF3DB' }

export function rememberColor(color: string | null, background: string | null): void {
  if (color || background) lastColor = { color, background }
}

export const applyLastColor: Command = (state, dispatch) => setColor(lastColor.color, lastColor.background)(state, dispatch)

// ---------- 选择 ----------

function segmentRange(text: string, offset: number, granularity: 'word' | 'sentence'): [number, number] | null {
  const segmenter = new Intl.Segmenter('zh', { granularity })
  for (const seg of segmenter.segment(text)) {
    const end = seg.index + seg.segment.length
    if (offset >= seg.index && offset <= end && (granularity !== 'word' || (seg as Intl.SegmentData & { isWordLike?: boolean }).isWordLike)) {
      return [seg.index, end]
    }
  }
  return null
}

function selectSegment(granularity: 'word' | 'sentence'): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    if (!$from.parent.isTextblock) return false
    const text = $from.parent.textBetween(0, $from.parent.content.size, undefined, '\ufffc')
    const range = segmentRange(text, $from.parentOffset, granularity)
    if (!range) return false
    if (dispatch) {
      const start = $from.start()
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, start + range[0], start + range[1])))
    }
    return true
  }
}

export const selectWord = selectSegment('word')
export const selectSentence = selectSegment('sentence')

/** 选中光标处同一格式(加粗、链接……)的连续文字;多种格式取最短的那段。 */
export const selectFormatted: Command = (state, dispatch) => {
  const { $from } = state.selection
  let best: { from: number; to: number } | null = null
  for (const type of Object.values(schema.marks) as MarkType[]) {
    const r = markRange($from, type)
    if (r && (!best || r.to - r.from < best.to - best.from)) best = r
  }
  if (!best) return false
  if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, best.from, best.to)))
  return true
}

function deleteAfter(select: Command): Command {
  return (state, dispatch) => {
    let next = state
    const ok = select(state, (tr) => {
      next = state.apply(tr)
    })
    if (!ok) return false
    if (dispatch) dispatch(next.tr.deleteSelection().scrollIntoView())
    return true
  }
}

export const deleteWord = deleteAfter(selectWord)
export const deleteSentence = deleteAfter(selectSentence)
export const deleteFormatted = deleteAfter(selectFormatted)

export const jumpToSelection: Command = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.scrollIntoView())
  return true
}

// ---------- 块选中态(Esc 之后) ----------

/** 块选中时 ↑/↓ 选中相邻块。 */
export function selectSiblingBlock(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const sel = state.selection
    if (!(sel instanceof NodeSelection) || !sel.node.isBlock) return false
    const $pos = sel.$from
    const container = $pos.parent
    const index = $pos.index()
    const target = index + dir
    if (target < 0 || target >= container.childCount) return true
    let pos = $pos.start()
    for (let i = 0; i < target; i++) pos += container.child(i).nodeSize
    if (container.child(target).type === schema.nodes.frontmatter || container.child(target).type === schema.nodes.toggle_summary) return true
    if (dispatch) dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)).scrollIntoView())
    return true
  }
}

/** 块选中时 ↩:光标进入该块末尾编辑。 */
export const editSelectedBlock: Command = (state, dispatch) => {
  const sel = state.selection
  if (!(sel instanceof NodeSelection) || !sel.node.isBlock || sel.node.isAtom) return false
  if (dispatch) dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(sel.to - 1), -1)))
  return true
}

/** 块选中且是图片 / 媒体时按空格:交给应用打开灯箱(由 isImageSelected 判断)。 */
export function isImageSelected(sel: Selection): boolean {
  return sel instanceof NodeSelection && sel.node.type === schema.nodes.image
}

/** ⌘↩ 修改当前块:表格里在下方插入行;待办勾选;折叠块开合。图片、文档链接由应用层先处理。 */
export const modifyCurrentBlock: Command = (state, dispatch) => {
  if (isInTable(state)) return addRowAfter(state, dispatch)
  return toggleCheckOrFold(state, dispatch)
}

/** 选中当前块(Esc)。已是块选中态时取消选择,把光标放回块末尾。 */
export const escapeSelect: Command = (state, dispatch) => {
  const sel = state.selection
  if (sel instanceof NodeSelection && sel.node.isBlock) return editSelectedBlock(state, dispatch)
  const block = selectedBlock(sel)
  if (!block) return false
  if (dispatch) dispatch(state.tr.setSelection(NodeSelection.create(state.doc, block.pos)))
  return true
}
