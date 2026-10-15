// 选中文字时的浮动格式条(Notion)、链接编辑与悬停卡片、⌘/「转换为」菜单。
import type { MarkType } from 'prosemirror-model'
import { NodeSelection, Plugin, type EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { BlockSelection } from '../core/block-selection'
import { currentBlockKind, markRange, removeLink, setLink } from '../core/commands'
import type { EditorEnv } from '../core/env'
import { openHref } from '../core/links'
import { getCommand, registerCommand, runCommand } from '../core/registry'
import { schema } from '../core/schema'
import { ICONS, h, svgIcon } from '../ui/dom'
import { FloatingMenu } from '../ui/menu'
import { promptInput } from '../ui/prompt'
import { BLOCK_KINDS, colorItems, turnIntoItems, turnMenuItems } from './items'

const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|[oa]d)/.test(navigator.platform)

const m = schema.marks

function isMarkActive(state: EditorState, type: MarkType): boolean {
  const { from, to, empty, $from } = state.selection
  if (empty) return Boolean(type.isInSet(state.storedMarks ?? $from.marks()))
  return state.doc.rangeHasMark(from, to, type)
}

/** ⌘K:编辑选区或光标所在链接;地址留空即移除链接。 */
export async function editLink(view: EditorView): Promise<void> {
  const { $from, from, to, empty } = view.state.selection
  const existing = markRange($from, m.link)
  if (empty && !existing) {
    // 没有选中文字:插入一个以网址为文字的链接
  }
  const coords = view.coordsAtPos(from)
  const href = await promptInput({
    title: existing ? '编辑链接' : '添加链接',
    placeholder: '粘贴网址,或输入文档相对路径 / #标题',
    value: existing?.mark.attrs.href ?? '',
    anchor: { left: coords.left, top: coords.top, bottom: view.coordsAtPos(to).bottom },
  })
  view.focus()
  if (href === null) return
  if (href === '') {
    removeLink(view.state, view.dispatch)
    return
  }
  setLink(href)(view.state, view.dispatch)
}

/** 焦点不在正文(侧栏、无文档时),且不在输入框里。 */
function focusOutsideEditor(view: EditorView): boolean {
  if (view.hasFocus()) return false
  const active = document.activeElement
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active instanceof HTMLElement && active.isContentEditable))) return false
  return true
}

export function toolbarPlugin(env: EditorEnv): Plugin {
  registerCommand({
    id: 'format.link',
    label: '链接',
    run: (view) => {
      // ⌘K:正文内加链接;焦点不在正文时为快速打开(notion-input.md 六 第 2 行)
      if (focusOutsideEditor(view) && getCommand('file.quickOpen')) return runCommand(view, 'file.quickOpen')
      void editLink(view)
      return true
    },
  })
  const turnMenu = new FloatingMenu({ className: 'tz-turn-menu', search: '转换为…' })
  registerCommand({
    id: 'block.turnIntoMenu',
    label: '转换为…',
    run: (view) => {
      // 光标所在块或块选中态都可用;不可转换的块只给创建副本 / 移动到 / 复制为 Markdown / 删除(notion-input.md 7.3)
      const c = view.coordsAtPos(view.state.selection.from)
      turnMenu.open(turnMenuItems(view), c)
      return true
    },
  })
  return new Plugin({
    props: {
      handleKeyDown(_view, event) {
        if (turnMenu.isOpen && turnMenu.handleKey(event)) {
          event.preventDefault()
          return true
        }
        return false
      },
      handleClick(view, pos, event) {
        if (!(event.metaKey || event.ctrlKey)) return false
        const $pos = view.state.doc.resolve(pos)
        const link = markRange($pos, m.link)
        if (!link) return false
        openHref(view, env, link.mark.attrs.href, event.shiftKey)
        return true
      },
    },
    view: (view) => new SelectionToolbar(view, env),
  })
}

class SelectionToolbar {
  private readonly el: HTMLDivElement
  private readonly hover: HTMLDivElement
  private readonly menu = new FloatingMenu({ className: 'tz-toolbar-menu' })
  private mouseDown = false
  private hoverTimer = 0
  private readonly onDown = () => {
    this.mouseDown = true
    this.hide()
  }
  private readonly onUp = () => {
    this.mouseDown = false
    setTimeout(() => this.update(this.view), 0)
  }
  private readonly onOver = (e: MouseEvent) => this.trackHover(e)
  /** 焦点不在正文时 ⌘K 打开快速打开(原生菜单的 ⌘K 走 format.link 命令,浏览器宿主没有菜单,在这里接) */
  private readonly onKey = (e: KeyboardEvent) => {
    const mod = isMac ? e.metaKey : e.ctrlKey
    if (!mod || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'k' || e.defaultPrevented) return
    if (!focusOutsideEditor(this.view) || !getCommand('file.quickOpen')) return
    e.preventDefault()
    runCommand(this.view, 'file.quickOpen')
  }

  constructor(
    private readonly view: EditorView,
    private readonly env: EditorEnv,
  ) {
    this.el = h('div', { class: 'tz-toolbar', hidden: true })
    this.el.addEventListener('mousedown', (e) => e.preventDefault())
    this.hover = h('div', { class: 'tz-popover tz-link-hover', hidden: true })
    this.hover.addEventListener('mouseenter', () => clearTimeout(this.hoverTimer))
    this.hover.addEventListener('mouseleave', () => this.hideHover())
    document.body.append(this.el, this.hover)
    view.dom.addEventListener('mousedown', this.onDown)
    document.addEventListener('mouseup', this.onUp)
    document.addEventListener('keydown', this.onKey)
    view.dom.addEventListener('mouseover', this.onOver)
  }

