// 图片灯箱:文档里双击任意图片打开(包括表格单元格里的、带链接的、HTML <img>、动图)。
// 交互:捏合 / Cmd+滚轮 以光标为中心缩放;拖动或双指滚动平移;双击在「适配窗口」与「100%」之间切换;
// ←/→ 浏览本文档全部图片;R 旋转;Cmd+C 复制;Esc 或点空白处关闭。
import { ICONS, clamp, h, svgIcon } from './dom'

export interface LightboxImage {
  /** 网页可加载的地址 */
  url: string
  alt: string
  /** 本机文件绝对路径(外部网址为 null),用于复制与在 Finder 中显示 */
  path: string | null
  /** 文档里写的原始地址 */
  src: string
  /** 文档里那张缩略图元素,用于打开/关闭动画 */
  element?: HTMLElement | null
}

export interface LightboxActions {
  reveal(path: string): void
  copy(image: LightboxImage): void
  openExternal(image: LightboxImage): void
}

// 缩放范围 10%~800%(docs/prd/typoza-prd.md 图片与灯箱)
const MIN_SCALE = 0.1
const MAX_SCALE = 8

interface ViewState {
  scale: number
  tx: number
  ty: number
  rotation: number
}

let current: Lightbox | null = null

export function isLightboxOpen(): boolean {
  return current !== null
}

export function openLightbox(images: LightboxImage[], index: number, actions: LightboxActions): void {
  current?.close(false)
  if (images.length === 0) return
  current = new Lightbox(images, clamp(index, 0, images.length - 1), actions)
}

export function closeLightbox(): void {
  current?.close(true)
}

class Lightbox {
  private readonly root: HTMLDivElement
  private readonly stage: HTMLDivElement
  private readonly img: HTMLImageElement
  /** 图片外框:位于舞台中心,打开动画作用在它上面(图片自身的 transform 用于缩放平移) */
  private readonly frame: HTMLDivElement
  private readonly counter: HTMLSpanElement
  private readonly caption: HTMLDivElement
  private readonly zoomLabel: HTMLSpanElement
  private readonly status: HTMLDivElement
  private natural = { w: 0, h: 0 }
  private view: ViewState = { scale: 1, tx: 0, ty: 0, rotation: 0 }
  private fitted = true
  private drag: { id: number; x: number; y: number; tx: number; ty: number; moved: boolean; onBlank: boolean } | null = null
  private gesture: { base: number; x: number; y: number } | null = null
  private lastPointer = { x: 0, y: 0 }
  private readonly previousFocus: Element | null
  private readonly onKey = (e: KeyboardEvent) => this.handleKey(e)
  private readonly onResize = () => {
    if (this.fitted) this.fit(false)
  }

  constructor(
    private readonly images: LightboxImage[],
    private index: number,
    private readonly actions: LightboxActions,
  ) {
    this.previousFocus = document.activeElement
    this.img = h('img', { class: 'tz-lb-img', draggable: 'false', alt: '' })
    this.counter = h('span', { class: 'tz-lb-counter' })
    this.zoomLabel = h('span', { class: 'tz-lb-zoom', title: '缩放比例(相对原图)' })
    this.caption = h('div', { class: 'tz-lb-caption' })
    this.status = h('div', { class: 'tz-lb-status' })
    this.frame = h('div', { class: 'tz-lb-frame' }, this.img)
    this.stage = h('div', { class: 'tz-lb-stage' }, this.frame, this.status)

    const button = (icon: string, title: string, onClick: () => void, cls = '') =>
      h(
        'button',
        {
          class: `tz-lb-btn ${cls}`,
          title,
          'aria-label': title,
          onclick: ((e: Event) => {
            e.stopPropagation()
            onClick()
          }) as EventListener,
        },
        svgIcon(icon, 18),
      )

    const toolbar = h(
      'div',
      { class: 'tz-lb-toolbar', onpointerdown: ((e: Event) => e.stopPropagation()) as EventListener },
      this.counter,
      button(ICONS.zoomOut, '缩小(-)', () => this.zoomBy(1 / 1.25)),
      this.zoomLabel,
      button(ICONS.zoomIn, '放大(+)', () => this.zoomBy(1.25)),
      button(ICONS.fit, '适配窗口(0)', () => this.fit(true)),
      button(ICONS.actual, '原始大小(1)', () => this.actualSize()),
      button(ICONS.rotate, '旋转(R)', () => this.rotate(90)),
      button(ICONS.copy, '复制图片(⌘C)', () => this.actions.copy(this.image)),
      button(ICONS.finder, '在 Finder 中显示', () => {
        if (this.image.path) this.actions.reveal(this.image.path)
      }, 'tz-lb-reveal'),
      button(ICONS.external, '用默认应用打开', () => this.actions.openExternal(this.image)),
      button(ICONS.close, '关闭(Esc)', () => this.close(true)),
    )

    const prev = button(ICONS.prev, '上一张(←)', () => this.go(-1), 'tz-lb-nav tz-lb-prev')
    const next = button(ICONS.next, '下一张(→)', () => this.go(1), 'tz-lb-nav tz-lb-next')

    this.root = h(
      'div',
      { class: 'tz-lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': '图片查看', tabindex: '-1' },
      this.stage,
      toolbar,
      prev,
      next,
      this.caption,
    )
    this.root.classList.toggle('tz-lb-single', images.length < 2)
    this.bindPointer()
    document.body.append(this.root)
    window.addEventListener('keydown', this.onKey, true)
    window.addEventListener('resize', this.onResize)
    this.root.focus()
    requestAnimationFrame(() => this.root.classList.add('is-open'))
    this.show(true)
  }

