// 文内查找与替换(⌘F / ⌥⌘F):大小写、全词、正则;⌘G / ⇧⌘G 跳下一个 / 上一个。
import type { Node as PMNode } from 'prosemirror-model'
import { type EditorState, Plugin, PluginKey, TextSelection, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import { registerCommand } from '../core/registry'
import { ICONS, h, svgIcon } from '../ui/dom'

export interface FindOptions {
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

interface FindState extends FindOptions {
  matches: { from: number; to: number }[]
  current: number
  error: string | null
}

export const findKey = new PluginKey<FindState>('tz-find')

const EMPTY: FindState = { query: '', caseSensitive: false, wholeWord: false, regex: false, matches: [], current: -1, error: null }

export function buildPattern(o: FindOptions): RegExp | null {
  if (!o.query) return null
  const source = o.regex ? o.query : o.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(o.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])` : source, `gu${o.caseSensitive ? '' : 'i'}`)
}

/** 在所有文本块里查找;行内原子节点按一个占位字符计,偏移与文档位置一一对应。 */
export function findMatches(doc: PMNode, o: FindOptions): { matches: { from: number; to: number }[]; error: string | null } {
  let re: RegExp | null
  try {
    re = buildPattern(o)
  } catch (err) {
    return { matches: [], error: err instanceof Error ? err.message : String(err) }
  }
  if (!re) return { matches: [], error: null }
  const matches: { from: number; to: number }[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    const text = node.textBetween(0, node.content.size, undefined, '\ufffc')
    re.lastIndex = 0
    for (const m of text.matchAll(re)) {
      if (m[0].length === 0) continue
      const from = pos + 1 + (m.index ?? 0)
      matches.push({ from, to: from + m[0].length })
      if (matches.length >= 10000) return false
    }
    return false
  })
  return { matches, error: null }
}

function nearest(matches: { from: number }[], pos: number): number {
  if (matches.length === 0) return -1
  const i = matches.findIndex((m) => m.from >= pos)
  return i < 0 ? 0 : i
}

export function findPlugin(): Plugin<FindState> {
  return new Plugin<FindState>({
    key: findKey,
    state: {
      init: () => EMPTY,
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(findKey) as Partial<FindState> | 'close' | undefined
        if (meta === 'close') return EMPTY
        if (meta || (tr.docChanged && prev.query)) {
          const next = { ...prev, ...(meta ?? {}) }
          const { matches, error } = findMatches(state.doc, next)
          const current = meta && 'current' in meta ? (meta.current ?? -1) : nearest(matches, state.selection.from)
          return { ...next, matches, error, current: Math.min(current, matches.length - 1) }
        }
        return prev
      },
    },
    props: {
      decorations(state) {
        const st = findKey.getState(state)
        if (!st || st.matches.length === 0) return null
        return DecorationSet.create(
          state.doc,
          st.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === st.current ? 'tz-find-match is-current' : 'tz-find-match' })),
        )
      },
    },
    view: (view) => new FindPanel(view),
  })
}

function go(view: EditorView, dir: 1 | -1): void {
  const st = findKey.getState(view.state)
  if (!st || st.matches.length === 0) return
  const current = (st.current + dir + st.matches.length) % st.matches.length
  const m = st.matches[current]
  view.dispatch(view.state.tr.setMeta(findKey, { current }).setSelection(TextSelection.create(view.state.doc, m.from, m.to)).scrollIntoView())
}

function replaceCurrent(view: EditorView, replacement: string): void {
  const st = findKey.getState(view.state)
  if (!st || st.current < 0) return
  const m = st.matches[st.current]
  const tr = view.state.tr.insertText(expand(st, view.state, m, replacement), m.from, m.to)
  view.dispatch(tr.setMeta(findKey, {}))
  go(view, 1)
}

function replaceAll(view: EditorView, replacement: string): number {
  const st = findKey.getState(view.state)
  if (!st || st.matches.length === 0) return 0
  let tr: Transaction = view.state.tr
  // 从后往前替换,前面的位置不受影响
  for (const m of [...st.matches].reverse()) tr = tr.insertText(expand(st, view.state, m, replacement), m.from, m.to)
  view.dispatch(tr.setMeta(findKey, {}))
  return st.matches.length
}

/** 正则模式下支持 $1 等分组引用。 */
function expand(st: FindState, state: EditorState, m: { from: number; to: number }, replacement: string): string {
  if (!st.regex) return replacement
  const re = buildPattern(st)
  const text = state.doc.textBetween(m.from, m.to, undefined, '\ufffc')
  return re ? text.replace(new RegExp(re.source, re.flags.replace('g', '')), replacement) : replacement
}

class FindPanel {
  private readonly el: HTMLDivElement
  private readonly input: HTMLInputElement
  private readonly replace: HTMLInputElement
  private readonly count: HTMLSpanElement
  private readonly toggles: Record<'caseSensitive' | 'wholeWord' | 'regex', HTMLButtonElement>

  constructor(private readonly view: EditorView) {
    this.input = h('input', { class: 'tz-find-input', placeholder: '查找', spellcheck: 'false' })
    this.replace = h('input', { class: 'tz-find-input', placeholder: '替换为', spellcheck: 'false' })
    this.count = h('span', { class: 'tz-find-count' })
    const toggle = (key: keyof FindPanel['toggles'], label: string, title: string) => {
      const b = h('button', { type: 'button', class: 'tz-find-toggle', title }, label)
      b.addEventListener('click', () => {
        const st = findKey.getState(this.view.state) ?? EMPTY
        this.view.dispatch(this.view.state.tr.setMeta(findKey, { [key]: !st[key] }))
      })
      return b
    }
    this.toggles = {
      caseSensitive: toggle('caseSensitive', 'Aa', '区分大小写'),
      wholeWord: toggle('wholeWord', 'ab', '全词匹配'),
      regex: toggle('regex', '.*', '正则表达式'),
    }
    const btn = (icon: string, title: string, run: () => void) => {
      const b = h('button', { type: 'button', class: 'tz-find-btn', title }, svgIcon(icon, 14))
      b.addEventListener('click', run)
      return b
    }
    const replaceOne = h('button', { type: 'button', class: 'tz-find-action' }, '替换')
    replaceOne.addEventListener('click', () => replaceCurrent(this.view, this.replace.value))
    const replaceAllBtn = h('button', { type: 'button', class: 'tz-find-action' }, '全部替换')
    replaceAllBtn.addEventListener('click', () => replaceAll(this.view, this.replace.value))
    this.el = h(
      'div',
      { class: 'tz-find', hidden: true },
      h(
        'div',
        { class: 'tz-find-row' },
        this.input,
        this.toggles.caseSensitive,
        this.toggles.wholeWord,
        this.toggles.regex,
        this.count,
        btn(ICONS.prev, '上一个(⇧⌘G)', () => go(this.view, -1)),
        btn(ICONS.next, '下一个(⌘G)', () => go(this.view, 1)),
        btn(ICONS.close, '关闭(Esc)', () => this.close()),
      ),
      h('div', { class: 'tz-find-row tz-find-replace' }, this.replace, replaceOne, replaceAllBtn),
    )
    ;(view.dom.parentElement ?? document.body).append(this.el)

    this.input.addEventListener('input', () => this.view.dispatch(this.view.state.tr.setMeta(findKey, { query: this.input.value })))
    const keys = (e: KeyboardEvent, field: 'find' | 'replace') => {
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        this.close()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (field === 'replace') replaceCurrent(this.view, this.replace.value)
        else go(this.view, e.shiftKey ? -1 : 1)
      }
    }
    this.input.addEventListener('keydown', (e) => keys(e, 'find'))
    this.replace.addEventListener('keydown', (e) => keys(e, 'replace'))

    registerCommand({ id: 'find.open', label: '查找', run: () => (this.open(false), true) })
    registerCommand({ id: 'find.replace', label: '查找和替换', run: () => (this.open(true), true) })
    registerCommand({ id: 'find.next', label: '查找下一个', run: (v) => (go(v, 1), true) })
    registerCommand({ id: 'find.prev', label: '查找上一个', run: (v) => (go(v, -1), true) })
    registerCommand({ id: 'find.replaceNext', label: '替换下一个', run: (v) => (replaceCurrent(v, this.replace.value), true) })
  }

  open(withReplace: boolean): void {
    this.el.hidden = false
    this.el.classList.toggle('with-replace', withReplace)
    const { from, to } = this.view.state.selection
    const selected = this.view.state.doc.textBetween(from, to)
    if (selected && !selected.includes('\n')) this.input.value = selected
    this.view.dispatch(this.view.state.tr.setMeta(findKey, { query: this.input.value }))
    this.input.focus()
    this.input.select()
  }

  close(): void {
    this.el.hidden = true
    this.view.dispatch(this.view.state.tr.setMeta(findKey, 'close'))
    this.view.focus()
  }

  update(view: EditorView): void {
    const st = findKey.getState(view.state) ?? EMPTY
    for (const [k, b] of Object.entries(this.toggles)) b.classList.toggle('is-on', Boolean(st[k as keyof FindPanel['toggles']]))
    this.count.textContent = st.error ? '正则有误' : st.query ? `${st.matches.length ? st.current + 1 : 0}/${st.matches.length}` : ''
    this.count.classList.toggle('is-error', Boolean(st.error) || (Boolean(st.query) && st.matches.length === 0))
  }

  destroy(): void {
    this.el.remove()
  }
}
