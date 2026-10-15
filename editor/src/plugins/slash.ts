// Notion 斜杠菜单:行首或空格后敲 / 弹出块菜单,继续输入即过滤(支持中文、英文、拼音缩写);
// 敲 [[ 弹出文档选择,插入指向该文档的相对链接。
import { Plugin, PluginKey } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import type { EditorEnv } from '../core/env'
import { FloatingMenu, type MenuItem } from '../ui/menu'
import { slashItems } from './items'

interface SlashState {
  active: boolean
  /** / 字符所在位置 */
  from: number
}

export const slashKey = new PluginKey<SlashState>('tz-slash')

/** 在当前位置打开斜杠菜单(块手柄的 + 按钮也用它)。 */
export function openSlashMenu(view: EditorView): void {
  const { from, to } = view.state.selection
  view.dispatch(view.state.tr.insertText('/', from, to).setMeta(slashKey, { open: from }))
  view.focus()
}

export function slashPlugin(env: EditorEnv): Plugin<SlashState> {
  let menu: FloatingMenu | null = null

  const wrap = (view: EditorView, items: MenuItem[]): MenuItem[] =>
    items.map((item) => ({
      ...item,
      run: () => {
        // 先删掉「/查询词」,再执行条目
        const st = slashKey.getState(view.state)
        if (st?.active) {
          const end = Math.max(st.from + 1, view.state.selection.from)
          view.dispatch(view.state.tr.delete(st.from, end).setMeta(slashKey, { close: true }))
        }
        item.run?.()
      },
    }))

  return new Plugin<SlashState>({
    key: slashKey,
    state: {
      init: () => ({ active: false, from: 0 }),
      apply(tr, prev) {
        const meta = tr.getMeta(slashKey) as { open?: number; close?: boolean } | undefined
        if (meta?.open !== undefined) return { active: true, from: meta.open }
        if (meta?.close) return { active: false, from: 0 }
        if (!prev.active) return prev
        const from = tr.mapping.map(prev.from)
        const sel = tr.selection
        const stillSlash = from < tr.doc.content.size && tr.doc.textBetween(from, from + 1) === '/'
        if (!stillSlash || !sel.empty || sel.from <= from || !tr.doc.resolve(from).sameParent(sel.$from)) {
          return { active: false, from: 0 }
        }
        return { active: true, from }
      },
    },
    props: {
      handleTextInput(view, from, to, text) {
        const $from = view.state.doc.resolve(from)
        if ($from.parent.type.spec.code) return false
        const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, undefined, '\ufffc')
        if (text === '/') {
          // Notion:只在块开头或空白后触发,网址、路径里的 / 不触发
          if (before && !/\s/.test(before)) return false
          view.dispatch(view.state.tr.insertText('/', from, to).setMeta(slashKey, { open: from }))
          return true
        }
        if (text === '[' && before === '[') {
          // 自动配对插入的 ] 一并删掉
          const after = $from.parent.textBetween($from.parentOffset, Math.min($from.parent.content.size, $from.parentOffset + 1), undefined, '\ufffc')
          view.dispatch(view.state.tr.delete(from - 1, after === ']' ? to + 1 : to))
          env.actions.insertDocLink(view)
          return true
        }
        return false
      },
      handleKeyDown(_view, event) {
        if (!menu?.isOpen) return false
        if (menu.handleKey(event)) {
          event.preventDefault()
          return true
        }
        return false
      },
    },
    view(editorView) {
      const m = new FloatingMenu({
        className: 'tz-slash-menu',
        emptyText: '没有匹配的块',
        onClose: (reason) => {
          if (reason !== 'select' && slashKey.getState(editorView.state)?.active) {
            editorView.dispatch(editorView.state.tr.setMeta(slashKey, { close: true }))
          }
        },
      })
      menu = m
      return {
        update(view) {
          const st = slashKey.getState(view.state)
          if (!st?.active) {
            if (m.isOpen) m.close('api')
            return
          }
          const query = view.state.doc.textBetween(st.from + 1, view.state.selection.from)
          if (!m.isOpen) {
            const coords = view.coordsAtPos(st.from)
            m.open(wrap(view, slashItems(view, env)), coords, query)
            return
          }
          const count = m.setQuery(query)
          // 没有匹配且又敲了空格:用户其实是在写字,收起菜单(Notion 行为)
          if (count === 0 && query.endsWith(' ')) view.dispatch(view.state.tr.setMeta(slashKey, { close: true }))
        },
        destroy() {
          m.close('api')
          menu = null
        },
      }
    },
  })
}
