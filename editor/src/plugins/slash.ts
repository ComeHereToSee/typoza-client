// Notion 斜杠菜单:块开头、空白或标点后敲 / 弹出块菜单,继续输入即过滤(支持中文、英文、拼音缩写);
// 无匹配时显示「无结果」,再输入 2 个字符仍无匹配自动关闭(notion-input.md 4.1)。
// 敲 [[ 就地弹出文档菜单:按文件名与首个一级标题模糊匹配,末项「+ 新建『关键字』」(4.3)。
import { Plugin, PluginKey } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { fuzzyScore } from '../app/quickopen'
import type { DocumentRef, EditorEnv } from '../core/env'
import { schema } from '../core/schema'
import { FloatingMenu, type MenuItem } from '../ui/menu'
import { insertLinkText, slashItems } from './items'

type Mode = 'slash' | 'link'

interface SlashState {
  active: boolean
  mode: Mode
  /** 触发字符(/ 或 [[ 的第一个 [)所在位置 */
  from: number
}

const INACTIVE: SlashState = { active: false, mode: 'slash', from: 0 }
const TRIGGER: Record<Mode, string> = { slash: '/', link: '[[' }

export const slashKey = new PluginKey<SlashState>('tz-slash')

/** 在当前位置打开斜杠菜单(块手柄的 + 按钮也用它)。 */
export function openSlashMenu(view: EditorView): void {
  const { from, to } = view.state.selection
  view.dispatch(view.state.tr.insertText('/', from, to).setMeta(slashKey, { open: from, mode: 'slash' }))
  view.focus()
}

/** 在光标处敲出 [[ 并打开文档链接菜单(斜杠菜单「链接到文档」)。 */
export function openLinkMenu(view: EditorView): void {
  const { from, to } = view.state.selection
  view.dispatch(view.state.tr.insertText('[[', from, to).setMeta(slashKey, { open: from, mode: 'link' }))
  view.focus()
}

/**
 * `/` 能否在这里触发:块开头、空白或标点之后(notion-input.md 2.2 第 14 行)。
 * 网址里的 `http:/`、`//` 不触发,避免敲网址时菜单闪现。textBefore 是光标前的几个字符。
 */
export function slashAllowedAfter(textBefore: string): boolean {
  const before = textBefore.slice(-1)
  if (!before || /\s/.test(before)) return true
  if (before === '/') return false
  if (before === ':' && /[A-Za-z0-9]:$/.test(textBefore)) return false
  return /[\p{P}\p{S}]/u.test(before)
}