  private get image(): LightboxImage {
    return this.images[this.index]
  }

  private show(animate: boolean): void {
    const image = this.image
    this.counter.textContent = this.images.length > 1 ? `${this.index + 1} / ${this.images.length}` : ''
    this.caption.textContent = image.alt || image.src
    this.root.querySelector('.tz-lb-reveal')?.toggleAttribute('disabled', !image.path)
    this.status.textContent = '正在加载…'
    this.status.hidden = false
    this.img.hidden = true
    this.view.rotation = 0
    const url = image.url
    this.img.onload = () => {
      if (this.img.src !== url && this.img.getAttribute('src') !== url) return
      this.natural = { w: this.img.naturalWidth || 1, h: this.img.naturalHeight || 1 }
      this.status.hidden = true
      this.img.hidden = false
      this.fit(false)
      if (animate) this.animateFrom(image.element ?? null)
      this.preloadNeighbors()
    }
    this.img.onerror = () => {
      this.status.textContent = `图片加载失败:${image.src}`
      this.status.hidden = false
      this.img.hidden = true
    }
    this.img.src = url
  }

  private preloadNeighbors(): void {
    for (const d of [-1, 1]) {
      const n = this.images[(this.index + d + this.images.length) % this.images.length]
      if (n && n !== this.image) new Image().src = n.url
    }
  }

