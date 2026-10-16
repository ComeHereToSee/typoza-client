// 大文档视口裁剪(PRD 质量要求:5MB 文档输入 p95 ≤16ms、首屏 ≤1.5 秒)。
// 顶层块很多时,离视口较远的块加节点装饰类 tz-vp-off(display:none,不参与排版),外层容器用上下内边距补足它们的高度,
// 每次按键与滚动只排版视口附近的一百来个块。
// - 不用 :nth-child 之类的位置选择器:WebKit 里插入一个子元素就要给后面所有兄弟重算序号,两万个块时是平方级;
// - 窗口放在插件状态里随事务计算:光标跳进隐藏区时,目标块在 ProseMirror 写 DOM 选区之前就已显示
//   (放进不排版元素的选区会被 WebKit 丢掉,之后 ProseMirror 也不再同步)。
// 打印与导出不受影响:隐藏规则只在屏幕上、且要求外层容器带 tz-vp 类。
import type { Node as PMNode } from 'prosemirror-model'
import { type EditorState, Plugin, PluginKey, Selection, TextSelection, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'

/** 顶层块达到这个数才启用(普通文档不受影响) */
export const VIEWPORT_MIN_BLOCKS = 1500
/** 视口上下各多留的高度(按视口高度的倍数),快速滚动时不露白 */
const MARGIN_SCREENS = 1.5
/** 视口离窗口边缘不到这个倍数时才移动窗口(移动要重建装饰,别每帧都动) */
const SLACK_SCREENS = 0.5
/** 启用时先显示的块数(还没量过高度) */
const INITIAL_BLOCKS = 120

const HOST_CLASS = 'tz-vp'
const OFF_CLASS = 'tz-vp-off'

interface Window {
  /** 可见的顶层块下标区间 [from, to) */
  from: number
  to: number
}

interface ViewportState extends Window {
  active: boolean
  decos: DecorationSet
}

const key = new PluginKey<ViewportState>('tz-viewport')
const INACTIVE: ViewportState = { active: false, from: 0, to: 0, decos: DecorationSet.empty }

/** 位置所在的顶层块下标。 */
function topIndex(doc: PMNode, pos: number): number {
  return doc.resolve(Math.max(0, Math.min(pos, doc.content.size))).index(0)
}

function offDeco(offset: number, node: PMNode): Decoration {
  return Decoration.node(offset, offset + node.nodeSize, { class: OFF_CLASS })
}

/** 窗口外的块(光标所在块除外,滚走后也要能输入)加隐藏类。 */
function buildDecos(doc: PMNode, win: Window, head: number): DecorationSet {
  const decos: Decoration[] = []
  doc.forEach((node, offset, i) => {
    if ((i < win.from || i >= win.to) && i !== head) decos.push(offDeco(offset, node))
  })
  return DecorationSet.create(doc, decos)
}

function around(doc: PMNode, index: number): Window {
  return { from: Math.max(0, index - 40), to: Math.min(doc.childCount, index + 80) }
}

/** 文档改动后的窗口:改动在窗口前则平移,在窗口内则伸缩;新插入的块在窗口外的,补上隐藏装饰。 */
function mapState(prev: ViewportState, tr: Transaction, oldDoc: PMNode): ViewportState {
  const doc = tr.doc
  let decos = prev.decos.map(tr.mapping, doc)
  let { from, to } = prev
  const delta = doc.childCount - oldDoc.childCount
  if (delta !== 0) {
    const diff = oldDoc.content.findDiffStart(doc.content)
    const at = diff === null ? doc.childCount : topIndex(doc, diff)
    if (at < from) {
      from = Math.max(0, from + delta)
      to = Math.max(from + 1, to + delta)
    } else if (at <= to) {
      to = Math.max(from + 1, to + delta)
    } else if (delta > 0) {
      // 追加在窗口之后(分段载入、在远处粘贴):新块默认隐藏
      const extra: Decoration[] = []
      doc.forEach((node, offset, i) => {
        if (i >= at && i < at + delta) extra.push(offDeco(offset, node))
      })
      decos = decos.add(doc, extra)
    }
  }
  from = Math.min(from, doc.childCount - 1)
  return { active: true, from, to: Math.min(Math.max(to, from + 1), doc.childCount), decos }
}

function activate(state: EditorState): ViewportState {
  const head = topIndex(state.doc, state.selection.head)
  const win: Window = head < INITIAL_BLOCKS ? { from: 0, to: Math.min(state.doc.childCount, INITIAL_BLOCKS) } : around(state.doc, head)
  return { active: true, ...win, decos: buildDecos(state.doc, win, head) }
}

const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|[oa]d)/.test(navigator.platform)

