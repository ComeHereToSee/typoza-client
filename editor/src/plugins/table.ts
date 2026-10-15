// 表格工具条:光标在表格里时浮在表格上方。增删行列、按列对齐、移动行列、删除表格、复制为 Markdown。
import { Plugin } from 'prosemirror-state'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  findTable,
  isInTable,
  moveTableColumn,
  moveTableRow,
  selectedRect,
} from 'prosemirror-tables'
import type { Command } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { registerCommand, runCommand } from '../core/registry'
import { h } from '../ui/dom'

type Align = 'left' | 'center' | 'right' | null

/** 整列对齐(GFM 的对齐是按列的)。 */
export function alignColumn(align: Align): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false
    const rect = selectedRect(state)
    if (dispatch) {
      const tr = state.tr
      for (let row = 0; row < rect.map.height; row++) {
        for (let col = rect.left; col < rect.right; col++) {
          const pos = rect.tableStart + rect.map.map[row * rect.map.width + col]
          const cell = tr.doc.nodeAt(pos)
          if (cell && cell.attrs.align !== align) tr.setNodeMarkup(pos, null, { ...cell.attrs, align })
        }
      }
      dispatch(tr)
    }
    return true
  }
}

function moveCurrent(kind: 'row' | 'column', dir: -1 | 1): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false
    const rect = selectedRect(state)
    if (kind === 'row') {
      const from = rect.top
      const to = from + dir
      if (to < 1 || to >= rect.map.height || from === 0) return false // 表头行不参与移动
      return moveTableRow({ from, to })(state, dispatch)
    }
    const from = rect.left
    const to = from + dir
    if (to < 0 || to >= rect.map.width) return false
    return moveTableColumn({ from, to })(state, dispatch)
  }
}

const st = (cmd: Command) => (view: EditorView) => cmd(view.state, view.dispatch)

for (const def of [
  { id: 'table.rowAbove', label: '上方插入行', run: st(addRowBefore) },
  { id: 'table.rowBelow', label: '下方插入行', run: st(addRowAfter) },
  { id: 'table.colLeft', label: '左侧插入列', run: st(addColumnBefore) },
  { id: 'table.colRight', label: '右侧插入列', run: st(addColumnAfter) },
  { id: 'table.deleteRow', label: '删除行', run: st(deleteRow) },
  { id: 'table.deleteCol', label: '删除列', run: st(deleteColumn) },
  { id: 'table.delete', label: '删除表格', run: st(deleteTable) },
  { id: 'table.alignLeft', label: '左对齐', run: st(alignColumn('left')) },
  { id: 'table.alignCenter', label: '居中', run: st(alignColumn('center')) },
  { id: 'table.alignRight', label: '右对齐', run: st(alignColumn('right')) },
  { id: 'table.moveRowUp', label: '上移该行', run: st(moveCurrent('row', -1)) },
  { id: 'table.moveRowDown', label: '下移该行', run: st(moveCurrent('row', 1)) },
  { id: 'table.moveColLeft', label: '左移该列', run: st(moveCurrent('column', -1)) },
  { id: 'table.moveColRight', label: '右移该列', run: st(moveCurrent('column', 1)) },
]) {
  registerCommand(def)
}

/** Typora 表格内快捷键:⌃⌘ 方向键移动行列,⇧⌘⌫ 删除行。 */
export const TABLE_KEYS: Record<string, string> = {
  'Ctrl-Mod-ArrowUp': 'table.moveRowUp',
  'Ctrl-Mod-ArrowDown': 'table.moveRowDown',
  'Ctrl-Mod-ArrowLeft': 'table.moveColLeft',
  'Ctrl-Mod-ArrowRight': 'table.moveColRight',
  'Mod-Shift-Backspace': 'table.deleteRow',
}

export function tableToolbarPlugin(): Plugin {
  return new Plugin({ view: (view) => new TableToolbar(view) })
}

class TableToolbar {
  private readonly el: HTMLDivElement

  constructor(private readonly view: EditorView) {
    const btn = (label: string, title: string, id: string) => {
      const b = h('button', { type: 'button', class: 'tz-table-btn', title }, label)
      b.addEventListener('mousedown', (e) => {
        e.preventDefault()
        runCommand(this.view, id)
        this.view.focus()
      })
      return b
    }
    this.el = h(
      'div',
      { class: 'tz-table-toolbar', hidden: true },
      btn('⇤', '左对齐', 'table.alignLeft'),
      btn('⇹', '居中', 'table.alignCenter'),
      btn('⇥', '右对齐', 'table.alignRight'),
      h('span', { class: 'tz-tb-sep' }),
      btn('↑+', '上方插入行', 'table.rowAbove'),
      btn('↓+', '下方插入行', 'table.rowBelow'),
      btn('←+', '左侧插入列', 'table.colLeft'),
      btn('→+', '右侧插入列', 'table.colRight'),
      h('span', { class: 'tz-tb-sep' }),
      btn('删行', '删除行', 'table.deleteRow'),
      btn('删列', '删除列', 'table.deleteCol'),
      btn('删表', '删除表格', 'table.delete'),
    )
    ;(view.dom.parentElement ?? document.body).append(this.el)
  }

  update(view: EditorView): void {
    const state = view.state
    if (!isInTable(state) || !view.editable) {
      this.el.hidden = true
      return
    }
    const table = findTable(state.selection.$from)
    if (!table) {
      this.el.hidden = true
      return
    }
    const dom = view.nodeDOM(table.pos)
    if (!(dom instanceof HTMLElement)) return
    const container = this.el.offsetParent as HTMLElement | null
    const box = container?.getBoundingClientRect() ?? { top: 0, left: 0 }
    const r = dom.getBoundingClientRect()
    this.el.hidden = false
    this.el.style.transform = `translate(${Math.round(r.left - box.left + (container?.scrollLeft ?? 0))}px, ${Math.round(r.top - box.top + (container?.scrollTop ?? 0) - this.el.offsetHeight - 6)}px)`
  }

  destroy(): void {
    this.el.remove()
  }
}
