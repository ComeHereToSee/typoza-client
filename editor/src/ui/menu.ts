// 浮动菜单:斜杠菜单、块菜单、「转换为」、颜色菜单共用。键盘 ↑↓ 选择、↵ 执行、Esc 关闭,支持中英文关键词过滤。
import { h } from './dom'

export interface MenuItem {
  id: string
  label: string
  /** 右侧提示(快捷键或说明) */
  hint?: string
  /** 左侧图标:字符、emoji 或节点 */
  icon?: string | Node
  /** 过滤用关键词(英文名、拼音缩写……) */
  keywords?: string[]
  group?: string
  active?: boolean
  /** 子菜单 */
  children?: () => MenuItem[]
  run?: () => void
}

export interface MenuOptions {
  className?: string
  /** 过滤后没有结果时的提示 */
  emptyText?: string
  onClose?: (reason: 'select' | 'escape' | 'outside' | 'api') => void
}

function matches(item: MenuItem, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  if (item.label.toLowerCase().includes(q)) return true
  return (item.keywords ?? []).some((k) => k.toLowerCase().startsWith(q) || k.toLowerCase().includes(q))
}

export class FloatingMenu {
  readonly el: HTMLDivElement
  private items: MenuItem[] = []
  private visible: MenuItem[] = []
  private index = 0
  private query = ''
  private sub: FloatingMenu | null = null
  private parent: FloatingMenu | null = null
  private readonly onDocDown = (e: MouseEvent) => {
    if (!this.contains(e.target as Node)) this.close('outside')
  }

  constructor(private readonly options: MenuOptions = {}) {
    this.el = h('div', { class: `tz-menu ${options.className ?? ''}`, role: 'menu' })
    this.el.addEventListener('mousedown', (e) => e.preventDefault())
  }

  get isOpen(): boolean {
    return this.el.isConnected
  }

  private contains(node: Node): boolean {
    return this.el.contains(node) || Boolean(this.sub?.contains(node))
  }

  open(items: MenuItem[], anchor: { left: number; top: number; bottom: number }, query = ''): void {
    this.items = items
    this.query = query
    this.index = 0
    if (!this.isOpen) {
      document.body.append(this.el)
      document.addEventListener('mousedown', this.onDocDown, true)
    }
    this.render()
    this.place(anchor)
  }

  setQuery(query: string): number {
    this.query = query
    this.index = 0
    this.render()
    return this.visible.length
  }

  private place(anchor: { left: number; top: number; bottom: number }): void {
    const menu = this.el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let top = anchor.bottom + 6
    if (top + menu.height > vh - 8 && anchor.top - menu.height - 6 > 8) top = anchor.top - menu.height - 6
    const left = Math.min(Math.max(8, anchor.left), vw - menu.width - 8)
    this.el.style.left = `${left}px`
    this.el.style.top = `${Math.max(8, top)}px`
  }

  private render(): void {
    this.visible = this.items.filter((it) => matches(it, this.query))
    this.el.replaceChildren()
    if (this.visible.length === 0) {
      this.el.append(h('div', { class: 'tz-menu-empty' }, this.options.emptyText ?? '没有匹配的项'))
      return
    }
    let group: string | undefined
    this.visible.forEach((item, i) => {
      if (item.group && item.group !== group) {
        group = item.group
        this.el.append(h('div', { class: 'tz-menu-group' }, item.group))
      }
      const icon = typeof item.icon === 'string' ? h('span', { class: 'tz-menu-icon' }, item.icon) : item.icon ? h('span', { class: 'tz-menu-icon' }, item.icon) : null
      const row = h(
        'div',
        {
          class: `tz-menu-item${i === this.index ? ' is-selected' : ''}${item.active ? ' is-active' : ''}`,
          role: 'menuitem',
          'data-id': item.id,
        },
        icon,
        h('span', { class: 'tz-menu-label' }, item.label),
        item.hint ? h('span', { class: 'tz-menu-hint' }, item.hint) : null,
        item.children ? h('span', { class: 'tz-menu-arrow' }, '›') : null,
      )
      row.addEventListener('mouseenter', () => {
        this.index = i
        this.highlight()
        if (item.children) this.openSub(row, item)
        else this.closeSub()
      })
      row.addEventListener('click', () => this.choose(i))
      this.el.append(row)
    })
  }

  private highlight(): void {
    const rows = this.el.querySelectorAll('.tz-menu-item')
    rows.forEach((r, i) => r.classList.toggle('is-selected', i === this.index))
    rows[this.index]?.scrollIntoView({ block: 'nearest' })
  }

  private openSub(row: HTMLElement, item: MenuItem): void {
    if (!item.children) return
    this.closeSub()
    const sub = new FloatingMenu({ className: this.options.className, onClose: (reason) => {
      if (reason === 'select') this.close('select')
    } })
    sub.parent = this
    const r = row.getBoundingClientRect()
    sub.open(item.children(), { left: r.right + 4, top: r.top, bottom: r.top })
    this.sub = sub
  }

  private closeSub(): void {
    this.sub?.close('api')
    this.sub = null
  }

  private choose(i: number): void {
    const item = this.visible[i]
    if (!item) return
    if (item.children) {
      const row = this.el.querySelectorAll<HTMLElement>('.tz-menu-item')[i]
      if (row) this.openSub(row, item)
      return
    }
    this.close('select')
    item.run?.()
  }

  /** 菜单打开时由编辑器转发按键;返回 true 表示已处理。 */
  handleKey(e: KeyboardEvent): boolean {
    if (this.sub?.isOpen) return this.sub.handleKey(e)
    switch (e.key) {
      case 'ArrowDown':
        this.index = (this.index + 1) % Math.max(1, this.visible.length)
        this.highlight()
        return true
      case 'ArrowUp':
        this.index = (this.index - 1 + this.visible.length) % Math.max(1, this.visible.length)
        this.highlight()
        return true
      case 'ArrowRight': {
        const item = this.visible[this.index]
        if (!item?.children) return false
        this.choose(this.index)
        return true
      }
      case 'ArrowLeft':
        if (this.parent) {
          this.close('api')
          return true
        }
        return false
      case 'Enter':
      case 'Tab':
        if (this.visible.length === 0) return false
        this.choose(this.index)
        return true
      case 'Escape':
        this.close('escape')
        return true
      default:
        return false
    }
  }

  close(reason: 'select' | 'escape' | 'outside' | 'api' = 'api'): void {
    if (!this.isOpen) return
    this.closeSub()
    document.removeEventListener('mousedown', this.onDocDown, true)
    this.el.remove()
    if (this.parent) this.parent.sub = null
    this.options.onClose?.(reason)
  }
}
