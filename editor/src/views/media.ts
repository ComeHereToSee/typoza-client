// 媒体块视图:本地/在线视频与音频、在线嵌入(YouTube、B 站……)、PDF 内嵌、书签卡片、附件。
import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { isVideoEmbed, providerName } from '../core/embed'
import { type EditorEnv, localPathOf, resourceUrl } from '../core/env'
import { basename } from '../core/paths'
import { ICONS, h, svgIcon } from '../ui/dom'
import type { LinkPreview } from '../host/types'

const previewCache = new Map<string, Promise<LinkPreview | null>>()

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export class MediaView implements NodeView {
  dom: HTMLElement
  private body: HTMLElement

  constructor(
    private node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly env: EditorEnv,
  ) {
    this.body = h('div', { class: 'tz-media-body' })
    const toolbar = this.buildToolbar()
    this.dom = h('div', { class: 'tz-media', contenteditable: 'false' }, this.body, toolbar)
    this.render()
  }

  private select(): void {
    const pos = this.getPos()
    if (pos !== undefined) this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)))
  }

  private buildToolbar(): HTMLElement {
    const btn = (icon: string, title: string, run: () => void) =>
      h(
        'button',
        {
          type: 'button',
          class: 'tz-media-tool',
          title,
          onmousedown: ((e: Event) => e.preventDefault()) as EventListener,
          onclick: ((e: Event) => {
            e.stopPropagation()
            run()
          }) as EventListener,
        },
        svgIcon(icon, 14),
      )
    return h(
      'div',
      { class: 'tz-media-toolbar' },
      btn(ICONS.grip, '选中此块', () => this.select()),
      btn(ICONS.external, '打开', () => this.open()),
      btn(ICONS.finder, '在 Finder 中显示', () => {
        const p = localPathOf(this.env, this.node.attrs.src)
        if (p) void this.env.host.revealInFinder(p)
      }),
      btn(ICONS.trash, '删除', () => {
        const pos = this.getPos()
        if (pos !== undefined) this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize))
      }),
    )
  }

  private open(): void {
    const src = this.node.attrs.src as string
    const local = localPathOf(this.env, src)
    if (local) void this.env.host.openWithDefaultApp(local)
    else void this.env.host.openExternal(src)
  }

  private render(): void {
    const a = this.node.attrs
    const kind = a.kind as string
    this.dom.dataset.kind = kind
    this.dom.classList.toggle('is-local', localPathOf(this.env, a.src) !== null)
    this.body.replaceChildren()
    const url = resourceUrl(this.env, a.src)
    switch (kind) {
      case 'video': {
        const video = h('video', { src: url, controls: true, preload: 'metadata', playsinline: true })
        if (a.width) video.style.width = /^\d+$/.test(a.width) ? `${a.width}px` : a.width
        video.addEventListener('error', () => this.showError(`视频无法播放:${a.src}`))
        this.body.append(video)
        break
      }
      case 'audio': {
        const audio = h('audio', { src: url, controls: true, preload: 'metadata' })
        audio.addEventListener('error', () => this.showError(`音频无法播放:${a.src}`))
        this.body.append(h('div', { class: 'tz-audio-name' }, a.title || basename(a.src)), audio)
        break
      }
      case 'embed': {
        const frame = h('iframe', {
          src: url,
          loading: 'lazy',
          allowfullscreen: true,
          allow: 'fullscreen; picture-in-picture; encrypted-media; clipboard-write; autoplay',
          referrerpolicy: 'strict-origin-when-cross-origin',
          // 第三方页面:允许脚本与同源(播放器需要),禁止顶层跳转
          sandbox: 'allow-scripts allow-same-origin allow-popups allow-presentation allow-forms',
          title: providerName(a.src),
        })
        const wrap = h('div', { class: isVideoEmbed(a.src) ? 'tz-embed tz-embed-video' : 'tz-embed' }, frame)
        if (!isVideoEmbed(a.src) && a.height) wrap.style.height = /^\d+$/.test(a.height) ? `${a.height}px` : a.height
        this.body.append(wrap, h('div', { class: 'tz-embed-caption' }, providerName(a.src)))
        break
      }
      case 'pdf': {
        const frame = h('iframe', { src: url, class: 'tz-pdf', title: a.title || basename(a.src) })
        if (a.height) frame.style.height = /^\d+$/.test(a.height) ? `${a.height}px` : a.height
        this.body.append(frame, h('div', { class: 'tz-embed-caption' }, a.title || basename(a.src)))
        break
      }
      case 'bookmark':
        this.renderBookmark()
        break
      case 'file':
        this.renderFile()
        break
      default:
        this.showError(`未知媒体类型:${kind}`)
    }
  }

  private showError(message: string): void {
    this.dom.classList.add('is-broken')
    this.body.append(h('div', { class: 'tz-media-error' }, message))
  }

  private renderBookmark(): void {
    const src = this.node.attrs.src as string
    const title = h('div', { class: 'tz-bookmark-title' }, this.node.attrs.title || src)
    const desc = h('div', { class: 'tz-bookmark-desc' })
    const link = h('div', { class: 'tz-bookmark-url' }, src)
    const thumb = h('div', { class: 'tz-bookmark-thumb', hidden: true })
    const card = h('a', { class: 'tz-bookmark', href: src, title: src }, h('div', { class: 'tz-bookmark-text' }, title, desc, link), thumb)
    card.addEventListener('click', (e) => {
      e.preventDefault()
      void this.env.host.openExternal(src)
    })
    this.body.append(card)
    let pending = previewCache.get(src)
    if (!pending) {
      pending = this.env.host.fetchLinkPreview(src).catch(() => null)
      previewCache.set(src, pending)
    }
    void pending.then((p) => {
      if (!p || this.node.attrs.src !== src) return
      if (!this.node.attrs.title && p.title) title.textContent = p.title
      desc.textContent = p.description
      if (p.icon) link.prepend(h('img', { class: 'tz-bookmark-icon', src: p.icon, alt: '' }))
      if (p.image) {
        thumb.hidden = false
        thumb.append(h('img', { src: p.image, alt: '', loading: 'lazy' }))
      }
    })
  }

  private renderFile(): void {
    const src = this.node.attrs.src as string
    const name = this.node.attrs.title || basename(src)
    const meta = h('span', { class: 'tz-file-meta' })
    const card = h('div', { class: 'tz-file-card', title: src }, svgIcon(ICONS.file, 20), h('span', { class: 'tz-file-name' }, name), meta)
    card.addEventListener('click', () => this.open())
    this.body.append(card)
    const local = localPathOf(this.env, src)
    if (local) {
      void this.env.host.stat(local).then((s) => {
        meta.textContent = s ? formatSize(s.size) : '文件不存在'
        card.classList.toggle('is-missing', !s)
      })
    }
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    const same = node.attrs.kind === this.node.attrs.kind && node.attrs.src === this.node.attrs.src && node.attrs.title === this.node.attrs.title
    this.node = node
    if (!same) {
      this.dom.classList.remove('is-broken')
      this.render()
    }
    return true
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  // 播放器、卡片、工具条上的操作都交给它们自己,编辑器不接管
  stopEvent(e: Event): boolean {
    return e.type !== 'dragstart' && e.type !== 'drop'
  }

  ignoreMutation(): boolean {
    return true
  }
}
