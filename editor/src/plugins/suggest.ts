// Notion 的 : 表情菜单与 @ 提及菜单。
// :  行首、空白或标点后敲 :,再输入至少 2 个字母或汉字弹出表情;选中插入 Unicode 表情。10:30 这类不触发。
//    把短码敲完整(:smile:)直接换成表情。
// @  行首或空白后敲 @ 弹出:日期(今天 / 明天 / 昨天,存日期文字)与文档(存相对链接)。邮箱里的 @ 不触发。
import { Plugin, PluginKey } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { type Emoji, emojiIndexIfLoaded, loadEmoji, searchEmoji } from '../core/emoji'
import type { DocumentRef, EditorEnv } from '../core/env'
import { schema } from '../core/schema'
import { FloatingMenu, type MenuItem } from '../ui/menu'

type Trigger = ':' | '@'

interface SuggestState {
  active: boolean
  trigger: Trigger
  /** 触发字符所在位置 */
  from: number
}

export const suggestKey = new PluginKey<SuggestState>('tz-suggest')

const INACTIVE: SuggestState = { active: false, trigger: ':', from: 0 }
/** 表情查询词允许的字符:字母(含汉字)、数字、_ + - */
const EMOJI_QUERY = /^[\p{L}\p{N}_+-]*$/u