export function slashPlugin(env: EditorEnv): Plugin<SlashState> {
  let menu: FloatingMenu | null = null

  /** 删掉「/查询词」并结束斜杠状态(执行条目前调用)。 */
  const removeQuery = (view: EditorView) => {
    const st = slashKey.getState(view.state)
    if (!st?.active) return
    const end = Math.max(st.from + 1, view.state.selection.from)
    view.dispatch(view.state.tr.delete(st.from, end).setMeta(slashKey, { close: true }))
  }

  // 子菜单里的条目(日期、转换为……)同样先删查询词
  const wrap = (view: EditorView, items: MenuItem[]): MenuItem[] =>
    items.map((item) => {
      const run = item.run
      const children = item.children
      return {
        ...item,
        run: run
          ? () => {
              removeQuery(view)
              run()
            }
          : undefined,
        children: children ? () => wrap(view, children()) : undefined,
      }
    })

  /** [[ 菜单选中文档:把「[[查询词」(连同自动配对补的 ])换成指向该文档的链接。 */
  const linkTo = (view: EditorView, title: string, href: string) => {
    const st = slashKey.getState(view.state)
    if (!st?.active || st.mode !== 'link') return
    const $cursor = view.state.selection.$from
    const rest = $cursor.parent.textBetween($cursor.parentOffset, Math.min($cursor.parent.content.size, $cursor.parentOffset + 2), undefined, '\ufffc')
    const closing = /^\]{0,2}/.exec(rest)?.[0].length ?? 0
    view.dispatch(view.state.tr.delete(st.from, view.state.selection.from + closing).setMeta(slashKey, { close: true }))
    insertLinkText(view, title, href)
    view.focus()
  }

  const createAndLink = async (view: EditorView, name: string) => {
    const ref = await env.actions.createDocument(name, `# ${name}\n`)
    if (!ref) {
      view.dispatch(view.state.tr.setMeta(slashKey, { close: true }))
      return
    }
    linkTo(view, ref.title, ref.href)
  }

  let docs: DocumentRef[] | null = null
  let docsFor = -1

  const linkItems = (view: EditorView, query: string): MenuItem[] => {
    const q = query.trim()
    const list = docs ?? []
    const matched = q
      ? list
          .map((d) => ({ d, s: Math.max(fuzzyScore(q, d.name), fuzzyScore(q, d.title), fuzzyScore(q, d.path)) }))
          .filter((x) => x.s >= 0)
          .sort((a, b) => b.s - a.s)
          .map((x) => x.d)
      : list
    const items: MenuItem[] = matched.slice(0, 50).map((d) => ({
      id: `doc:${d.path}`,
      label: d.title,
      hint: d.title === d.name ? d.dir : `${d.name} · ${d.dir}`,
      icon: '📄',
      group: '文档',
      run: () => linkTo(view, d.title, d.href),
    }))
    if (q) items.push({ id: 'doc:new', label: `+ 新建『${q}』`, group: '新建', run: () => void createAndLink(view, q) })
    return items
  }

  return new Plugin<SlashState>({
    key: slashKey,
    state: {
      init: () => INACTIVE,
      apply(tr, prev) {
        const meta = tr.getMeta(slashKey) as { open?: number; mode?: Mode; close?: boolean } | undefined
        if (meta?.open !== undefined) return { active: true, mode: meta.mode ?? 'slash', from: meta.open }
        if (meta?.close) return INACTIVE
        if (!prev.active) return prev
        const from = tr.mapping.map(prev.from)
        const end = from + TRIGGER[prev.mode].length
        const sel = tr.selection
        const still = end <= tr.doc.content.size && tr.doc.textBetween(from, end) === TRIGGER[prev.mode]
        if (!still || !sel.empty || sel.from < end || !tr.doc.resolve(from).sameParent(sel.$from)) return INACTIVE
        if (prev.mode === 'link') {
          const query = tr.doc.textBetween(end, sel.from)
          if (/[\]\n]/.test(query) || query.length > 60) return INACTIVE
        }
        return { ...prev, from }
      },
    },
    props: {
      handleTextInput(view, from, to, text) {
        const $from = view.state.doc.resolve(from)
        // 代码块、行内代码里不触发(notion-input.md 一「触发位置」)
        if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false
        if ($from.marks().some((m) => m.type === schema.marks.code)) return false
        const textBefore = $from.parent.textBetween(Math.max(0, $from.parentOffset - 3), $from.parentOffset, undefined, '\ufffc')
        if (text === '/') {
          if (!slashAllowedAfter(textBefore)) return false
          view.dispatch(view.state.tr.insertText('/', from, to).setMeta(slashKey, { open: from, mode: 'slash' }))
          return true
        }
        if (text === '[' && textBefore.endsWith('[')) {
          view.dispatch(view.state.tr.insertText('[', from, to).setMeta(slashKey, { open: from - 1, mode: 'link' }))
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
        emptyText: '无结果',
        onClose: (reason) => {
          if (reason !== 'select' && slashKey.getState(editorView.state)?.active) {
            editorView.dispatch(editorView.state.tr.setMeta(slashKey, { close: true }))
          }
        },
      })
      menu = m
      /** 首次无匹配时查询词的字数;之后再多 2 个字仍无匹配就关闭 */
      let missAt: number | null = null
      const update = (view: EditorView) => {
        const st = slashKey.getState(view.state)
        if (!st?.active) {
          if (m.isOpen) m.close('api')
          missAt = null
          docsFor = -1
          return
        }
        const query = view.state.doc.textBetween(st.from + TRIGGER[st.mode].length, view.state.selection.from)
        const coords = view.coordsAtPos(st.from)
        if (st.mode === 'link') {
          // 文档列表每次触发取一次(新建的文档也能链接)
          if (docsFor !== st.from) {
            docsFor = st.from
            docs = null
            void env.actions.listDocuments().then((list) => {
              docs = list
              if (slashKey.getState(editorView.state)?.active) update(editorView)
            })
          }
          m.open(linkItems(view, query), coords)
          return
        }
        if (!m.isOpen) {
          missAt = null
          m.open(wrap(view, slashItems(view, env, { openLinkMenu: () => openLinkMenu(view) })), coords)
        }
        const count = m.setQuery(query)
        const length = [...query].length
        if (count > 0) missAt = null
        else if (missAt === null) missAt = length
        else if (length - missAt >= 2) view.dispatch(view.state.tr.setMeta(slashKey, { close: true }))
      }
      return {
        update,
        destroy() {
          m.close('api')
          menu = null
        },
      }
    },
  })
}
