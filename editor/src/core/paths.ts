// 文档内资源路径解析(图片、视频、附件、文档链接),规则与 Typora 一致:
// 相对路径相对文档所在目录;以 / 开头且 front matter 设了 typora-root-url 时相对该根目录;file:// 转本地路径。

export interface DocContext {
  /** 当前文档绝对路径;新建未保存时为 null */
  path: string | null
  /** front matter 里的 typora-root-url(已解析为绝对路径) */
  rootUrl: string | null
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i <= 0 ? '/' : path.slice(0, i)
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function extname(path: string): string {
  const name = basename(path)
  const i = name.lastIndexOf('.')
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase()
}

/** 规范化绝对路径:合并 . 与 ..、去重复斜杠。 */
export function normalizePath(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return `/${out.join('/')}`
}

export function joinPath(base: string, rel: string): string {
  return normalizePath(`${base}/${rel}`)
}

/** a 相对 b(目录)的路径,用于插入图片时写相对路径。 */
export function relativePath(fromDir: string, to: string): string {
  const a = normalizePath(fromDir).split('/').filter(Boolean)
  const b = normalizePath(to).split('/').filter(Boolean)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  const up = a.slice(i).map(() => '..')
  return [...up, ...b.slice(i)].join('/') || '.'
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i

export function isExternalUrl(src: string): boolean {
  return /^(https?|data|blob|mailto|tel):/i.test(src) || (EXTERNAL.test(src) && !src.startsWith('file:'))
}

function safeDecode(s: string): string {
  try {
    return decodeURI(s)
  } catch {
    // 路径里含有不成对的 % 时按原样处理(文件名本身就带 %)
    return s
  }
}

/** 把文档里写的资源地址解析成本机绝对路径;外部网址返回 null。 */
export function resolveLocalPath(src: string, ctx: DocContext): string | null {
  if (!src || isExternalUrl(src)) return null
  if (src.startsWith('file://')) return normalizePath(safeDecode(src.slice('file://'.length)))
  const clean = safeDecode(src.split(/[?#]/)[0])
  if (clean.startsWith('/')) {
    return ctx.rootUrl ? joinPath(ctx.rootUrl, clean) : normalizePath(clean)
  }
  if (clean.startsWith('~/')) return null // 需要宿主展开家目录,交给宿主
  if (!ctx.path) return null
  return joinPath(dirname(ctx.path), clean)
}

/**
 * 相对路径 → Markdown 链接地址:中文等字符保持原样(与 Typora 一致,源码可读),
 * 只转义会截断或改变链接含义的 ASCII 字符(空格、制表、换行、括号、尖括号、%、#、?)。
 */
export function markdownHref(relPath: string): string {
  return relPath.replace(/[ \t\n()<>%#?]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
}
