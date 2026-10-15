import { EditorState, NodeSelection, TextSelection, type Transaction } from 'prosemirror-state'
import { CellSelection } from 'prosemirror-tables'
import type { EditorView } from 'prosemirror-view'
import { describe, expect, it } from 'vitest'
import { selectBlocks, selectedBlocks } from '../../src/core/block-selection'
import {
  blocksToMarkdown,
  fillCells,
  indent,
  inlineSourceText,
  isColorableBlock,
  isConvertibleBlock,
  outdent,
  setBlocksColor,
  setCodeIndentWidth,
  turnInto,
  turnSelectedInto,
} from '../../src/core/commands'
import { parseMarkdown } from '../../src/core/markdown/parse'
import { serializeMarkdown } from '../../src/core/markdown/serialize'
import { colorItems } from '../../src/plugins/items'

const META = { lineEnding: '\n' as const, bom: false, leading: '', trailing: '\n', bullet: '-' as const }

/** 只有 state / dispatch 的最小视图:块命令只用到这两样。 */
function fakeView(markdown: string, place?: (doc: EditorState['doc']) => number): EditorView {
  let state = EditorState.create({ doc: parseMarkdown(markdown, { inlineMath: true }).doc })
  if (place) state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, place(state.doc))))
  const view = {
    get state() {
      return state
    },
    dispatch(tr: Transaction) {
      state = state.apply(tr)
    },
  }
  return view as unknown as EditorView
}

function md(view: EditorView): string {
  return serializeMarkdown(view.state.doc, META, { inlineMath: true, ensureTrailingNewline: false }).trim()
}

/** 文字所在的文档位置(第一次出现处之后 offset 个字符)。 */
function at(text: string, offset = 0) {
  return (doc: EditorState['doc']) => {
    let found = -1
    doc.descendants((node, pos) => {
      if (found < 0 && node.isText && node.text?.includes(text)) found = pos + node.text.indexOf(text) + offset
    })
    if (found < 0) throw new Error(`文档里没有「${text}」`)
    return found
  }
}

describe('转换为(notion-input.md 7.3)', () => {
  it('段落转折叠标题 2,再转折叠标题 1 只改级别', () => {
    const view = fakeView('文字\n', at('文字'))
    expect(turnInto(view, 'toggleh2')).toBe(true)
    expect(md(view)).toBe('<details>\n<summary><h2>文字</h2></summary>\n\n</details>')
    turnInto(view, 'toggleh1')
    expect(md(view)).toContain('<summary><h1>文字</h1></summary>')
  })

  it('转代码块时行内样式变 Markdown 源码', () => {
    const view = fakeView('有 **粗体** 和 `代码`\n', at('有'))
    turnInto(view, 'code')
    expect(md(view)).toBe('```\n有 **粗体** 和 `代码`\n```')
  })

  it('纯文字转代码块不转义原文;列表项先移出列表', () => {
    const plain = fakeView('\\# 不是标题\n', at('不是'))
    turnInto(plain, 'code')
    expect(md(plain)).toBe('```\n# 不是标题\n```')
    const item = fakeView('1. 列表项\n', at('列表项'))
    turnInto(item, 'code')
    expect(md(item)).toBe('```\n列表项\n```')
  })

  it('代码块转正文:多行合为一个段落,行间为段内换行', () => {
    const view = fakeView('```\n第一行\n第二行\n```\n', at('第一行'))
    turnInto(view, 'paragraph')
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph')
    expect(view.state.doc.firstChild?.childCount).toBe(3)
    expect(view.state.doc.firstChild?.child(1).type.name).toBe('hard_break')
  })

  it('标注块默认提醒类;已在标注块里时指定别的类型就切换类型', () => {
    const view = fakeView('文字\n', at('文字'))
    turnInto(view, 'callout')
    expect(md(view)).toBe('> [!NOTE]\n> 文字')
    turnInto(view, 'callout', { kind: 'warning' })
    expect(md(view)).toBe('> [!WARNING]\n> 文字')
  })

  it('块选中态多块逐块转换', () => {
    const view = fakeView('一\n\n二\n\n三\n')
    const doc = view.state.doc
    const p1 = doc.child(0).nodeSize
    const p2 = p1 + doc.child(1).nodeSize
    view.dispatch(view.state.tr.setSelection(selectBlocks(doc, [p1, p2], p1, p2)))
    expect(turnSelectedInto(view, 'h2')).toBe(true)
    expect(md(view)).toBe('一\n\n## 二\n\n## 三')
  })

  it('单块选中态(Esc 之后)也能转换', () => {
    const view = fakeView('一\n')
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)))
    turnSelectedInto(view, 'quote')
    expect(md(view)).toBe('> 一')
  })

  it('可转换与可设色的块', () => {
    const { doc } = parseMarkdown('段落\n\n![图](a.png)\n\n| a |\n| - |\n| 1 |\n\n```js\nx\n```\n\n- 项\n', { inlineMath: true })
    const kinds = [] as [string, boolean, boolean][]
    doc.forEach((n) => kinds.push([n.type.name, isConvertibleBlock(n), isColorableBlock(n)]))
    expect(kinds).toEqual([
      ['paragraph', true, true],
      ['paragraph', false, false],
      ['table', false, false],
      ['code_block', true, false],
      ['bullet_list', false, true],
    ])
  })
})

