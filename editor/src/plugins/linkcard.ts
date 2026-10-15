// 链接(PRD 3.2 链接、对照表 X-06、X-07、X-08、M-11):
// - 单击链接显示浮层【打开】【编辑】【复制】【移除】;⌘+点击直接打开(本地文档开新标签),⌥⇧+点击开新窗口;
// - 悬停显示地址,本地 Markdown 再显示目标文档的标题与首段;
// - ⌘K 新建链接时剪贴板里是网址就自动填上;
// - 从侧栏把文件拖进编辑区,插入 `[文件名](相对路径)`(对照表 S-19)。
import type { EditorState } from 'prosemirror-state'
import { TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { markRange, removeLink, setLink } from '../core/commands'
import { type EditorEnv, localPathOf, type OpenWhere } from '../core/env'
import { excerptOf, firstHeadingOf } from '../core/excerpt'
import { displayName, isOpenable, isTextDocument } from '../core/filetypes'
import { openHref } from '../core/links'
import { basename, dirname, extname, isExternalUrl, markdownHref, relativePath } from '../core/paths'
import { schema } from '../core/schema'
import { h } from '../ui/dom'
import { promptInput, validateUrl } from '../ui/prompt'

const m = schema.marks

/** 侧栏拖动文件时的数据类型 */
export const DRAG_PATH_TYPE = 'application/x-typoza-path'

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 点击时的修饰键:⌥⇧ 新窗口,⌘(Linux 上 Ctrl)新标签;没按修饰键返回 null */
export function clickTarget(e: MouseEvent): OpenWhere | null {
  if (e.altKey && e.shiftKey) return 'window'
  return e.metaKey || e.ctrlKey ? 'tab' : null
}

/** ⌘K:编辑选区或光标所在链接;地址留空即移除链接。新建时剪贴板里是网址就预先填上。 */
export async function editLink(view: EditorView, env: EditorEnv): Promise<void> {
  const { $from, from, to } = view.state.selection
  const existing = markRange($from, m.link)
  let value = existing ? String(existing.mark.attrs.href ?? '') : ''
  if (!existing) {
    // 读不到剪贴板只是不预填,加链接照常进行
    const clip = (await env.host.clipboardText().catch(() => '')).trim()
    if (clip && validateUrl(clip) === null) value = clip
  }
  const coords = view.coordsAtPos(from)
  const href = await promptInput({
    title: existing ? '编辑链接' : '添加链接',
    placeholder: '粘贴网址,或输入文档相对路径 / #标题',
    value,
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

/** 链接指向的本地文本文档(悬停预览用);网址、锚点、其它文件返回 null。省略 .md 的写法按 .md 找。 */
async function localDocument(env: EditorEnv, href: string): Promise<string | null> {
  if (!href || href.startsWith('#') || isExternalUrl(href)) return null
  const local = localPathOf(env, href.split('#')[0])
  if (!local) return null
  if (isTextDocument(local)) return local
  if (!extname(local) && (await env.host.stat(`${local}.md`))) return `${local}.md`
  return null
}

/** 侧栏拖进来的文件:在落点插入 `[文件名](相对路径)`(未保存的文档写绝对路径) */
export function insertFileLink(view: EditorView, env: EditorEnv, path: string, coords: { left: number; top: number }): void {
  const at = view.posAtCoords(coords)?.pos ?? view.state.selection.from
  const target = env.ctx.path ? relativePath(dirname(env.ctx.path), path) : path
  const text = isOpenable(path) ? displayName(path) : basename(path)
  const node = schema.text(text, [m.link.create({ href: markdownHref(target) })])
  const $at = view.state.doc.resolve(at)
  const tr = $at.parent.inlineContent ? view.state.tr.insert(at, node) : view.state.tr.insert(at, schema.nodes.paragraph.create(null, node))
  view.dispatch(tr.scrollIntoView())
  view.focus()
}

export class LinkCard {
  private readonly card: HTMLDivElement
  private readonly preview: HTMLDivElement
  private range: { from: number; to: number } | null = null
  private hoverTimer = 0
  private previewSeq = 0
  private previewFor: Element | null = null
  private readonly onOver = (e: MouseEvent) => this.trackHover(e)
  private readonly onDocDown = (e: MouseEvent) => {
    if (!this.card.contains(e.target as Node)) this.hideCard()
  }
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !this.card.hidden) this.hideCard()
  }

  constructor(
    private readonly view: EditorView,
    private readonly env: EditorEnv,
  ) {
    this.card = h('div', { class: 'tz-popover tz-link-card', hidden: true, role: 'dialog', 'aria-label': '链接' })
    // 按浮层上的按钮不让编辑器失去焦点与选区
    this.card.addEventListener('mousedown', (e) => e.preventDefault())
    this.preview = h('div', { class: 'tz-popover tz-link-preview', hidden: true })
    document.body.append(this.card, this.preview)
    view.dom.addEventListener('mouseover', this.onOver)
    document.addEventListener('mousedown', this.onDocDown, true)
    document.addEventListener('keydown', this.onKey, true)
  }

  private place(el: HTMLElement, anchor: Element): void {
    const r = anchor.getBoundingClientRect()
    el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8))}px`
    el.style.top = `${r.bottom + 4}px`
  }

  /** 单击链接(没按修饰键):在链接下方显示操作浮层 */
  showFor(anchor: Element, pos: number): void {
    const link = markRange(this.view.state.doc.resolve(pos), m.link)
    if (!link) return
    const href = String(link.mark.attrs.href ?? '')
    this.range = { from: link.from, to: link.to }
    const button = (label: string, title: string, name: string, run: () => void) =>
      h('button', { type: 'button', class: 'tz-tb-btn', title, name, onclick: ((e: Event) => (e.preventDefault(), run())) as EventListener }, label)
    const copy = button('复制', '复制链接地址', 'copy', () => {
      this.env.host.clipboardWrite({ text: href }).then(
        () => (copy.textContent = '已复制'),
        (err: unknown) => {
          copy.textContent = '复制失败'
          copy.title = errText(err)
        },
      )
    })
    this.card.replaceChildren(
      h('span', { class: 'tz-link-url', title: href }, href),
      button('打开', '打开链接(⌘ 点击在新标签页打开)', 'open', () => {
        this.hideCard()
        openHref(this.view, this.env, href, 'current')
      }),
      button('编辑', '编辑链接(⌘K)', 'edit', () => {
        this.hideCard()
        this.selectLink()
        void editLink(this.view, this.env)
      }),
      copy,
      button('移除', '移除链接,保留文字', 'remove', () => {
        const r = this.range
        this.hideCard()
        if (r) this.view.dispatch(this.view.state.tr.removeMark(r.from, r.to, m.link))
        this.view.focus()
      }),
    )
    this.hidePreview()
    this.card.hidden = false
    this.place(this.card, anchor)
  }

  private selectLink(): void {
    const r = this.range
    if (!r) return
    this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, r.from, r.to)))
  }

  private hideCard(): void {
    this.card.hidden = true
    this.range = null
  }

  // ---------- 悬停预览 ----------

  private trackHover(e: MouseEvent): void {
    const a = (e.target as HTMLElement).closest('a[href]')
    if (!a || !this.view.dom.contains(a) || a.classList.contains('tz-wikilink') || a.closest('.tz-media, .tz-html-preview') || !this.card.hidden) {
      clearTimeout(this.hoverTimer)
      this.hidePreview()
      return
    }
    if (a === this.previewFor) return
    clearTimeout(this.hoverTimer)
    this.hoverTimer = window.setTimeout(() => void this.showPreview(a), 400)
  }

  private async showPreview(a: Element): Promise<void> {
    const seq = ++this.previewSeq
    this.previewFor = a
    const href = a.getAttribute('href') ?? ''
    const url = h('div', { class: 'tz-link-url' }, href)
    this.preview.replaceChildren(url)
    this.preview.hidden = false
    this.place(this.preview, a)
    try {
      const doc = await localDocument(this.env, href)
      if (!doc || seq !== this.previewSeq) return
      const { text } = await this.env.host.readText(doc)
      if (seq !== this.previewSeq) return
      const excerpt = excerptOf(text, 160)
      this.preview.replaceChildren(
        h('div', { class: 'tz-link-preview-title' }, firstHeadingOf(text) ?? displayName(doc)),
        excerpt ? h('div', { class: 'tz-link-preview-excerpt' }, excerpt) : null,
        url,
      )
    } catch (err) {
      if (seq === this.previewSeq) this.preview.append(h('div', { class: 'tz-tree-error' }, `无法读取:${errText(err)}`))
    }
  }

  private hidePreview(): void {
    this.previewSeq++
    this.previewFor = null
    this.preview.hidden = true
  }

  update(_view: EditorView, prev?: EditorState): void {
    // 文档变了,记下的链接范围就不可靠了
    if (prev && !prev.doc.eq(this.view.state.doc)) this.hideCard()
  }

  destroy(): void {
    clearTimeout(this.hoverTimer)
    this.view.dom.removeEventListener('mouseover', this.onOver)
    document.removeEventListener('mousedown', this.onDocDown, true)
    document.removeEventListener('keydown', this.onKey, true)
    this.card.remove()
    this.preview.remove()
  }
}
