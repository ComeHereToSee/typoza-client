import { type Command, EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { BlockSelection } from '../../src/core/block-selection'
import { parseMarkdown } from '../../src/core/markdown/parse'
import {
  deleteFormatted,
  deleteSentence,
  deleteWord,
  editSelectedBlock,
  escapeSelect,
  extendBlock,
  selectFormatted,
  selectSentence,
  selectSiblingBlock,
  selectWord,
} from '../../src/core/selection-commands'

/** 文档 + 光标:光标放在第一次出现的 marker 之后 offset 个字符处。 */
function stateAt(markdown: string, marker: string, offset = 0): EditorState {
  const state = EditorState.create({ doc: parseMarkdown(markdown, { inlineMath: true }).doc })
  let pos = -1
  state.doc.descendants((node, p) => {
    if (pos < 0 && node.isText && node.text?.includes(marker)) pos = p + node.text.indexOf(marker) + offset
  })
  if (pos < 0) throw new Error(`没有「${marker}」`)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

function run(state: EditorState, cmd: Command): EditorState {
  let next = state
  expect(cmd(state, (tr) => (next = state.apply(tr)))).toBe(true)
  return next
}

const selected = (s: EditorState) => s.doc.textBetween(s.selection.from, s.selection.to)

describe('选择类命令(Typora「选择」菜单)', () => {
  it('选中当前词(英文按单词)', () => {
    expect(selected(run(stateAt('hello world again\n', 'world', 2), selectWord))).toBe('world')
  })

  it('选中当前行或句', () => {
    const s = run(stateAt('第一句。第二句话。第三句。\n', '第二', 1), selectSentence)
    expect(selected(s)).toBe('第二句话。')
  })

  it('选中当前格式文本(取最短的那段格式)', () => {
    const s = run(stateAt('普通 **加粗 *斜体* 加粗** 尾\n', '斜体', 1), selectFormatted)
    expect(selected(s)).toBe('斜体')
  })

  it('没有格式时选中格式文本不处理', () => {
    expect(selectFormatted(stateAt('纯文字\n', '文'))).toBe(false)
  })
})

describe('删除类命令', () => {
  it('删除当前词', () => {
    const s = run(stateAt('hello world again\n', 'world', 1), deleteWord)
    expect(s.doc.textContent).toBe('hello  again')
  })

  it('删除当前行或句', () => {
    const s = run(stateAt('第一句。第二句。\n', '第二', 1), deleteSentence)
    expect(s.doc.textContent).toBe('第一句。')
  })

  it('删除当前格式文本', () => {
    const s = run(stateAt('前 `代码` 后\n', '代码', 1), deleteFormatted)
    expect(s.doc.textContent).toBe('前  后')
  })
})

describe('块选中态', () => {
  it('Esc 选中当前块,再按 Esc 回到块末尾编辑', () => {
    const s1 = run(stateAt('一段\n\n二段\n', '一', 0), escapeSelect)
    expect(s1.selection).toBeInstanceOf(NodeSelection)
    expect((s1.selection as NodeSelection).node.textContent).toBe('一段')
    const s2 = run(s1, escapeSelect)
    expect(s2.selection).toBeInstanceOf(TextSelection)
    expect(s2.selection.$from.parentOffset).toBe(2)
  })

  it('↑ ↓ 换选相邻块;到顶不动', () => {
    const s1 = run(stateAt('一\n\n二\n', '二', 0), escapeSelect)
    const s2 = run(s1, selectSiblingBlock(-1))
    expect((s2.selection as NodeSelection).node.textContent).toBe('一')
    const s3 = run(s2, selectSiblingBlock(-1))
    expect((s3.selection as NodeSelection).node.textContent).toBe('一')
  })

  it('⇧↓ 扩选后 ↩ 进入移动端那一块,Esc 清除多块选择', () => {
    const s1 = run(stateAt('一\n\n二\n\n三\n', '一', 0), escapeSelect)
    const s2 = run(s1, extendBlock(1))
    expect(s2.selection).toBeInstanceOf(BlockSelection)
    const s3 = run(s2, editSelectedBlock)
    expect(s3.selection.$from.parent.textContent).toBe('二')
    const s4 = run(s2, escapeSelect)
    expect(s4.selection).toBeInstanceOf(TextSelection)
  })

  it('文字编辑态 ⇧↓ 不处理(交给系统扩选文字)', () => {
    expect(extendBlock(1)(stateAt('一\n\n二\n', '一'))).toBe(false)
  })
})
