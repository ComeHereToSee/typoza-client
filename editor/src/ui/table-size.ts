// 表格行列选择:⌥⇧⌘T 插入表格、表格工具条「调整行列数」共用。
// 网格最多 6 列 × 10 行,点格子即选;更大的表格在输入框里手输(对照表 X-36)。行数含表头行。
import { h } from './dom'

export interface TableSize {
  rows: number
  cols: number
}

const GRID_COLS = 6
const GRID_ROWS = 10
const MAX = 99

export interface TableSizeOptions {
  title: string
  initial: TableSize
  anchor?: { left: number; top: number; bottom: number }
}

export function pickTableSize(options: TableSizeOptions): Promise<TableSize | null> {
  return new Promise((resolve) => {
    const colsInput = h('input', { class: 'tz-table-size-input', type: 'number', min: '1', max: String(MAX), 'aria-label': '列数' })
    const rowsInput = h('input', { class: 'tz-table-size-input', type: 'number', min: '1', max: String(MAX), 'aria-label': '行数', title: '含表头行' })
    colsInput.value = String(options.initial.cols)
    rowsInput.value = String(options.initial.rows)
    const label = h('div', { class: 'tz-table-size-label' })
    const grid = h('div', { class: 'tz-table-size-grid' })
    const cells: HTMLElement[] = []
    for (let r = 1; r <= GRID_ROWS; r++) {
      for (let c = 1; c <= GRID_COLS; c++) {
        const cell = h('span', { class: 'tz-table-size-cell', 'data-row': r, 'data-col': c })
        cells.push(cell)
        grid.append(cell)
      }
    }
    const ok = h('button', { type: 'button', class: 'tz-btn-primary' }, '确定')
    const box = h(
      'div',
      { class: 'tz-popover tz-table-size', role: 'dialog', 'aria-label': options.title },
      h('div', { class: 'tz-prompt-title' }, options.title),
      grid,
      label,
      h('div', { class: 'tz-table-size-fields' }, h('label', null, '列数 ', colsInput), h('label', null, '行数 ', rowsInput), ok),
    )

    const read = (): TableSize | null => {
      const cols = Number.parseInt(colsInput.value, 10)
      const rows = Number.parseInt(rowsInput.value, 10)
      if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1 || cols > MAX || rows > MAX) return null
      return { rows, cols }
    }
    const paint = (size: TableSize | null) => {
      for (const cell of cells) {
        const on = size !== null && Number(cell.dataset.row) <= size.rows && Number(cell.dataset.col) <= size.cols
        cell.classList.toggle('is-on', on)
      }
      label.textContent = size ? `${size.cols} 列 × ${size.rows} 行` : `请输入 1~${MAX} 的列数与行数`
    }
    const cellSize = (target: EventTarget | null): TableSize | null => {
      const cell = target instanceof HTMLElement ? target.closest<HTMLElement>('.tz-table-size-cell') : null
      return cell ? { rows: Number(cell.dataset.row), cols: Number(cell.dataset.col) } : null
    }

    let settled = false
    const finish = (value: TableSize | null) => {
      if (settled) return
      settled = true
      document.removeEventListener('mousedown', outside, true)
      box.remove()
      resolve(value)
    }
    const outside = (e: MouseEvent) => {
      if (!box.contains(e.target as Node)) finish(null)
    }

    grid.addEventListener('mouseover', (e) => {
      const size = cellSize(e.target)
      if (size) paint(size)
    })
    grid.addEventListener('mouseleave', () => paint(read()))
    grid.addEventListener('mousedown', (e) => {
      const size = cellSize(e.target)
      if (!size) return
      e.preventDefault()
      finish(size)
    })
    for (const input of [colsInput, rowsInput]) {
      input.addEventListener('input', () => paint(read()))
      input.addEventListener('keydown', (e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          const size = read()
          if (size) finish(size)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(null)
        }
      })
    }
    ok.addEventListener('click', () => {
      const size = read()
      if (size) finish(size)
    })

    document.body.append(box)
    const a = options.anchor
    if (a) {
      box.style.left = `${Math.min(Math.max(8, a.left), window.innerWidth - box.offsetWidth - 8)}px`
      box.style.top = `${Math.min(a.bottom + 8, window.innerHeight - box.offsetHeight - 8)}px`
    } else {
      box.classList.add('is-centered')
    }
    paint(read())
    document.addEventListener('mousedown', outside, true)
    requestAnimationFrame(() => {
      colsInput.focus()
      colsInput.select()
    })
  })
}
