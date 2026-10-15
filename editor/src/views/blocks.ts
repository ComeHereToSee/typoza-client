// 其余块与行内节点的视图:折叠块、待办列表项、目录、HTML 块与行内 HTML、YAML、脚注引用、wikilink。
import DOMPurify from 'dompurify'
import type { Node as PMNode } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { collectHeadings } from '../core/blocks'
import { setToggleOpen } from '../core/commands'
import { type EditorEnv, openImageLightbox, resourceUrl } from '../core/env'
import { schema } from '../core/schema'
import { ICONS, h, svgIcon } from '../ui/dom'

// ---------- 折叠块 ----------

export class ToggleView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement

  constructor(
    private node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    const button = h(
      'button',
      { type: 'button', class: 'tz-toggle-btn', contenteditable: 'false', title: '展开 / 收起(⌘↵)', tabindex: '-1' },
      svgIcon(ICONS.chevron, 14),
    )
    button.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const pos = this.getPos()
      if (pos !== undefined) this.view.dispatch(setToggleOpen(this.view.state.tr, pos, !this.node.attrs.open))
    })
    this.contentDOM = h('div', { class: 'tz-toggle-content' })
    this.dom = h('div', { class: 'tz-toggle' }, button, this.contentDOM)
    this.sync()
  }

  private sync(): void {
    this.dom.classList.toggle('is-open', Boolean(this.node.attrs.open))
    this.dom.classList.toggle('is-empty-body', this.node.childCount <= 1)
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.sync()
    return true
  }

  ignoreMutation(m: MutationRecord | { type: 'selection'; target: Node }): boolean {
    return m.type === 'attributes' && m.target === this.dom
  }
}

// ---------- 列表项(待办带勾选框) ----------

export class ListItemView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement

  constructor(
    private node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    if (node.attrs.checked === null) {
      this.dom = this.contentDOM = h('li')
      return
    }
    const box = h('span', {
      class: 'tz-task-box',
      contenteditable: 'false',
      role: 'checkbox',
      'aria-checked': String(node.attrs.checked),
    })
    box.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const pos = this.getPos()
      if (pos !== undefined) this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, { checked: !this.node.attrs.checked }))
    })
    this.contentDOM = h('div', { class: 'tz-task-content' })
    this.dom = h('li', { class: 'tz-task', 'data-checked': String(node.attrs.checked) }, box, this.contentDOM)
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    // 普通项与待办之间切换时 DOM 结构不同,重建
    if ((node.attrs.checked === null) !== (this.node.attrs.checked === null)) return false
    this.node = node
    if (node.attrs.checked !== null) {
      this.dom.dataset.checked = String(node.attrs.checked)
      this.dom.querySelector('.tz-task-box')?.setAttribute('aria-checked', String(node.attrs.checked))
    }
    return true
  }

  ignoreMutation(m: MutationRecord | { type: 'selection'; target: Node }): boolean {
    return m.type === 'attributes' && (m.target === this.dom || (m.target as HTMLElement).classList?.contains('tz-task-box'))
  }
}

// ---------- 目录 ----------

const tocViews = new Set<TocView>()

/** 文档变化后刷新所有目录块(目录依赖整篇文档,节点自身不变时不会收到 update)。 */
export function refreshTocs(): void {
  for (const v of tocViews) v.render()
}

export class TocView implements NodeView {
  dom: HTMLElement

  constructor(private readonly view: EditorView) {
    this.dom = h('nav', { class: 'tz-toc', contenteditable: 'false', 'aria-label': '目录' })
    tocViews.add(this)
    this.render()
  }

  render(): void {
    const headings = collectHeadings(this.view.state.doc)
    if (headings.length === 0) {
      this.dom.replaceChildren(h('div', { class: 'tz-toc-empty' }, '目录:文档里还没有标题'))
      return
    }
    const min = Math.min(...headings.map((x) => x.level))
    this.dom.replaceChildren(
      ...headings.map((item) => {
        const a = h('a', { class: `tz-toc-item tz-toc-l${item.level - min + 1}`, href: `#${item.id}` }, item.text || '(无标题)')
        a.addEventListener('click', (e) => {
          e.preventDefault()
          const tr = this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, item.pos + 1))
          this.view.dispatch(tr.scrollIntoView())
          this.view.focus()
        })
        return a
      }),
    )
  }

  stopEvent(e: Event): boolean {
    return e.type === 'click' || e.type === 'mousedown'
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    tocViews.delete(this)
  }
}

// ---------- HTML ----------

/** 净化并改写资源地址:本机图片、视频走 typoza://local/。 */
export function sanitizeHtml(html: string, env: EditorEnv): DocumentFragment {
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    ADD_TAGS: ['iframe', 'video', 'audio', 'source', 'details', 'summary', 'kbd'],
    ADD_ATTR: ['allowfullscreen', 'frameborder', 'controls', 'loop', 'muted', 'playsinline', 'target', 'align'],
    FORBID_TAGS: ['script', 'style', 'object', 'embed', 'form'],
  })
  for (const el of Array.from(fragment.querySelectorAll<HTMLElement>('img[src], video[src], audio[src], source[src], iframe[src]'))) {
    const src = el.getAttribute('src') ?? ''
    el.setAttribute('data-tz-src', src)
    el.setAttribute('src', resourceUrl(env, src))
    if (el.tagName === 'IFRAME') el.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-presentation')
  }
  return fragment
}

