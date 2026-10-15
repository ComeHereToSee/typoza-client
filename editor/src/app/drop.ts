// 从 Finder 拖进编辑区的文件按类型分别处理(PRD 3.5 附件;对照表 PF-08 ~ PF-10、X-17):
// 文件夹 → 在侧栏打开 / 插入文件夹链接;Markdown → 打开 / 插入文件链接;docx 等可导入文件 → 经 Pandoc 导入 / 插入文件链接;
// 其余(图片、媒体、附件)按「插入图片时」规则复制后插入。原生外壳截下拖放拿到真实路径(网页里的 File 没有路径)。
import type { EditorView } from 'prosemirror-view'
import type { ImportFile } from '../core/env'
import { basename, dirname, extname, markdownHref, relativePath } from '../core/paths'
import { schema } from '../core/schema'
import type { Host } from '../host/types'
import type { AppSettings } from './settings'

/** Pandoc 能导入的扩展名(对照表 F-21)。 */
export const IMPORTABLE_EXTENSIONS = ['docx', 'latex', 'tex', 'ltx', 'rst', 'rest', 'org', 'wiki', 'dokuwiki', 'textile', 'opml', 'epub']

/** 可在 Typoza 里打开的文本文件扩展名(对照表 F-04)。 */
export const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mmd', 'mdown', 'mkd', 'mdwn', 'mdtxt', 'mdtext', 'txt', 'text', 'rmd', 'rmarkdown']

export type DropKind = 'folder' | 'markdown' | 'importable' | 'other'

export function dropKind(path: string, isDir: boolean): DropKind {
  if (isDir) return 'folder'
  const ext = extname(path)
  if (MARKDOWN_EXTENSIONS.includes(ext)) return 'markdown'
  if (IMPORTABLE_EXTENSIONS.includes(ext)) return 'importable'
  return 'other'
}

export interface DropTarget {
  host: Host
  settings: AppSettings
  view: EditorView
  docPath: string | null
  /** 在侧栏打开文件夹 */
  openFolder(path: string): void
  /** 在 Typoza 里打开文档(新窗口;已打开时切过去) */
  openDocument(path: string): void
  /** 经 Pandoc 导入并打开 */
  importDocument(path: string): Promise<void>
  /** 按「插入图片时」规则复制并插入 */
  importFiles(files: ImportFile[], at: number): Promise<void>
}

/** 指向 path 的链接地址:有文档路径时写相对路径,文件夹以 / 结尾。 */
export function linkHref(docPath: string | null, path: string, isDir: boolean): string {
  const target = docPath ? relativePath(dirname(docPath), path) : path
  return markdownHref(isDir ? `${target.replace(/\/$/, '')}/` : target)
}

/** 链接文字:文件夹与可导入文件用全名,Markdown 去掉扩展名(对照表 PF-08 ~ PF-10 的存储写法)。 */
export function linkText(path: string, kind: DropKind): string {
  const name = basename(path)
  return kind === 'markdown' ? name.replace(/\.[^.]+$/, '') : name
}

export async function handleDroppedPaths(t: DropTarget, paths: string[], at: number): Promise<void> {
  const links: { text: string; href: string }[] = []
  const others: ImportFile[] = []
  for (const path of paths) {
    const stat = await t.host.stat(path)
    if (!stat) throw new Error(`拖入的文件不存在:${path}`)
    const kind = dropKind(path, stat.isDir)
    const s = t.settings
    const asLink =
      (kind === 'folder' && s.dropFolderAction === 'link') ||
      (kind === 'markdown' && s.dropMarkdownAction === 'link') ||
      (kind === 'importable' && s.dropImportableAction === 'link')
    if (asLink) links.push({ text: linkText(path, kind), href: linkHref(t.docPath, path, kind === 'folder') })
    else if (kind === 'folder') t.openFolder(path)
    else if (kind === 'markdown') t.openDocument(path)
    else if (kind === 'importable') await t.importDocument(path)
    else others.push({ name: basename(path), path })
  }
  if (links.length) insertLinks(t.view, links, at)
  if (others.length) await t.importFiles(others, at)
}

/** 在 at 处插入一串链接(以空格分隔);at 不在文字里时插在所在块后面的新段落。 */
function insertLinks(view: EditorView, links: { text: string; href: string }[], at: number): void {
  const nodes = links.flatMap((l, i) => [
    ...(i > 0 ? [schema.text(' ')] : []),
    schema.text(l.text, [schema.marks.link.create({ href: l.href })]),
  ])
  const { state } = view
  const $pos = state.doc.resolve(Math.min(at, state.doc.content.size))
  const tr = state.tr
  if ($pos.parent.inlineContent && !$pos.parent.type.spec.code) tr.insert($pos.pos, nodes)
  else tr.insert($pos.depth > 0 ? $pos.after(1) : $pos.pos, schema.nodes.paragraph.create(null, nodes))
  view.dispatch(tr.scrollIntoView())
}
