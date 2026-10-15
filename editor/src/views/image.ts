// 图片节点视图:单击选中(四角尺寸手柄 + 浮动工具条),双击打开灯箱。
// 尺寸存储按 PRD 3.4:拖手柄写宽度像素 <img width="480">,工具条选比例写 Typora 的 style="zoom:50%;"。
import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { type EditorEnv, localPathOf, openImageLightbox, resourceUrl } from '../core/env'
import { ZOOM_PRESETS, convertImageSyntax, deleteImage, imageSyntax, setImageAttrs, widthAttrs, zoomAttrs } from '../core/image-ops'
import { runCommand } from '../core/registry'
import { ICONS, h, svgIcon } from '../ui/dom'
import { promptInput } from '../ui/prompt'

type Corner = 'nw' | 'ne' | 'sw' | 'se'

/** 动图(PRD 3.5:GIF、APNG、动态 WebP)选中后工具条可暂停。 */
const ANIMATED = /\.(gif|apng|webp)(?:$|[?#])/i

// 「重新加载所有图片」(对照表 M-25):本机图片地址带上递增参数重新请求;网络图片不加参数(签名地址会失效)
let reloadToken = 0
const liveViews = new Set<ImageView>()

export function reloadAllImages(): number {
  reloadToken++
  for (const v of liveViews) v.reload()
  return liveViews.size
}

function withReloadToken(url: string): string {
  if (!reloadToken || !/^typoza:/i.test(url)) return url
  return `${url}${url.includes('?') ? '&' : '?'}tz-reload=${reloadToken}`
}

/** 页面缩放(偏好「缩放比例」以 CSS zoom 作用在页面容器上):指针位移换算回 CSS 像素。 */
function pageZoom(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tz-zoom')) || 1
}

export class ImageView implements NodeView {
  dom: HTMLSpanElement
  private img: HTMLImageElement
  private broken: HTMLSpanElement
  private toolbar: HTMLSpanElement
  private zoomSelect!: HTMLSelectElement
  private syntaxButton!: HTMLButtonElement
  private pauseButton!: HTMLButtonElement
  /** 动图暂停时盖在图片上的静止帧 */
  private still: HTMLCanvasElement | null = null

  constructor(
    private node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly env: EditorEnv,
  ) {
    this.img = h('img', { draggable: 'false' })
    this.broken = h('span', { class: 'tz-image-broken', hidden: true })
    const handles = (['nw', 'ne', 'sw', 'se'] as Corner[]).map((corner) => {
      const el = h('span', { class: `tz-image-handle tz-image-handle-${corner}`, title: '拖动调整宽度', contenteditable: 'false', 'data-corner': corner })
      this.bindResize(el, corner)
      return el
    })
    this.toolbar = this.buildToolbar()
    this.dom = h('span', { class: 'tz-image' }, this.img, this.broken, ...handles, this.toolbar)

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
    liveViews.add(this)
    this.render()
  }

  private render(): void {
    const a = this.node.attrs
    const url = withReloadToken(resourceUrl(this.env, a.src))
    if (this.img.getAttribute('src') !== url) {
      this.img.setAttribute('src', url)
      this.resume()
    }
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
    this.zoomSelect.value = a.zoom && ZOOM_PRESETS.includes(a.zoom) ? a.zoom : ''
    this.syntaxButton.textContent = imageSyntax(this.node) === 'html' ? '转为 Markdown' : '转为 HTML'
    this.pauseButton.hidden = !ANIMATED.test(a.src)
  }

  /** 「重新加载所有图片」 */
  reload(): void {
    this.render()
  }

  private pos(): number | null {
    const pos = this.getPos()
    return pos === undefined ? null : pos
  }

  private patch(attrs: Record<string, unknown>): void {
    const pos = this.pos()
    if (pos !== null) setImageAttrs(this.view, pos, attrs)
  }

  /** 工具条按钮先选中这张图,命令(替换图片等)作用于选中的图片。 */
  private selectSelf(): number | null {
    const pos = this.pos()
    if (pos === null) return null
    if (!(this.view.state.selection instanceof NodeSelection && this.view.state.selection.from === pos)) {
      this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)))
    }
    return pos
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
    this.zoomSelect = h(
      'select',
      {
        class: 'tz-image-zoom',
        title: '缩放比例',
        onchange: ((e: Event) => {
          const v = (e.target as HTMLSelectElement).value
          if (v) this.patch(zoomAttrs(v))
        }) as EventListener,
      },
      h('option', { value: '' }, '缩放'),
      ...ZOOM_PRESETS.map((z) => h('option', { value: z }, z)),
    )
    this.syntaxButton = btn('转为 HTML', '转换图片语法(Markdown / HTML)', () => {
      const pos = this.pos()
      if (pos === null) return
      const message = convertImageSyntax(this.view, pos, imageSyntax(this.node) === 'html' ? 'markdown' : 'html')
      if (message) this.env.actions.notify(message, true)
    })
    this.pauseButton = btn('暂停', '暂停 / 播放动图', () => this.togglePause())
    return h(
      'span',
      { class: 'tz-image-toolbar', contenteditable: 'false' },
      btn('', '查看大图(双击图片)', () => openImageLightbox(this.view, this.env, { pos: this.getPos() }), ICONS.zoomIn),
      this.pauseButton,
      btn('替代文字', '编辑替代文字', () => void this.editAlt()),
      this.zoomSelect,
      this.syntaxButton,
      btn('', '复制图片', () => {
        const src = this.node.attrs.src as string
        this.env.host.copyImageToClipboard(localPathOf(this.env, src) ?? resourceUrl(this.env, src)).catch((err: unknown) => this.fail('复制图片失败', err))
      }, ICONS.copy),
      btn('', '在 Finder 中显示', () => {
        const p = localPathOf(this.env, this.node.attrs.src)
        if (p) void this.env.host.revealInFinder(p)
        else this.env.actions.notify('网络图片没有本机位置')
      }, ICONS.finder),
      btn('替换', '用本机图片替换', () => {
        if (this.selectSelf() !== null) runCommand(this.view, 'image.replace')
      }),
      btn('', '删除图片', () => {
        const pos = this.pos()
        if (pos !== null) deleteImage(this.view, pos)
        this.view.focus()
      }, ICONS.trash),
    )
  }

  private async editAlt(): Promise<void> {
    const r = this.dom.getBoundingClientRect()
    const alt = await promptInput({ title: '替代文字', value: this.node.attrs.alt ?? '', anchor: { left: r.left, top: r.top, bottom: r.bottom } })
    if (alt !== null) this.patch({ alt })
    this.view.focus()
  }

  private fail(what: string, err: unknown): void {
    this.env.actions.notify(`${what}:${err instanceof Error ? err.message : String(err)}`, true)
  }

  /** 暂停:把当前图片画到画布上盖住动图(画布取的是动图的首帧);再点恢复播放。 */
  private togglePause(): void {
    if (this.still) {
      this.resume()
      return
    }
    const canvas = h('canvas', { class: 'tz-image-still' })
    canvas.width = this.img.naturalWidth || 1
    canvas.height = this.img.naturalHeight || 1
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      this.env.actions.notify('无法暂停动图:画布不可用', true)
      return
    }
    ctx.drawImage(this.img, 0, 0)
    this.still = canvas
    this.dom.insertBefore(canvas, this.broken)
    this.dom.classList.add('is-paused')
    this.pauseButton.textContent = '播放'
  }

  private resume(): void {
    this.still?.remove()
    this.still = null
    this.dom.classList.remove('is-paused')
    if (this.pauseButton) this.pauseButton.textContent = '暂停'
  }

  /** 四角手柄:实时改显示宽度,松手后写宽度像素。左侧两个手柄向左拖是放大。 */
  private bindResize(handle: HTMLElement, corner: Corner): void {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const zoom = pageZoom()
      const startX = e.clientX
      const startWidth = this.img.getBoundingClientRect().width / zoom
      if (!startWidth) return
      const container = this.dom.parentElement ?? this.view.dom
      const maxWidth = container.getBoundingClientRect().width / zoom
      const dir = corner === 'nw' || corner === 'sw' ? -1 : 1
      const widthAt = (x: number) => Math.round(Math.min(maxWidth, Math.max(24, startWidth + (dir * (x - startX)) / zoom)))
      handle.setPointerCapture(e.pointerId)
      this.dom.classList.add('is-resizing')
      const move = (ev: PointerEvent) => {
        this.img.style.removeProperty('zoom')
        this.img.style.width = `${widthAt(ev.clientX)}px`
      }
      const up = (ev: PointerEvent) => {
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
        handle.removeEventListener('pointercancel', up)
        this.dom.classList.remove('is-resizing')
        this.img.style.removeProperty('width')
        if (ev.type === 'pointercancel') {
          this.render()
          return
        }
        this.patch(widthAttrs(widthAt(ev.clientX)))
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', up)
      handle.addEventListener('pointercancel', up)
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

  destroy(): void {
    liveViews.delete(this)
  }
}
