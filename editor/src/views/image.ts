// 图片节点视图:单击选中(显示尺寸手柄与工具条),双击打开灯箱,拖动右下角手柄按比例缩放(写成 Typora 的 zoom 写法)。
import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { type EditorEnv, localPathOf, openImageLightbox, resourceUrl } from '../core/env'
import { ICONS, h, svgIcon } from '../ui/dom'

const ZOOM_PRESETS = ['25%', '33%', '50%', '67%', '75%', '100%']

export class ImageView implements NodeView {
  dom: HTMLSpanElement
  private img: HTMLImageElement
  private broken: HTMLSpanElement
  private toolbar: HTMLSpanElement

  constructor(
    private node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly env: EditorEnv,
  ) {
    this.img = h('img', { draggable: 'false' })
    this.broken = h('span', { class: 'tz-image-broken', hidden: true })
    const handle = h('span', { class: 'tz-image-handle', title: '拖动缩放', contenteditable: 'false' })
    this.toolbar = this.buildToolbar()
    this.dom = h('span', { class: 'tz-image' }, this.img, this.broken, handle, this.toolbar)

    this.dom.addEventListener('dblclick', (e) => {
      e.preventDefault()
      e.stopPropagation()
      openImageLightbox(this.view, this.env, { pos: this.getPos() })
    })
    this.img.addEventListener('error', () => {
      this.dom.classList.add('is-broken')
      this.broken.hidden = false
      this.broken.textContent = `图片无法加载:${this.node.attrs.src}`
    })
    this.img.addEventListener('load', () => {
      this.dom.classList.remove('is-broken')
      this.broken.hidden = true
    })
    this.bindResize(handle)
    this.render()
  }

  private render(): void {
    const a = this.node.attrs
    const url = resourceUrl(this.env, a.src)
    if (this.img.getAttribute('src') !== url) this.img.setAttribute('src', url)
    this.img.alt = a.alt ?? ''
    if (a.title) this.img.title = a.title
    else this.img.removeAttribute('title')
    this.img.style.removeProperty('zoom')
    this.img.removeAttribute('width')
    this.img.removeAttribute('height')
    // Typora 用 CSS zoom 表达缩放比例,WebKit 原生支持
    if (a.zoom) this.img.style.setProperty('zoom', a.zoom)
    if (a.width) this.img.setAttribute('width', a.width)
    if (a.height) this.img.setAttribute('height', a.height)
    this.dom.dataset.align = a.align ?? ''
    this.img.setAttribute('data-tz-src', a.src)
  }

  private setAttrs(patch: Record<string, unknown>): void {
    const pos = this.getPos()
    if (pos === undefined) return
    const tr = this.view.state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, ...patch })
    tr.setSelection(NodeSelection.create(tr.doc, pos))
    this.view.dispatch(tr)
  }

  private buildToolbar(): HTMLSpanElement {
    const btn = (label: string, title: string, onClick: () => void, icon?: string) =>
      h(
        'button',
        {
          class: 'tz-image-tool',
          title,
          type: 'button',
          onmousedown: ((e: Event) => e.preventDefault()) as EventListener,
          onclick: ((e: Event) => {
            e.preventDefault()
            e.stopPropagation()
            onClick()
          }) as EventListener,
        },
        icon ? svgIcon(icon, 14) : null,
        label,
      )
    const zoomSelect = h(
      'select',
      {
        class: 'tz-image-zoom',
        title: '缩放图片',
        onchange: ((e: Event) => {
          const v = (e.target as HTMLSelectElement).value
          this.setAttrs(v === 'reset' ? { zoom: null, width: null, height: null } : { zoom: v, html: true })
        }) as EventListener,
      },
      h('option', { value: '' }, '缩放'),
      ...ZOOM_PRESETS.map((z) => h('option', { value: z }, z)),
      h('option', { value: 'reset' }, '原始大小'),
    )
    return h(
      'span',
      { class: 'tz-image-toolbar', contenteditable: 'false' },
      btn('', '查看大图(双击图片)', () => openImageLightbox(this.view, this.env, { pos: this.getPos() }), ICONS.zoomIn),
      zoomSelect,
      btn('替代文字', '编辑替代文字', () => {
        const alt = window.prompt('图片替代文字', this.node.attrs.alt ?? '')
        if (alt !== null) this.setAttrs({ alt })
      }),
      btn('', '在 Finder 中显示', () => {
        const p = localPathOf(this.env, this.node.attrs.src)
        if (p) void this.env.host.revealInFinder(p)
      }, ICONS.finder),
      btn('', '复制图片', () => {
        const p = localPathOf(this.env, this.node.attrs.src)
        if (p) void this.env.host.copyImageToClipboard(p)
        else void navigator.clipboard.writeText(this.node.attrs.src)
      }, ICONS.copy),
    )
  }

  /** 拖动右下角手柄:实时改宽度,松手后换算成相对原图的百分比写入 zoom。 */
  private bindResize(handle: HTMLElement): void {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const natural = this.img.naturalWidth
      if (!natural) return
      const startX = e.clientX
      const startWidth = this.img.getBoundingClientRect().width
      handle.setPointerCapture(e.pointerId)
      this.dom.classList.add('is-resizing')
      const move = (ev: PointerEvent) => {
        const width = Math.max(24, startWidth + (ev.clientX - startX))
        this.img.style.setProperty('zoom', `${(width / natural) * 100}%`)
      }
      const up = (ev: PointerEvent) => {
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
        this.dom.classList.remove('is-resizing')
        const width = Math.max(24, startWidth + (ev.clientX - startX))
        const pct = Math.max(5, Math.round((width / natural) * 100))
        this.setAttrs(pct === 100 ? { zoom: null } : { zoom: `${pct}%`, html: true })
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', up)
    })
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null
    if (event.type === 'dblclick') return true
    return Boolean(target?.closest('.tz-image-toolbar, .tz-image-handle'))
  }

  ignoreMutation(): boolean {
    return true
  }
}
