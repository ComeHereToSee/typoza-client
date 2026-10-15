// 打开链接:#锚点跳到标题;网址交给系统浏览器;.md 文档在 Typoza 里打开;其它本机文件用默认应用打开。
import { TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { collectHeadings, slugify } from './blocks'
import { type EditorEnv, localPathOf } from './env'
import { isExternalUrl } from './paths'

export function scrollToAnchor(view: EditorView, anchor: string): boolean {
  const target = slugify(decodeURIComponent(anchor))
  const heading = collectHeadings(view.state.doc).find((h) => h.id === target || slugify(h.text) === target)
  if (!heading) return false
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, heading.pos + 1)).scrollIntoView())
  view.focus()
  return true
}

export function openHref(view: EditorView, env: EditorEnv, href: string, newWindow: boolean): void {
  if (!href) return
  if (href.startsWith('#')) {
    scrollToAnchor(view, href.slice(1))
    return
  }
  if (isExternalUrl(href)) {
    void env.host.openExternal(href)
    return
  }
  const [pathPart] = href.split('#')
  if (/\.(md|markdown|mdown|mkd|txt)$/i.test(pathPart)) {
    env.openDocumentLink(href, newWindow)
    return
  }
  const local = localPathOf(env, pathPart)
  if (local) void env.host.openWithDefaultApp(local)
}