export class HtmlBlockView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private preview: HTMLDivElement
  private rendered: string | null = null

  constructor(
    private node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly env: EditorEnv,
  ) {
    this.preview = h('div', { class: 'tz-html-preview', contenteditable: 'false' })
    this.contentDOM = h('pre', { class: 'tz-html-source', spellcheck: 'false' })
    this.dom = h('div', { class: 'tz-html-block' }, this.preview, this.contentDOM)
    this.preview.addEventListener('dblclick', (e) => {
      const img = (e.target as HTMLElement).closest('img')
      if (img) {
        e.preventDefault()
        openImageLightbox(this.view, this.env, { element: img })
      }
    })
    this.preview.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('a, video, audio, iframe, summary')) return
      if (e.detail > 1) return
      // 单击预览进入源码编辑
      const pos = this.getPos()
      if (pos === undefined) return
      e.preventDefault()
      this.view.focus()
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, pos + 1)))
    })
    this.render()
  }

  private render(): void {
    const html = this.node.textContent
    if (html === this.rendered) return
    this.rendered = html
    const isComment = /^\s*<!--[\s\S]*-->\s*$/.test(html)
    this.dom.classList.toggle('is-comment', isComment)
    if (isComment) {
      this.preview.replaceChildren(h('span', { class: 'tz-html-comment' }, html.trim()))
      return
    }
    this.preview.replaceChildren(sanitizeHtml(html, this.env))
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  stopEvent(e: Event): boolean {
    return this.preview.contains(e.target as Node) && e.type !== 'mousedown'
  }

  ignoreMutation(m: MutationRecord | { type: 'selection'; target: Node }): boolean {
    return this.preview.contains(m.target as Node)
  }
}

export class HtmlInlineView implements NodeView {
  dom: HTMLElement

  constructor(node: PMNode, env: EditorEnv) {
    const html = node.attrs.html as string
    if (/^<!--[\s\S]*-->$/.test(html.trim())) {
      this.dom = h('span', { class: 'tz-html-inline tz-html-comment', title: html }, html)
    } else if (/^<\/?[a-z][^>]*>$/i.test(html.trim())) {
      // 单个不成对的标签:以弱化文字显示,便于用户看到并修正
      this.dom = h('span', { class: 'tz-html-inline tz-html-tag', title: '未成对的 HTML 标签' }, html)
    } else {
      this.dom = h('span', { class: 'tz-html-inline' })
      this.dom.append(sanitizeHtml(html, env))
    }
  }

  ignoreMutation(): boolean {
    return true
  }
}

// ---------- YAML ----------

export class FrontMatterView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement

  constructor() {
    this.contentDOM = h('code', { spellcheck: 'false' })
    this.dom = h('div', { class: 'tz-frontmatter' }, h('span', { class: 'tz-frontmatter-label', contenteditable: 'false' }, 'YAML'), h('pre', null, this.contentDOM))
  }

  ignoreMutation(m: MutationRecord | { type: 'selection'; target: Node }): boolean {
    return (m.target as HTMLElement).classList?.contains('tz-frontmatter-label') ?? false
  }
}

// ---------- 脚注引用:悬停预览、点击跳到定义 ----------

export class FootnoteRefView implements NodeView {
  dom: HTMLElement
  private tip: HTMLElement | null = null

  constructor(
    private node: PMNode,
    private readonly view: EditorView,
  ) {
    this.dom = h('sup', { class: 'tz-footnote-ref' }, `[${node.attrs.label}]`)
    this.dom.addEventListener('mouseenter', () => this.showTip())
    this.dom.addEventListener('mouseleave', () => this.hideTip())
    this.dom.addEventListener('click', (e) => {
      e.preventDefault()
      const def = this.findDefinition()
      if (!def) return
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, def.pos + 2)).scrollIntoView())
      this.view.focus()
    })
  }

  private findDefinition(): { node: PMNode; pos: number } | null {
    let found: { node: PMNode; pos: number } | null = null
    this.view.state.doc.descendants((n, pos) => {
      if (found) return false
      if (n.type === schema.nodes.footnote_def && n.attrs.label === this.node.attrs.label) found = { node: n, pos }
      return !found
    })
    return found
  }

  private showTip(): void {
    const def = this.findDefinition()
    const text = def ? def.node.textContent : '未找到脚注定义'
    this.tip = h('div', { class: 'tz-popover tz-footnote-tip' }, text)
    document.body.append(this.tip)
    const r = this.dom.getBoundingClientRect()
    this.tip.style.left = `${r.left}px`
    this.tip.style.top = `${r.bottom + 6}px`
  }

  private hideTip(): void {
    this.tip?.remove()
    this.tip = null
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.dom.textContent = `[${node.attrs.label}]`
    return true
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.hideTip()
  }
}

// ---------- wikilink ----------

export class WikiLinkView implements NodeView {
  dom: HTMLElement

  constructor(node: PMNode, env: EditorEnv) {
    const target = node.attrs.target as string
    this.dom = h('a', { class: 'tz-wikilink', href: '#', title: `打开「${target}」(⌘ 点击在新标签页打开)` }, node.attrs.alias ?? target)
    this.dom.addEventListener('click', (e) => {
      e.preventDefault()
      env.openDocumentLink(target, e.metaKey)
    })
  }

  stopEvent(e: Event): boolean {
    return e.type === 'click'
  }

  ignoreMutation(): boolean {
    return true
  }
}