  private button(label: string | Node, title: string, run: () => void, active = false, cls = ''): HTMLButtonElement {
    return h(
      'button',
      {
        type: 'button',
        class: `tz-tb-btn${active ? ' is-active' : ''} ${cls}`,
        title,
        onclick: ((e: Event) => {
          e.preventDefault()
          run()
        }) as EventListener,
      },
      label,
    )
  }

  private render(): void {
    const view = this.view
    const state = view.state
    const kind = currentBlockKind(state)
    const kindLabel = BLOCK_KINDS.find((k) => k.kind === kind)?.label ?? '文本'
    const cmd = (id: string) => () => {
      runCommand(view, id)
      this.render()
    }
    const turn = this.button(`${kindLabel} ▾`, '转换为', () => {
      const r = turn.getBoundingClientRect()
      this.menu.open(turnIntoItems(view), r)
    }, false, 'tz-tb-turn')
    const color = this.button(h('span', { class: 'tz-tb-color' }, 'A'), '文字颜色与背景色', () => {
      const r = color.getBoundingClientRect()
      this.menu.open(colorItems(view, false), r)
    }, isMarkActive(state, m.color))
    this.el.replaceChildren(
      turn,
      h('span', { class: 'tz-tb-sep' }),
      this.button(svgIcon(ICONS.link, 15), '链接(⌘K)', () => void editLink(view), isMarkActive(state, m.link)),
      h('span', { class: 'tz-tb-sep' }),
      this.button(h('b', null, 'B'), '加粗(⌘B)', cmd('format.bold'), isMarkActive(state, m.strong)),
      this.button(h('i', null, 'I'), '斜体(⌘I)', cmd('format.italic'), isMarkActive(state, m.em)),
      this.button(h('u', null, 'U'), '下划线(⌘U)', cmd('format.underline'), isMarkActive(state, m.underline)),
      this.button(h('s', null, 'S'), '删除线(⌘⇧S)', cmd('format.strike'), isMarkActive(state, m.strike)),
      this.button(h('code', null, '<>'), '行内代码(⌘E)', cmd('format.code'), isMarkActive(state, m.code)),
      this.button('√x', '行内公式(⌘⇧E)', cmd('format.inlineMath')),
      this.button(h('mark', null, 'H'), '高亮(⌘⇧H)', cmd('format.highlight'), isMarkActive(state, m.highlight)),
      this.button('x²', '上标', cmd('format.superscript'), isMarkActive(state, m.sup)),
      this.button('x₂', '下标', cmd('format.subscript'), isMarkActive(state, m.sub)),
      h('span', { class: 'tz-tb-sep' }),
      color,
    )
  }

  update(view: EditorView, prev?: EditorState): void {
    const state = view.state
    if (prev && prev.selection.eq(state.selection) && prev.doc.eq(state.doc) && !this.el.hidden) return
    const sel = state.selection
    const show =
      !this.mouseDown &&
      view.hasFocus() &&
      !sel.empty &&
      !(sel instanceof NodeSelection) &&
      !(sel instanceof BlockSelection) &&
      !sel.$from.parent.type.spec.code &&
      !view.composing
    if (!show) {
      if (!this.menu.isOpen) this.hide()
      return
    }
    this.render()
    this.el.hidden = false
    const start = view.coordsAtPos(sel.from)
    const end = view.coordsAtPos(sel.to)
    const box = this.el.getBoundingClientRect()
    const mid = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2
    let top = Math.min(start.top, end.top) - box.height - 8
    if (top < 8) top = Math.max(start.bottom, end.bottom) + 8
    const left = Math.min(Math.max(8, mid - box.width / 2), window.innerWidth - box.width - 8)
    this.el.style.left = `${left}px`
    this.el.style.top = `${top}px`
  }

  private hide(): void {
    this.el.hidden = true
  }

  // ---------- 链接悬停卡片 ----------

  private trackHover(e: MouseEvent): void {
    const a = (e.target as HTMLElement).closest('a[href]')
    if (!a || !this.view.dom.contains(a) || a.classList.contains('tz-wikilink') || a.closest('.tz-media, .tz-html-preview')) {
      clearTimeout(this.hoverTimer)
      this.hoverTimer = window.setTimeout(() => this.hideHover(), 300)
      return
    }
    clearTimeout(this.hoverTimer)
    const href = a.getAttribute('href') ?? ''
    this.hover.replaceChildren(
      h('span', { class: 'tz-link-url', title: href }, href),
      this.button('打开', '打开链接(⌘ 点击)', () => {
        const pos = this.view.posAtDOM(a, 0)
        openHref(this.view, this.env, href, false)
        void pos
      }),
      this.button('编辑', '编辑链接(⌘K)', () => {
        const pos = this.view.posAtDOM(a, 0)
        this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.near(this.view.state.doc.resolve(pos + 1))))
        this.hideHover()
        void editLink(this.view)
      }),
    )
    const r = a.getBoundingClientRect()
    this.hover.hidden = false
    this.hover.style.left = `${r.left}px`
    this.hover.style.top = `${r.bottom + 4}px`
  }

  private hideHover(): void {
    this.hover.hidden = true
  }

  destroy(): void {
    this.view.dom.removeEventListener('mousedown', this.onDown)
    document.removeEventListener('mouseup', this.onUp)
    document.removeEventListener('keydown', this.onKey)
    this.view.dom.removeEventListener('mouseover', this.onOver)
    this.menu.close('api')
    this.el.remove()
    this.hover.remove()
  }
}