  /** 从文档里缩略图的位置放大展开(FLIP)。 */
  private animateFrom(el: HTMLElement | null): void {
    if (!el || !el.isConnected) return
    const from = el.getBoundingClientRect()
    const to = this.img.getBoundingClientRect()
    if (from.width === 0 || to.width === 0) return
    const dx = from.left + from.width / 2 - (to.left + to.width / 2)
    const dy = from.top + from.height / 2 - (to.top + to.height / 2)
    const s = from.width / to.width
    // 刚适配完时图片中心与外框原点重合,外框缩放即以图片中心为基准
    this.frame.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.6 },
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      ],
      { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' },
    )
  }

  private go(delta: number): void {
    if (this.images.length < 2) return
    this.index = (this.index + delta + this.images.length) % this.images.length
    this.show(false)
  }

  // ---------- 几何 ----------

  private stageSize(): { w: number; h: number } {
    const r = this.stage.getBoundingClientRect()
    return { w: r.width, h: r.height }
  }

  private rotatedNatural(): { w: number; h: number } {
    const quarter = Math.abs(this.view.rotation / 90) % 2 === 1
    return quarter ? { w: this.natural.h, h: this.natural.w } : this.natural
  }

  private fitScale(): number {
    const { w, h } = this.stageSize()
    const nat = this.rotatedNatural()
    // 小图不放大,按原始尺寸显示;大图缩到窗口内留白
    return Math.min(1, (w * 0.94) / nat.w, (h * 0.9) / nat.h)
  }

  private apply(smooth: boolean): void {
    const { scale, tx, ty, rotation } = this.view
    this.img.style.width = `${this.natural.w}px`
    this.img.style.height = `${this.natural.h}px`
    this.img.style.transition = smooth ? 'transform 160ms ease-out' : 'none'
    this.img.style.transform = `translate(-50%, -50%) translate(${tx}px, ${ty}px) rotate(${rotation}deg) scale(${scale})`
    this.zoomLabel.textContent = `${Math.round(scale * 100)}%`
    this.root.classList.toggle('is-zoomed', !this.fitted)
  }

  private fit(smooth: boolean): void {
    this.view.scale = this.fitScale()
    this.view.tx = 0
    this.view.ty = 0
    this.fitted = true
    this.apply(smooth)
  }

  private actualSize(at?: { x: number; y: number }): void {
    this.zoomTo(1, at, true)
  }

  /** 以屏幕点 at(默认舞台中心)为不动点缩放到 target。 */
  private zoomTo(target: number, at?: { x: number; y: number }, smooth = false): void {
    const s = this.view.scale
    const next = clamp(target, MIN_SCALE, MAX_SCALE)
    const rect = this.stage.getBoundingClientRect()
    const cx = (at ? at.x : rect.left + rect.width / 2) - (rect.left + rect.width / 2)
    const cy = (at ? at.y : rect.top + rect.height / 2) - (rect.top + rect.height / 2)
    const k = next / s
    this.view.tx = cx - (cx - this.view.tx) * k
    this.view.ty = cy - (cy - this.view.ty) * k
    this.view.scale = next
    this.fitted = Math.abs(next - this.fitScale()) < 1e-3 && this.view.tx === 0 && this.view.ty === 0
    this.apply(smooth)
  }

  private zoomBy(factor: number, at?: { x: number; y: number }): void {
    this.zoomTo(this.view.scale * factor, at, true)
  }

  private rotate(deg: number): void {
    this.view.rotation = (this.view.rotation + deg) % 360
    this.fit(true)
  }

  // ---------- 输入 ----------

  private bindPointer(): void {
    const stage = this.stage
    stage.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        this.lastPointer = { x: e.clientX, y: e.clientY }
        if (e.ctrlKey || e.metaKey) {
          // macOS 触控板捏合在 WebKit 里表现为带 ctrlKey 的滚轮事件
          if (this.gesture) return
          this.zoomTo(this.view.scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), { x: e.clientX, y: e.clientY })
          return
        }
        this.view.tx -= e.deltaX
        this.view.ty -= e.deltaY
        this.fitted = false
        this.apply(false)
      },
      { passive: false },
    )

    // Safari 的手势事件(捏合);有它时忽略带 ctrlKey 的滚轮,避免重复缩放
    const gestureStart = (e: Event) => {
      e.preventDefault()
      this.gesture = { base: this.view.scale, ...this.lastPointer }
    }
    const gestureChange = (e: Event) => {
      e.preventDefault()
      const scale = (e as Event & { scale?: number }).scale ?? 1
      if (this.gesture) this.zoomTo(this.gesture.base * scale, { x: this.gesture.x, y: this.gesture.y })
    }
    const gestureEnd = (e: Event) => {
      e.preventDefault()
      this.gesture = null
    }
    stage.addEventListener('gesturestart', gestureStart)
    stage.addEventListener('gesturechange', gestureChange)
    stage.addEventListener('gestureend', gestureEnd)

    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      this.lastPointer = { x: e.clientX, y: e.clientY }
      // 捕获指针后 pointerup 的 target 恒为舞台,所以「是否按在空白处」要在按下时记录
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tx: this.view.tx, ty: this.view.ty, moved: false, onBlank: e.target === stage }
      stage.setPointerCapture(e.pointerId)
    })
    stage.addEventListener('pointermove', (e) => {
      this.lastPointer = { x: e.clientX, y: e.clientY }
      const d = this.drag
      if (!d || d.id !== e.pointerId) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (!d.moved && Math.hypot(dx, dy) < 3) return
      d.moved = true
      this.root.classList.add('is-dragging')
      this.view.tx = d.tx + dx
      this.view.ty = d.ty + dy
      this.fitted = false
      this.apply(false)
    })
    const endDrag = (e: PointerEvent) => {
      const d = this.drag
      if (!d || d.id !== e.pointerId) return
      this.drag = null
      this.root.classList.remove('is-dragging')
      // 没拖动、点在图片外的空白处 → 关闭
      if (!d.moved && e.type === 'pointerup' && d.onBlank) this.close(true)
    }
    stage.addEventListener('pointerup', endDrag)
    stage.addEventListener('pointercancel', endDrag)

    this.img.addEventListener('dblclick', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const at = { x: e.clientX, y: e.clientY }
      if (this.fitted) {
        // 已适配:放大到 100%;若原图本来就不比窗口大,则放大到 2 倍
        const target = this.view.scale >= 0.999 ? 2 : 1
        this.zoomTo(target, at, true)
      } else {
        this.fit(true)
      }
    })
  }

  private handleKey(e: KeyboardEvent): void {
    // 灯箱打开期间吞掉所有按键,避免传到编辑器
    e.stopPropagation()
    const mod = e.metaKey || e.ctrlKey
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        this.close(true)
        return
      case 'ArrowLeft':
        e.preventDefault()
        this.go(-1)
        return
      case 'ArrowRight':
      case ' ':
        e.preventDefault()
        this.go(1)
        return
      case '+':
      case '=':
        e.preventDefault()
        this.zoomBy(1.25)
        return
      case '-':
      case '_':
        e.preventDefault()
        this.zoomBy(1 / 1.25)
        return
      case '0':
        e.preventDefault()
        this.fit(true)
        return
      case '1':
        e.preventDefault()
        this.actualSize()
        return
      case 'r':
      case 'R':
        if (mod) return
        e.preventDefault()
        this.rotate(e.shiftKey ? -90 : 90)
        return
      case 'c':
      case 'C':
        if (mod) {
          e.preventDefault()
          this.actions.copy(this.image)
        }
        return
      default:
        if (mod && e.key === 'w') {
          e.preventDefault()
          this.close(true)
        }
    }
  }

  close(restoreFocus: boolean): void {
    if (current === this) current = null
    window.removeEventListener('keydown', this.onKey, true)
    window.removeEventListener('resize', this.onResize)
    this.root.classList.remove('is-open')
    this.root.classList.add('is-closing')
    const remove = () => this.root.remove()
    this.root.addEventListener('transitionend', remove, { once: true })
    setTimeout(remove, 250)
    if (restoreFocus && this.previousFocus instanceof HTMLElement) this.previousFocus.focus({ preventScroll: true })
  }
}
