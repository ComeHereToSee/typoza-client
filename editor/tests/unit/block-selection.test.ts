import { EditorState, NodeSelection, TextSelection, type Transaction } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import { describe, expect, it } from 'vitest'
import {
  BlockSelection,
  extendBlockSelection,
  exitBlockSelection,
  selectBlocks,
  selectedBlocks,
  selectionText,
  shiftClickSelection,
  toggleBlockSelection,
} from '../../src/core/block-selection'
import { deleteBlock, duplicateBlock, moveBlock } from '../../src/core/commands'
import { parseMarkdown } from '../../src/core/markdown/parse'
import { serializeMarkdown } from '../../src/core/markdown/serialize'

function load(md: string): EditorState {
  return EditorState.create({ doc: parseMarkdown(md, { inlineMath: true }).doc })
}

/** 顶层第 i 个块的位置。 */
function topPos(doc: PMNode, index: number): number {
  let pos = 0
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize
  return pos
}

function md(state: EditorState): string {
  return serializeMarkdown(state.doc, { lineEnding: '\n', bom: false, leading: '', trailing: '\n', bullet: '-' }, { inlineMath: true, ensureTrailingNewline: false }).trim()
}

function run(state: EditorState, cmd: (s: EditorState, d?: (tr: Transaction) => void) => boolean): EditorState {
  let next = state
  expect(cmd(state, (tr) => (next = state.apply(tr)))).toBe(true)
  return next
}

function withSelection(state: EditorState, sel: ReturnType<typeof selectBlocks>): EditorState {
  return state.apply(state.tr.setSelection(sel))
}

describe('多块选择(notion-input.md 7.4)', () => {
  it('一块用 NodeSelection,多块用 BlockSelection;内容是所选的兄弟块', () => {
    const s = load('一\n\n二\n\n三\n')
    expect(selectBlocks(s.doc, [topPos(s.doc, 1)], 0, 0)).toBeInstanceOf(NodeSelection)
    const sel = selectBlocks(s.doc, [topPos(s.doc, 0), topPos(s.doc, 2)], topPos(s.doc, 0), topPos(s.doc, 2))
    expect(sel).toBeInstanceOf(BlockSelection)
    const texts: string[] = []
    sel.content().content.forEach((n) => texts.push(n.textContent))
    expect(texts).toEqual(['一', '三'])
  })

  it('⇧↓ 从选中的一块扩到下一块,再按 ⇧↑ 收回', () => {
    let s = load('一\n\n二\n\n三\n')
    s = withSelection(s, NodeSelection.create(s.doc, topPos(s.doc, 0)))
    const down = extendBlockSelection(s, 1)
    expect(down).toBeInstanceOf(BlockSelection)
    s = withSelection(s, down!)
    expect(selectedBlocks(s).map((b) => b.node.textContent)).toEqual(['一', '二'])
    const up = extendBlockSelection(s, -1)
    expect(up).toBeInstanceOf(NodeSelection)
    expect((up as NodeSelection).node.textContent).toBe('一')
  })

  it('文字编辑态不扩选(⇧↑⇧↓ 保留系统行为)', () => {
    const s = load('一\n\n二\n')
    expect(extendBlockSelection(s, 1)).toBeNull()
  })

  it('⇧+点击:跨层级时取共同容器下的块(列表项 → 整个列表)', () => {
    let s = load('段落\n\n- 甲\n- 乙\n\n尾段\n')
    s = withSelection(s, NodeSelection.create(s.doc, topPos(s.doc, 0)))
    const itemPos = topPos(s.doc, 1) + 1 // 列表里第一项
    const sel = shiftClickSelection(s, itemPos)
    expect(sel).toBeInstanceOf(BlockSelection)
    expect(selectedBlocks(withSelection(s, sel!)).map((b) => b.node.type.name)).toEqual(['paragraph', 'bullet_list'])
  })

  it('⇧⌘+点击:增减单块,不必连续;全部移除后光标回到该块', () => {
    let s = load('一\n\n二\n\n三\n')
    s = withSelection(s, NodeSelection.create(s.doc, topPos(s.doc, 0)))
    s = withSelection(s, toggleBlockSelection(s, topPos(s.doc, 2)))
    expect(selectedBlocks(s).map((b) => b.node.textContent)).toEqual(['一', '三'])
    s = withSelection(s, toggleBlockSelection(s, topPos(s.doc, 0)))
    expect(s.selection).toBeInstanceOf(NodeSelection)
    s = withSelection(s, toggleBlockSelection(s, topPos(s.doc, 2)))
    expect(s.selection).toBeInstanceOf(TextSelection)
    expect(s.selection.$from.parent.textContent).toBe('三')
  })

  it('删除、复制、移动多块', () => {
    const base = load('一\n\n二\n\n三\n\n四\n')
    const sel = (s: EditorState) => selectBlocks(s.doc, [topPos(s.doc, 1), topPos(s.doc, 2)], topPos(s.doc, 1), topPos(s.doc, 2))
    expect(md(run(withSelection(base, sel(base)), deleteBlock))).toBe('一\n\n四')
    const dup = run(withSelection(base, sel(base)), duplicateBlock)
    expect(md(dup)).toBe('一\n\n二\n\n三\n\n二\n\n三\n\n四')
    expect(selectedBlocks(dup).map((b) => b.node.textContent)).toEqual(['二', '三'])
    const moved = run(withSelection(base, sel(base)), moveBlock(-1))
    expect(md(moved)).toBe('二\n\n三\n\n一\n\n四')
    expect(selectedBlocks(moved).map((b) => b.node.textContent)).toEqual(['二', '三'])
  })

  it('全部块都删掉时留一个空段落', () => {
    const s = load('一\n\n二\n')
    const all = withSelection(s, selectBlocks(s.doc, [topPos(s.doc, 0), topPos(s.doc, 1)], 0, topPos(s.doc, 1)))
    const after = run(all, deleteBlock)
    expect(after.doc.childCount).toBe(1)
    expect(after.doc.firstChild?.type.name).toBe('paragraph')
  })

  it('文档变化后选择随之映射;被删的块移出选择', () => {
    let s = load('一\n\n二\n\n三\n')
    s = withSelection(s, selectBlocks(s.doc, [topPos(s.doc, 1), topPos(s.doc, 2)], topPos(s.doc, 1), topPos(s.doc, 2)))
    s = s.apply(s.tr.insertText('前', 1))
    expect(selectedBlocks(s).map((b) => b.node.textContent)).toEqual(['二', '三'])
    s = s.apply(s.tr.delete(topPos(s.doc, 1), topPos(s.doc, 2)))
    expect(s.selection).toBeInstanceOf(NodeSelection)
    expect((s.selection as NodeSelection).node.textContent).toBe('三')
  })

  it('退出块选中态时光标在移动端那一块末尾;状态栏字数取全部所选块', () => {
    let s = load('一二\n\n三四五\n')
    s = withSelection(s, selectBlocks(s.doc, [topPos(s.doc, 0), topPos(s.doc, 1)], topPos(s.doc, 0), topPos(s.doc, 1)))
    expect(selectionText(s)).toBe('一二\n\n三四五')
    const exit = exitBlockSelection(s)
    expect(exit).toBeInstanceOf(TextSelection)
    expect(exit!.$from.parent.textContent).toBe('三四五')
    expect(exit!.$from.parentOffset).toBe(3)
  })
})