/** ⌘↑ / ⌘↓(其它平台 Ctrl+Home / Ctrl+End)跳到文首 / 文末,带 ⇧ 时扩选;返回方向,不是这组键时为 0。 */
function docEdgeKey(e: KeyboardEvent): -1 | 0 | 1 {
  if (e.altKey) return 0
  if (isMac) {
    if (!e.metaKey || e.ctrlKey) return 0
    return e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
  }
  if (!e.ctrlKey || e.metaKey) return 0
  return e.key === 'Home' ? -1 : e.key === 'End' ? 1 : 0
}

export function viewportPlugin(): Plugin<ViewportState> {
  return new Plugin<ViewportState>({
    key,
    state: {
      init: (_config, state) => (state.doc.childCount >= VIEWPORT_MIN_BLOCKS ? activate(state) : INACTIVE),
      apply(tr, prev, oldState, newState) {
        const doc = newState.doc
        if (doc.childCount < VIEWPORT_MIN_BLOCKS) return prev.active ? INACTIVE : prev
        if (!prev.active) return activate(newState)
        const head = topIndex(doc, newState.selection.head)
        const meta = tr.getMeta(key) as Window | undefined
        if (meta) return { active: true, ...meta, decos: buildDecos(doc, meta, head) }
        let next = tr.docChanged ? mapState(prev, tr, oldState.doc) : prev
        // 光标移动或输入后,光标所在块必须在窗口里(跳转、全选、查找定位后要能显示光标、滚到光标);
        // 只有界面元信息的事务不动窗口,免得用户滚走后视口被拉回
        if ((tr.docChanged || tr.selectionSet) && (head < next.from || head >= next.to)) {
          const win = around(doc, head)
          next = { active: true, ...win, decos: buildDecos(doc, win, head) }
        }
        return next
      },
    },
    view: (view) => new Viewport(view),
    props: {
      decorations: (state) => key.getState(state)?.decos ?? null,
      // 隐藏的块里放不进原生光标,文首 / 文末跳转按文档位置处理
      handleKeyDown(view, event) {
        if (!key.getState(view.state)?.active) return false
        const dir = docEdgeKey(event)
        if (dir === 0) return false
        const { doc, selection } = view.state
        const edge = dir < 0 ? Selection.atStart(doc) : Selection.atEnd(doc)
        const next = event.shiftKey ? TextSelection.between(selection.$anchor, edge.$head) : edge
        view.dispatch(view.state.tr.setSelection(next).scrollIntoView())
        return true
      },
    },
  })
}

class Viewport {
  private readonly host: HTMLElement
  private readonly scroller: HTMLElement
  /** 量过的块高(含与下一块之间的间距),按节点对象记:没改动的块对象不变 */
  private readonly measured = new WeakMap<PMNode, number>()
  private heights: Float64Array = new Float64Array(0)
  private heightsCount = -1
  private shown: Window & { count: number } = { from: -1, to: -1, count: -1 }
  private frame = 0
  private readonly onScroll = () => this.schedule()
  private readonly resize = new ResizeObserver(() => this.schedule(true))
  private lastWidth = 0

  constructor(private readonly view: EditorView) {
    this.host = view.dom.parentElement ?? document.body
    this.scroller = (view.dom.closest('.tz-scroll') as HTMLElement | null) ?? document.documentElement
    this.scroller.addEventListener('scroll', this.onScroll, { passive: true })
    this.resize.observe(view.dom)
    this.update(view)
  }

  update(view: EditorView): void {
    const st = key.getState(view.state) ?? INACTIVE
    if (!st.active) {
      if (this.shown.count >= 0) this.deactivate()
      return
    }
    const doc = view.state.doc
    if (st.from === this.shown.from && st.to === this.shown.to && doc.childCount === this.shown.count) return
    this.host.classList.add(HOST_CLASS)
    if (this.heightsCount !== doc.childCount) this.rebuildHeights(doc)
    this.host.style.paddingTop = `${Math.round(this.sum(0, st.from))}px`
    this.host.style.paddingBottom = `${Math.round(this.sum(st.to, this.heights.length))}px`
    this.shown = { from: st.from, to: st.to, count: doc.childCount }
    this.schedule()
  }

  destroy(): void {
    cancelAnimationFrame(this.frame)
    this.scroller.removeEventListener('scroll', this.onScroll)
    this.resize.disconnect()
    this.deactivate()
  }

  private deactivate(): void {
    this.shown = { from: -1, to: -1, count: -1 }
    this.host.classList.remove(HOST_CLASS)
    this.host.style.removeProperty('padding-top')
    this.host.style.removeProperty('padding-bottom')
  }