export function localDate(offsetDays: number, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function charBefore(view: EditorView, pos: number): string {
  const $pos = view.state.doc.resolve(pos)
  return $pos.parent.textBetween(Math.max(0, $pos.parentOffset - 1), $pos.parentOffset, undefined, '\ufffc')
}

function inCode(view: EditorView, pos: number): boolean {
  const $pos = view.state.doc.resolve(pos)
  return Boolean($pos.parent.type.spec.code) || $pos.marks().some((m) => m.type === schema.marks.code)
}

export function suggestPlugin(env: EditorEnv): Plugin<SuggestState> {
  let menu: FloatingMenu | null = null
  let docs: DocumentRef[] | null = null
  let docsFor = -1

  const replaceQuery = (view: EditorView, text: string, link?: string) => {
    const st = suggestKey.getState(view.state)
    if (!st?.active) return
    const to = Math.max(st.from + 1, view.state.selection.from)
    const tr = view.state.tr.insertText(text, st.from, to).setMeta(suggestKey, { close: true })
    if (link) tr.addMark(st.from, st.from + text.trimEnd().length, schema.marks.link.create({ href: link }))
    view.dispatch(tr)
    view.focus()
  }

  const emojiItems = (view: EditorView, list: Emoji[]): MenuItem[] =>
    list.map((e) => ({
      id: e.char,
      label: e.zh || e.name,
      icon: e.char,
      hint: e.shortcodes[0] ? `:${e.shortcodes[0]}:` : e.name,
      run: () => replaceQuery(view, e.char),
    }))

  const mentionItems = (view: EditorView): MenuItem[] => {
    const dates: [string, number, string[]][] = [
      ['今天', 0, ['today', 'jt', 'jintian']],
      ['明天', 1, ['tomorrow', 'mt', 'mingtian']],
      ['昨天', -1, ['yesterday', 'zt', 'zuotian']],
    ]
    const items: MenuItem[] = dates.map(([label, offset, keywords]) => {
      const date = localDate(offset)
      return { id: `date:${offset}`, label, hint: date, icon: '📅', group: '日期', keywords: [...keywords, date], run: () => replaceQuery(view, `${date} `) }
    })
    for (const d of docs ?? []) {
      items.push({ id: `doc:${d.path}`, label: d.title, hint: d.dir, icon: '📄', group: '文档', keywords: [d.path], run: () => replaceQuery(view, `${d.title} `, d.href) })
    }
    return items
  }

  return new Plugin<SuggestState>({
    key: suggestKey,
    state: {
      init: () => INACTIVE,
      apply(tr, prev) {
        const meta = tr.getMeta(suggestKey) as { open?: number; trigger?: Trigger; close?: boolean } | undefined
        if (meta?.open !== undefined) return { active: true, trigger: meta.trigger ?? ':', from: meta.open }
        if (meta?.close) return INACTIVE
        if (!prev.active) return prev
        const from = tr.mapping.map(prev.from)
        const sel = tr.selection
        const still = from < tr.doc.content.size && tr.doc.textBetween(from, from + 1) === prev.trigger
        if (!still || !sel.empty || sel.from <= from || !tr.doc.resolve(from).sameParent(sel.$from)) return INACTIVE
        const query = tr.doc.textBetween(from + 1, sel.from)
        if (prev.trigger === ':' && !EMOJI_QUERY.test(query)) return INACTIVE
        if (query.length > 60) return INACTIVE
        return { ...prev, from }
      },
    },
    props: {
      handleTextInput(view, from, to, text) {
        if (text !== ':' && text !== '@') return false
        if (inCode(view, from)) return false
        const st = suggestKey.getState(view.state)
        if (text === ':' && st?.active && st.trigger === ':') {
          // 敲完整短码 :smile: → 直接换成表情
          const start = st.from
          const code = view.state.doc.textBetween(start + 1, from).toLowerCase()
          const index = emojiIndexIfLoaded()
          const char = index?.byShortcode.get(code)
          if (char) {
            view.dispatch(view.state.tr.insertText(char, start, to).setMeta(suggestKey, { close: true }))
            return true
          }
          if (!index && code) {
            // 表情数据还在加载(敲得比加载快):先照常输入冒号,加载完若文字没变再替换
            void loadEmoji().then((loaded) => {
              const late = loaded.byShortcode.get(code)
              const end = start + code.length + 2
              if (late && !view.isDestroyed && end <= view.state.doc.content.size && view.state.doc.textBetween(start, end) === `:${code}:`) {
                view.dispatch(view.state.tr.insertText(late, start, end))
              }
            })
          }
          return false
        }
        const before = charBefore(view, from)
        const ok = text === ':' ? !before || /[\s\p{P}\p{S}]/u.test(before) : !before || /\s/.test(before)
        if (!ok) return false
        if (text === ':') void loadEmoji() // 提前加载,菜单出得快
        view.dispatch(view.state.tr.insertText(text, from, to).setMeta(suggestKey, { open: from, trigger: text }))
        return true
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
        className: 'tz-suggest-menu',
        emptyText: '没有匹配的项',
        onClose: (reason) => {
          if ((reason === 'escape' || reason === 'outside') && suggestKey.getState(editorView.state)?.active) {
            editorView.dispatch(editorView.state.tr.setMeta(suggestKey, { close: true }))
          }
        },
      })
      menu = m
      const render = (view: EditorView) => {
        const st = suggestKey.getState(view.state)
        if (!st?.active) {
          if (m.isOpen) m.close('api')
          return
        }
        const query = view.state.doc.textBetween(st.from + 1, view.state.selection.from)
        const coords = view.coordsAtPos(st.from)
        if (st.trigger === ':') {
          if ([...query].length < 2) {
            if (m.isOpen) m.close('api')
            return
          }
          const index = emojiIndexIfLoaded()
          if (!index) {
            void loadEmoji().then(() => render(editorView))
            return
          }
          const found = searchEmoji(index.list, query, 50)
          if (found.length === 0) {
            if (m.isOpen) m.close('api')
            return
          }
          m.open(emojiItems(view, found), coords, '')
          return
        }
        // @:文档列表每次触发取一次(新建的文档也能提及)
        if (docsFor !== st.from) {
          docsFor = st.from
          docs = null
          void env.actions.listDocuments().then((list) => {
            docs = list
            if (suggestKey.getState(editorView.state)?.active) m.open(mentionItems(editorView), editorView.coordsAtPos(st.from), editorView.state.doc.textBetween(st.from + 1, editorView.state.selection.from))
          })
        }
        if (!m.isOpen) {
          m.open(mentionItems(view), coords, query)
          return
        }
        const count = m.setQuery(query)
        // 没有匹配又敲了空格:用户在正常写字,收起菜单(与斜杠菜单一致)
        if (count === 0 && query.endsWith(' ')) view.dispatch(view.state.tr.setMeta(suggestKey, { close: true }))
      }
      return {
        update: render,
        destroy() {
          m.close('api')
          menu = null
        },
      }
    },
  })
}
