// 可在 Typoza 里打开的文件(对照表 F-04、X-53)。扩展名清单网页侧只此一份;外壳另有同样的一份(FileService.textExtensions)。
// TextBundle 是一个文件夹包:正文是包内的 text.md(或 text.markdown / text.txt),图片放包内 assets/。
import { basename, dirname, extname } from './paths'

export const TEXT_EXTENSIONS = ['md', 'markdown', 'mmd', 'mdown', 'mkd', 'mdwn', 'mdtxt', 'mdtext', 'txt', 'text', 'rmd', 'rmarkdown']

/** TextBundle 包里的正文文件名 */
export const TEXTBUNDLE_TEXT = /^text\.(md|markdown|txt)$/i

export function isTextDocument(path: string): boolean {
  return TEXT_EXTENSIONS.includes(extname(path))
}

export function isTextBundle(path: string): boolean {
  return extname(path) === 'textbundle'
}

/** 可在 Typoza 里打开:Markdown / 纯文本文件,或 TextBundle 包 */
export function isOpenable(path: string): boolean {
  return isTextDocument(path) || isTextBundle(path)
}

/** 正文在 TextBundle 包里时返回包的路径,否则 null */
export function bundleOf(path: string): string | null {
  const dir = dirname(path)
  return isTextBundle(dir) ? dir : null
}

/** 侧栏、快速打开、链接文字里显示的文档名:去掉 .md / .markdown / .textbundle(其它扩展名保留,免得 a.md 与 a.txt 同名) */
export function displayName(path: string): string {
  const name = basename(bundleOf(path) ?? path)
  return name.replace(/\.(md|markdown|textbundle)$/i, '')
}
