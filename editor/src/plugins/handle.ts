// Notion 块手柄:鼠标移到块上,左侧出现「+」与「⋮⋮」。
// 「+」在下方新建一行并打开斜杠菜单;「⋮⋮」单击打开块菜单,拖动可移动整块(列表项按项移动)。
import { NodeSelection, Plugin, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { blockAt, type BlockInfo } from '../core/blocks'
import { deleteBlock, duplicateBlock, moveBlock } from '../core/commands'
import { schema } from '../core/schema'
import { ICONS, h, svgIcon } from '../ui/dom'
import { FloatingMenu, type MenuItem } from '../ui/menu'
import { colorItems, turnIntoItems } from './items'
import { openSlashMenu } from './slash'

export function blockHandlePlugin(): Plugin {
  return new Plugin({ view: (view) => new BlockHandle(view) })
}

class BlockHandle {
  private readonly el: HTMLDivElement
  private readonly grip: HTMLButtonElement
  private current: BlockInfo | null = null
  private readonly menu = new FloatingMenu({ className: 'tz-block-menu' })
  private hideTimer = 0
  private readonly container: HTMLElement
  private readonly onMove = (e: MouseEvent) => this.track(e)
  private readonly onLeave = () => this.scheduleHide()

  constructor(private readonly view: EditorView) {
    const plus = h('button', { type: 'button', class: 'tz-handle-plus', title: '点击在下方添加块', tabindex: '-1' }, svgIcon(ICONS.plus, 16))
    this.grip = h('button', { type: 'button', class: 'tz-handle-grip', title: '拖动移动 · 点击打开菜单', draggable: 'true', tabindex: '-1' }, svgIcon(ICONS.grip, 16))
    this.el = h('div', { class: 'tz-block-handle', hidden: true }, plus, this.grip)
    this.container = view.dom.parentElement ?? document.body
    this.container.append(this.el)

    plus.addEventListener('mousedown', (e) => {
      e.preventDefault()
      this.addBelow()
    })
    this.grip.addEventListener('mousedown', (e) => e.stopPropagation())
    this.grip.addEventListener('click', (e) => {
      e.preventDefault()
      this.openMenu()
    })
    this.grip.addEventListener('dragstart', (e) => this.startDrag(e))
    this.grip.addEventListener('dragend', () => this.el.classList.remove('is-dragging'))
    this.el.addEventListener('mouseenter', () => clearTimeout(this.hideTimer))
    this.el.addEventListener('mouseleave', this.onLeave)
    view.dom.addEventListener('mousemove', this.onMove)
    view.dom.addEventListener('mouseleave', this.onLeave)
  }

  private track(e: MouseEvent): void {
    if (this.view.composing || !this.view.editable || this.menu.isOpen) return
    // 文字左侧的空白也算在块上:向右偏一点取位置
    const found = this.view.posAtCoords({ left: e.clientX + 40, top: e.clientY }) ?? this.view.posAtCoords({ left: e.clientX, top: e.clientY })
    if (!found) return
    let info: BlockInfo | null = null
    if (found.inside >= 0) {
      const node = this.view.state.doc.nodeAt(found.inside)
      if (node && node.isBlock && node.isAtom) {
        const $p = this.view.state.doc.resolve(found.inside)
        info = { node, pos: found.inside, depth: $p.depth }
      }
    }
    info ??= blockAt(this.view.state.doc.resolve(found.pos))
    if (!info || info.node.type === schema.nodes.frontmatter) return
    this.show(info)
  }

  private show(info: BlockInfo): void {
    const dom = this.view.nodeDOM(info.pos)
    if (!(dom instanceof HTMLElement)) return
    clearTimeout(this.hideTimer)
    this.current = info
    const box = this.container.getBoundingClientRect()
    const rect = dom.getBoundingClientRect()
    // 与块第一行文字垂直居中
    const style = getComputedStyle(dom)
    const line = Number.parseFloat(style.lineHeight) || 24
    const top = rect.top - box.top + this.container.scrollTop + Math.max(0, Math.min(line, rect.height) / 2 - 12) + (Number.parseFloat(style.paddingTop) || 0)
    const isListItem = info.node.type === schema.nodes.list_item
    const left = rect.left - box.left + this.container.scrollLeft - (isListItem ? 72 : 52)
    this.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
    this.el.hidden = false
  }

  private scheduleHide(): void {
    clearTimeout(this.hideTimer)
    this.hideTimer = window.setTimeout(() => {
      if (!this.menu.isOpen) this.el.hidden = true
    }, 300)
  }

  private selectBlock(): boolean {
    const info = this.current
    if (!info) return false
    const node = this.view.state.doc.nodeAt(info.pos)
    if (!node || node !== info.node) return false
    this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, info.pos)))
    return true
  }

  private addBelow(): void {
    const info = this.current
    if (!info) return
    const end = info.pos + info.node.nodeSize
    const tr = this.view.state.tr
    // 列表项下方新增的是同一列表里的新项
    if (info.node.type === schema.nodes.list_item) {
      tr.insert(end, schema.nodes.list_item.create({ checked: info.node.attrs.checked === null ? null : false }, schema.nodes.paragraph.create()))
      tr.setSelection(TextSelection.create(tr.doc, end + 2))
    } else {
      tr.insert(end, schema.nodes.paragraph.create())
      tr.setSelection(TextSelection.create(tr.doc, end + 1))
    }
    this.view.dispatch(tr.scrollIntoView())
    this.view.focus()
    openSlashMenu(this.view)
  }

  private openMenu(): void {
    if (!this.selectBlock()) return
    const view = this.view
    const st = (cmd: typeof deleteBlock) => () => {
      cmd(view.state, view.dispatch)
      view.focus()
    }
    // 「转换为」与「颜色」作用于块内文字:先把光标放进块里
    const enterBlock = (then: () => MenuItem[]) => () => {
      const sel = view.state.selection
      if (sel instanceof NodeSelection && sel.node.isBlock && !sel.node.isAtom) {
        view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(sel.from + 1))))
      }
      return then()
    }
    const items: MenuItem[] = [
      { id: 'block.delete', label: '删除', icon: '🗑', hint: '⌫', keywords: ['delete', 'shanchu'], run: st(deleteBlock) },
      { id: 'block.duplicate', label: '创建副本', icon: '⧉', hint: '⌘D', keywords: ['duplicate', 'fuzhi'], run: st(duplicateBlock) },
      { id: 'block.turnInto', label: '转换为', icon: '↻', keywords: ['turn', 'zhuanhuan'], children: enterBlock(() => turnIntoItems(view)) },
      { id: 'block.color', label: '颜色', icon: '🎨', keywords: ['color', 'yanse'], children: enterBlock(() => colorItems(view, true)) },
      { id: 'block.moveUp', label: '上移', icon: '↑', hint: '⌘⇧↑', keywords: ['up'], run: st(moveBlock(-1)) },
      { id: 'block.moveDown', label: '下移', icon: '↓', hint: '⌘⇧↓', keywords: ['down'], run: st(moveBlock(1)) },
    ]
    const r = this.grip.getBoundingClientRect()
    this.menu.open(items, { left: r.left, top: r.top, bottom: r.bottom })
  }

  private startDrag(e: DragEvent): void {
    if (!e.dataTransfer || !this.selectBlock()) {
      e.preventDefault()
      return
    }
    const sel = this.view.state.selection as NodeSelection
    const { dom, text, slice } = this.view.serializeForClipboard(sel.content())
    e.dataTransfer.clearData()
    e.dataTransfer.setData('text/html', dom.innerHTML)
    e.dataTransfer.setData('text/plain', text)
    e.dataTransfer.effectAllowed = 'copyMove'
    const blockDom = this.view.nodeDOM(sel.from)
    if (blockDom instanceof HTMLElement) e.dataTransfer.setDragImage(blockDom, 0, 0)
    // 放下时由 ProseMirror 删除原位置的节点选区并插入到落点(内部字段 node 精确指向被拖的块)
    this.view.dragging = { slice, move: true, node: sel } as unknown as EditorView['dragging']
    this.el.classList.add('is-dragging')
  }

  update(): void {
    if (this.current && this.view.state.doc.nodeAt(this.current.pos) !== this.current.node) {
      this.current = null
      this.el.hidden = true
    }
  }

  destroy(): void {
    this.view.dom.removeEventListener('mousemove', this.onMove)
    this.view.dom.removeEventListener('mouseleave', this.onLeave)
    this.menu.close('api')
    this.el.remove()
  }
}
