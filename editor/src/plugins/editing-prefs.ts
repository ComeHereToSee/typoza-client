// 偏好「编辑器」页里的两个输入行为:无选区时复制 / 剪切整行(PE-06)、匹配 Markdown 字符(PE-03)。默认都关。
import { Plugin, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import type { EditorEnv } from '../core/env'

/** 无选区时 ⌘C / ⌘X 作用于光标所在的整个块(Typora「无选区时复制或剪切整行」)。 */
export function copyLinePlugin(env: EditorEnv): Plugin {
  const handle = (view: EditorView, event: ClipboardEvent, cut: boolean): boolean => {
    const { state } = view
    if (!env.settings.copyLineWithoutSelection || !state.selection.empty || !event.clipboardData) return false
    const { $from } = state.selection
    if (!$from.parent.isTextblock || $from.depth === 0) return false
    const start = $from.before()
    const end = $from.after()
    const { dom, text } = view.serializeForClipboard(state.doc.slice(start, end))
    event.preventDefault()
    event.clipboardData.clearData()
    event.clipboardData.setData('text/html', dom.innerHTML)
    event.clipboardData.setData('text/plain', text)
    if (cut) {
      // 容器里只剩这一块时只清空文字,否则整块删掉(容器至少要有一个块)
      const tr = $from.node(-1).childCount > 1 ? state.tr.delete(start, end) : state.tr.delete($from.start(), $from.end())
      view.dispatch(tr.scrollIntoView().setMeta('uiEvent', 'cut'))
    }
    return true
  }
  return new Plugin({
    props: {
      handleDOMEvents: {
        copy: (view, event) => handle(view, event, false),
        cut: (view, event) => handle(view, event, true),
      },
    },
  })
}

const MD_PAIRS = new Set(['*', '_', '~'])
const WORD = /[\p{L}\p{N}]/u

/**
 * 匹配 Markdown 字符(Typora PE-03):敲 * _ ~ 时补上成对的另一半,光标放中间。
 * 要排在输入规则前面:敲收尾符号时先删掉补出来的那一半,再交给输入规则把 *文字* 转成格式。
 * 不做反引号:与 ``` 回车建代码块冲突。
 */
export function markdownPairsPlugin(env: EditorEnv): Plugin {
  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        if (!env.settings.autoPairMarkdown || from !== to || text.length !== 1) return false
        const { state } = view
        const $from = state.doc.resolve(from)
        const parent = $from.parent
        if (parent.type.spec.code || $from.marks().some((m) => m.type.spec.code)) return false
        const offset = $from.parentOffset
        const charAt = (i: number) => (i >= 0 && i < parent.content.size ? parent.textBetween(i, i + 1, undefined, '\u{FFFC}') : '')
        const prev = charAt(offset - 1)
        const prevPrev = charAt(offset - 2)
        const next = charAt(offset)
        const emptyPair = MD_PAIRS.has(prev) && next === prev && !WORD.test(prevPrev) && prevPrev !== prev
        // 空的一对里敲空格(如 * 后敲空格建列表):去掉补出来的那一半,交给输入规则
        if (text === ' ' && emptyPair) {
          view.dispatch(state.tr.delete(from, from + 1))
          return false
        }
        if (!MD_PAIRS.has(text)) return false
        if (next === text) {
          if (prev === text && emptyPair) {
            // *|* 里再敲 * → **|**
            const tr = state.tr.insertText(text + text, from)
            view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 1)))
            return true
          }
          // 收尾:删掉补出来的那一半,让输入规则照常把 *文字* 转成格式
          view.dispatch(state.tr.delete(from, from + 1))
          return false
        }
        if (WORD.test(prev)) return false
        const tr = state.tr.insertText(text + text, from)
        view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 1)))
        return true
      },
    },
  })
}
