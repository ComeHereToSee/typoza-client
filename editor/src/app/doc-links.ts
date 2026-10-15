// 文档之间的链接与块搬运(应用层):[[ / @ 菜单的文档标题、「+ 新建」与 /page 新建文档、
// 块「移动到…」与拖到侧栏时追加到目标文档、打开 [[文档名]] 时同名优先同文件夹(notion-input.md 4.2、4.3)。
import type { DocumentRef } from '../core/env'
import { basename, dirname, joinPath, markdownHref, relativePath } from '../core/paths'
import type { Host } from '../host/types'

const MD_EXT = /\.(md|markdown)$/i

/**
 * Markdown 文本的首个一级标题(跳过文首 YAML 与代码块;ATX `# 标题` 与 Setext `标题\n===` 都认),
 * 去掉强调、行内代码与链接标记;没有返回 null。
 */
export function firstHeadingOf(text: string): string | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)\s*$/.test(l))
    if (end > 0) i = end + 1
  }
  let fence: string | null = null
  for (; i < lines.length; i++) {
    const line = lines[i]
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (f) {
      if (fence === null) fence = f[1][0]
      else if (f[1][0] === fence) fence = null
      continue
    }
    if (fence !== null) continue
    const atx = /^\s{0,3}#(?!#)\s+(.*?)\s*#*\s*$/.exec(line)
    const setext = line.trim() && i + 1 < lines.length && /^\s{0,3}=+\s*$/.test(lines[i + 1]) ? line.trim() : null
    const raw = atx ? atx[1] : setext
    if (raw) {
      const title = raw
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_~`]+/g, '')
        .trim()
      if (title) return title
    }
  }
  return null
}

/** 读文件只为取标题时最多读多少个(文件夹很大时其余用文件名) */
const TITLE_LIMIT = 300

/** 根文件夹里的文档 → 菜单用的引用;标题取首个一级标题,没有则用文件名。 */
export async function documentRefs(host: Host, paths: string[], root: string, fromDir: string): Promise<DocumentRef[]> {
  const refs: DocumentRef[] = []
  for (const [i, path] of paths.entries()) {
    const name = basename(path).replace(MD_EXT, '')
    let title = name
    if (i < TITLE_LIMIT) {
      const { text } = await host.readText(path)
      title = firstHeadingOf(text) ?? name
    }
    refs.push({ path, title, name, dir: relativePath(root, dirname(path)) || '.', href: markdownHref(relativePath(fromDir, path)) })
  }
  return refs
}

/** 在 dir 下新建「name.md」(已存在则加 -1、-2……),写入 content,返回引用(链接相对 fromDir)。 */
export async function createDocumentIn(host: Host, dir: string, name: string, content: string, fromDir: string): Promise<DocumentRef> {
  const safe = name.trim().replace(/[/:\\]/g, '-').slice(0, 80) || '未命名'
  let path = joinPath(dir, `${safe}.md`)
  for (let i = 1; await host.stat(path); i++) path = joinPath(dir, `${safe}-${i}.md`)
  await host.writeText(path, content)
  const fileName = basename(path).replace(MD_EXT, '')
  return {
    path,
    title: firstHeadingOf(content) ?? fileName,
    name: fileName,
    dir: relativePath(fromDir, dir) || '.',
    href: markdownHref(relativePath(fromDir, path)),
  }
}

/** 把 Markdown 追加到文档末尾,与原内容之间空一行。 */
export async function appendMarkdown(host: Host, path: string, markdown: string): Promise<void> {
  const { text, encoding } = await host.readText(path)
  const body = text.replace(/\s+$/, '')
  await host.writeText(path, `${body ? `${body}\n\n` : ''}${markdown.replace(/\s+$/, '')}\n`, encoding)
}

/** [[文档名]] → 文件:按文件名找,同名时优先与当前文档同一文件夹的(notion-input.md 4.3)。 */
export function pickWikiTarget(all: readonly string[], name: string, currentDir: string | null): string | null {
  const matches = all.filter((p) => basename(p).replace(MD_EXT, '') === name)
  return matches.find((p) => currentDir !== null && dirname(p) === currentDir) ?? matches[0] ?? null
}
