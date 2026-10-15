// 打开链接:网址交给系统浏览器;其余(#锚点、本地文档、其它本机文件、wikilink)交给应用层决定怎么开,
// 应用层负责「已打开则切过去」、新标签 / 新窗口、目标不存在时询问新建、跳转入后退栈(PRD 3.2 链接)。
import type { Node as PMNode } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { collectHeadings, slugify } from './blocks'
import type { EditorEnv, OpenWhere } from './env'
import { isExternalUrl } from './paths'
import { schema } from './schema'

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    // 锚点里有不成对的 % 时按原样处理
    return s
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 文内锚点的目标位置:先找标题(与导出 HTML 一致的 slug,重名加 -1 -2),
 * 再找 `<a id="x">` / `<a name="x">` 命名锚点(对照表 X-09)。找不到返回 null。
 */
export function findAnchor(doc: PMNode, anchor: string): number | null {
  const raw = safeDecode(anchor)
  const target = slugify(raw)
  const heading = collectHeadings(doc).find((h) => h.id === target || slugify(h.text) === target)
  if (heading) return heading.pos + 1
  const named = new RegExp(`<a\\s[^>]*\\b(?:id|name)\\s*=\\s*(["']?)${escapeRegExp(raw)}\\1(?=[\\s/>])`, 'i')
  let found: number | null = null
  doc.descendants((node, pos) => {
    if (found !== null) return false
    if (node.type === schema.nodes.html_inline && named.test(String(node.attrs.html))) found = pos
    else if (node.type === schema.nodes.html_block && named.test(node.textContent)) found = pos + 1
    return found === null
  })
  return found
}

export function scrollToAnchor(view: EditorView, anchor: string): boolean {
  const pos = findAnchor(view.state.doc, anchor)
  if (pos === null) return false
  const $pos = view.state.doc.resolve(Math.min(pos, view.state.doc.content.size))
  view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)).scrollIntoView())
  view.focus()
  return true
}

/** where 传布尔时 true = 新标签(兼容旧调用:⌘+点击)。 */
export function openHref(_view: EditorView, env: EditorEnv, href: string, where: OpenWhere | boolean = 'current'): void {
  if (!href) return
  if (isExternalUrl(href)) {
    void env.host.openExternal(href)
    return
  }
  env.openDocumentLink(href, where)
}
