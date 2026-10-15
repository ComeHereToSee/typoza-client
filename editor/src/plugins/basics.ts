// 基础插件:占位提示、编辑态标记(公式 / HTML / 图表块显示源码)、目录刷新、专注与打字机模式、括号自动配对。
import { type EditorState, Plugin, PluginKey, TextSelection } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import { blockAt } from '../core/blocks'
import type { EditorEnv } from '../core/env'
import { schema } from '../core/schema'
import { refreshTocs } from '../views/blocks'
import { isDiagramLanguage } from '../views/diagram'

const n = schema.nodes

// ---------- 占位提示 ----------

const HEADING_PLACEHOLDER = ['', '一级标题', '二级标题', '三级标题', '四级标题', '五级标题', '六级标题']

export function placeholderPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const { $from, empty } = state.selection
        const decos: Decoration[] = []
        const doc = state.doc
        // 整篇为空时首段提示
        if (doc.childCount === 1 && doc.firstChild?.type === n.paragraph && doc.firstChild.content.size === 0) {
          decos.push(Decoration.node(0, doc.firstChild.nodeSize, { class: 'tz-placeholder', 'data-placeholder': '开始书写,或输入「/」插入块…' }))
          return DecorationSet.create(doc, decos)
        }
        if (!empty) return null
        const parent = $from.parent
        if (parent.content.size !== 0) return null
        let text = ''
        if (parent.type === n.paragraph) text = '输入「/」唤出命令'
        else if (parent.type === n.heading) text = HEADING_PLACEHOLDER[parent.attrs.level]
        else if (parent.type === n.toggle_summary) text = '折叠标题'
        if (!text) return null
        const pos = $from.before()
        decos.push(Decoration.node(pos, pos + parent.nodeSize, { class: 'tz-placeholder', 'data-placeholder': text }))
        return DecorationSet.create(doc, decos)
      },
    },
  })
}

// ---------- 编辑态:光标所在的公式块 / HTML 块 / 图表代码块显示源码 ----------

export function editingPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const { $from } = state.selection
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d)
          const editable =
            node.type === n.math_block || node.type === n.html_block || (node.type === n.code_block && isDiagramLanguage(node.attrs.language))
          if (editable) {
            const pos = $from.before(d)
            return DecorationSet.create(state.doc, [Decoration.node(pos, pos + node.nodeSize, { class: 'is-editing' })])
          }
        }
        return null
      },
    },
  })
}

// ---------- 目录刷新 ----------

export function tocRefreshPlugin(): Plugin {
  let timer = 0
  return new Plugin({
    view: () => ({
      update(view, prev) {
        if (view.state.doc.eq(prev.doc)) return
        clearTimeout(timer)
        timer = window.setTimeout(refreshTocs, 200)
      },
      destroy() {
        clearTimeout(timer)
      },
    }),
  })
}

// ---------- 专注模式与打字机模式 ----------

export interface ViewModes {
  focus: boolean
  typewriter: boolean
}

export const viewModesKey = new PluginKey<ViewModes>('tz-view-modes')

export function setViewModes(view: EditorView, modes: Partial<ViewModes>): void {
  view.dispatch(view.state.tr.setMeta(viewModesKey, modes).setMeta('addToHistory', false))
}

export function viewModesPlugin(): Plugin<ViewModes> {
  return new Plugin<ViewModes>({
    key: viewModesKey,
    state: {
      init: () => ({ focus: false, typewriter: false }),
      apply: (tr, prev) => {
        const meta = tr.getMeta(viewModesKey) as Partial<ViewModes> | undefined
        return meta ? { ...prev, ...meta } : prev
      },
    },
    props: {
      attributes(state): Record<string, string> {
        const modes = viewModesKey.getState(state)
        const cls = [modes?.focus ? 'tz-focus-mode' : '', modes?.typewriter ? 'tz-typewriter-mode' : ''].filter(Boolean).join(' ')
        return cls ? { class: cls } : {}
      },
      decorations(state: EditorState) {
        // 专注模式:除光标所在块外其余变淡(Typora)
        if (!viewModesKey.getState(state)?.focus) return null
        const block = blockAt(state.selection.$from)
        if (!block) return null
        let top = block
        let $p = state.doc.resolve(block.pos)
        while ($p.depth > 0) {
          top = { node: $p.node($p.depth), pos: $p.before($p.depth), depth: $p.depth - 1 }
          $p = state.doc.resolve(top.pos)
        }
        return DecorationSet.create(state.doc, [Decoration.node(top.pos, top.pos + top.node.nodeSize, { class: 'tz-focused' })])
      },
    },
    view: () => ({
      update(view, prev) {
        // 打字机模式:光标所在行保持在可视区域中部
        const modes = viewModesKey.getState(view.state)
        if (!modes?.typewriter || view.state.selection.eq(prev.selection)) return
        const scroller = view.dom.closest('.tz-scroll') as HTMLElement | null
        if (!scroller) return
        const caret = view.coordsAtPos(view.state.selection.head)
        const box = scroller.getBoundingClientRect()
        const target = box.top + box.height * 0.45
        scroller.scrollBy({ top: caret.top - target, behavior: 'instant' as ScrollBehavior })
      },
    }),
  }) as Plugin<ViewModes>
}

// ---------- 括号与引号自动配对(Typora 偏好) ----------

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '“': '”', '‘': '’', '（': '）', '【': '】', '《': '》', '「': '」' }
const CLOSERS = new Set(Object.values(PAIRS))

export function autoPairPlugin(env: EditorEnv): Plugin {
  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        if (!env.settings.autoPair || text.length !== 1) return false
        const { state } = view
        const $from = state.doc.resolve(from)
        if ($from.parent.type.spec.code || $from.marks().some((m) => m.type.spec.code)) return false
        const next = $from.parent.textBetween($from.parentOffset, Math.min($from.parent.content.size, $from.parentOffset + 1), undefined, '\ufffc')
        // 敲收尾符号且后面正好是它:直接越过
        if (CLOSERS.has(text) && next === text && from === to) {
          view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from + 1)))
          return true
        }
        const close = PAIRS[text]
        if (!close) return false
        // 英文引号只在前一个字符不是字母数字时配对(避免 don't)
        const prev = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, undefined, '\ufffc')
        if ((text === "'" || text === '"') && /[\p{L}\p{N}]/u.test(prev)) return false
        if (next && /[\p{L}\p{N}]/u.test(next)) return false
        const selected = state.doc.textBetween(from, to)
        const tr = state.tr.insertText(text + selected + close, from, to)
        tr.setSelection(TextSelection.create(tr.doc, from + 1, from + 1 + selected.length))
        view.dispatch(tr)
        return true
      },
      handleKeyDown(view, event) {
        // 两个配对符号之间退格:一起删
        if (!env.settings.autoPair || event.key !== 'Backspace') return false
        const { state } = view
        const { $from, empty } = state.selection
        if (!empty || $from.parentOffset === 0) return false
        const prev = $from.parent.textBetween($from.parentOffset - 1, $from.parentOffset, undefined, '\ufffc')
        const next = $from.parent.textBetween($from.parentOffset, Math.min($from.parent.content.size, $from.parentOffset + 1), undefined, '\ufffc')
        if (PAIRS[prev] && PAIRS[prev] === next) {
          view.dispatch(state.tr.delete($from.pos - 1, $from.pos + 1))
          return true
        }
        return false
      },
    },
  })
}