describe('块操作', () => {
  it('行内源码:段内换行变换行符', () => {
    const { doc } = parseMarkdown('甲 *乙*\\\n丙\n', { inlineMath: true })
    expect(inlineSourceText(doc.firstChild!.content)).toBe('甲 *乙*\n丙')
  })

  it('复制为 Markdown:同一列表里连续的项合成一个列表', () => {
    const state = EditorState.create({ doc: parseMarkdown('1. 甲\n2. 乙\n3. 丙\n', { inlineMath: true }).doc })
    const list = state.doc.firstChild!
    const first = 1
    const second = first + list.child(0).nodeSize
    const sel = state.apply(state.tr.setSelection(selectBlocks(state.doc, [first, second], first, second)))
    expect(blocksToMarkdown(sel.doc, selectedBlocks(sel), true)).toBe('1. 甲\n2. 乙')
  })

  it('颜色菜单:不在清单里的色值显示「自定义」并打勾(notion-input.md 第八节)', () => {
    const custom = colorItems(fakeView('<span style="color: #123456">文字</span>\n', at('文字')), true).filter((it) => it.label === '自定义')
    expect(custom).toHaveLength(1)
    expect(custom[0].active).toBe(true)
    expect(colorItems(fakeView('文字\n', at('文字')), true).some((it) => it.label === '自定义')).toBe(false)
  })

  it('整块设色包住块内全部文字', () => {
    const view = fakeView('文字\n', at('文字'))
    setBlocksColor(selectedBlocks(view.state), '#D44C47', null)(view.state, view.dispatch)
    expect(md(view)).toBe('<span style="color: #D44C47">文字</span>')
  })
})

describe('代码缩进宽度(对照表 PM-18)', () => {
  it('Tab 按偏好的空格数缩进,⇧Tab 按同样宽度反缩进', () => {
    setCodeIndentWidth(4)
    try {
      const view = fakeView('$$\nx\n$$\n', at('x'))
      expect(indent(view.state, view.dispatch)).toBe(true)
      expect(view.state.doc.firstChild?.textContent).toBe('    x')
      expect(outdent(view.state, view.dispatch)).toBe(true)
      expect(view.state.doc.firstChild?.textContent).toBe('x')
    } finally {
      setCodeIndentWidth(2)
    }
  })
})

describe('表格(PRD 3.6)', () => {
  const table = '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n'

  function cellPos(view: EditorView, text: string): number {
    return at(text)(view.state.doc) - 1
  }

  it('多选单元格 ⌘D 向下填充、⌘R 向右填充', () => {
    const view = fakeView(table)
    const down = CellSelection.create(view.state.doc, cellPos(view, '1'), cellPos(view, '3'))
    view.dispatch(view.state.tr.setSelection(down))
    expect(fillCells('down')(view.state, view.dispatch)).toBe(true)
    expect(md(view)).toContain('| 1 | 2 |\n| 1 | 4 |')
  })

  it('向右填充每行用最左边一格', () => {
    const view = fakeView(table)
    const sel = CellSelection.create(view.state.doc, cellPos(view, '3'), cellPos(view, '4'))
    view.dispatch(view.state.tr.setSelection(sel))
    fillCells('right')(view.state, view.dispatch)
    expect(md(view)).toContain('| 3 | 3 |')
  })

  it('不是单元格多选时不处理(⌘D 回到复制块)', () => {
    const view = fakeView(table, at('1'))
    expect(fillCells('down')(view.state, view.dispatch)).toBe(false)
  })

  it('末格 Tab 新增一行,光标进新行第一格', () => {
    const view = fakeView(table, at('4', 1))
    expect(indent(view.state, view.dispatch)).toBe(true)
    let rows = 0
    view.state.doc.descendants((n) => {
      if (n.type.name === 'table_row') rows++
    })
    expect(rows).toBe(4)
    const $cursor = view.state.selection.$from
    expect($cursor.parent.type.name).toBe('table_cell')
    expect($cursor.node($cursor.depth - 1)).toBe(view.state.doc.firstChild!.lastChild)
  })
})