  /** 按节点估高:还没显示过的块用字数、类型粗算(行宽按编辑区宽度)。 */
  private estimate(node: PMNode, font: number, width: number): number {
    const line = font * 1.75
    const perLine = Math.max(10, width / (font * 0.75))
    const lines = (text: string) => Math.max(1, Math.ceil(text.length / perLine))
    switch (node.type.name) {
      case 'heading':
        return line * 1.6 + 24
      case 'code_block':
        return (node.textContent.split('\n').length + 1) * font * 1.6 + 32
      case 'table':
        return node.childCount * (line + 14) + 16
      case 'bullet_list':
      case 'ordered_list': {
        let h = 16
        node.forEach((item) => (h += lines(item.textContent) * line))
        return h
      }
      case 'horizontal_rule':
        return 32
      default:
        return lines(node.textContent) * line + 16
    }
  }

  private rebuildHeights(doc: PMNode): void {
    const heights = new Float64Array(doc.childCount)
    const width = Math.max(200, this.view.dom.clientWidth || 700)
    const font = Number.parseFloat(getComputedStyle(this.view.dom).fontSize) || 16
    doc.forEach((node, _offset, i) => {
      heights[i] = this.measured.get(node) ?? this.estimate(node, font, width)
    })
    this.heights = heights
    this.heightsCount = doc.childCount
  }

  private sum(from: number, to: number): number {
    let s = 0
    for (let i = from; i < to; i++) s += this.heights[i]
    return s
  }

  private schedule(resized = false): void {
    if (this.shown.count < 0) return
    if (resized) {
      const width = this.view.dom.clientWidth
      if (width === this.lastWidth) return
      this.lastWidth = width
    }
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => this.refresh())
  }

  /** 量可见块的实际高度,视口接近窗口边缘时把窗口移到视口附近;保持视口里第一块的位置不跳。 */
  private refresh(): void {
    const st = key.getState(this.view.state)
    if (!st?.active || this.view.isDestroyed) return
    const doc = this.view.state.doc
    if (this.heightsCount !== doc.childCount) this.rebuildHeights(doc)
    // 量:相邻两块顶边之差即该块连同间距的高度
    let pos = 0
    for (let k = 0; k < st.from; k++) pos += doc.child(k).nodeSize
    let prevTop: number | null = null
    let prevIndex = -1
    let anchor: { index: number; top: number } | null = null
    const viewTop = this.scroller.getBoundingClientRect().top
    for (let i = st.from; i < st.to; i++) {
      const node = doc.child(i)
      const el = this.view.nodeDOM(pos)
      pos += node.nodeSize
      if (!(el instanceof HTMLElement)) continue
      const top = el.getBoundingClientRect().top
      if (prevTop !== null && prevIndex >= 0 && top > prevTop) {
        this.heights[prevIndex] = top - prevTop
        this.measured.set(doc.child(prevIndex), top - prevTop)
      }
      if (anchor === null && top >= viewTop) anchor = { index: i, top }
      prevTop = top
      prevIndex = i
    }
    // 视口在内容里的位置(按累计高度换算成块下标)
    const hostTop = this.host.getBoundingClientRect().top - viewTop + this.scroller.scrollTop
    const screen = this.scroller.clientHeight
    const viewY0 = this.scroller.scrollTop - hostTop
    const viewY1 = viewY0 + screen
    const winY0 = this.sum(0, st.from)
    const winY1 = winY0 + this.sum(st.from, st.to)
    // 视口离窗口边缘还远就不动(移动要重建装饰)
    const slack = screen * SLACK_SCREENS
    if (viewY0 - winY0 >= slack && winY1 - viewY1 >= slack) return
    const indexAt = (y: number) => {
      let acc = 0
      let i = 0
      while (i < this.heights.length - 1 && acc + this.heights[i] < y) acc += this.heights[i++]
      return i
    }
    const from = indexAt(Math.max(0, viewY0 - screen * MARGIN_SCREENS))
    const to = Math.min(this.heights.length, indexAt(viewY1 + screen * MARGIN_SCREENS) + 1)
    if (from === st.from && to === st.to) return
    this.view.dispatch(this.view.state.tr.setMeta(key, { from, to }).setMeta('addToHistory', false))
    // 原来视口里第一块若仍可见,把它放回原来的屏幕位置(上方块的估高换成实测值时不跳)
    if (anchor && anchor.index >= from && anchor.index < to) {
      let p = 0
      for (let k = 0; k < anchor.index; k++) p += doc.child(k).nodeSize
      const el = this.view.nodeDOM(p)
      if (el instanceof HTMLElement) this.scroller.scrollTop += el.getBoundingClientRect().top - anchor.top
    }
  }
}
