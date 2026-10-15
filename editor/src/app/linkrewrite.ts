// 改名联动(PRD 3.8、对照表 S-08):文件或文件夹从 from 移到 to 之后,改写一篇文档里指向它的链接,其余字节不动。
// 覆盖:行内链接与图片 `[文字](地址)`、引用定义 `[id]: 地址`、HTML 的 href / src、wikilink `[[名称]]`(文件改了名字时)。
// 逐行处理并跳过围栏代码块:代码里的示例链接不该被改。
import { displayName, isTextDocument } from '../core/filetypes'
import { dirname, isExternalUrl, joinPath, markdownHref, normalizePath, relativePath } from '../core/paths'

function safeDecode(s: string): string {
  try {
    return decodeURI(s)
  } catch {
    return s
  }
}

function covers(path: string, from: string): boolean {
  return path === from || path.startsWith(`${from}/`)
}

/** 一个链接地址改指向后的新写法;与 from 无关时返回 null。encode:Markdown 链接里转义空格、括号等。 */
function retarget(dest: string, docDir: string, from: string, to: string, encode: boolean): string | null {
  if (!dest || dest.startsWith('#') || dest.startsWith('~') || (isExternalUrl(dest) && !dest.startsWith('file:'))) return null
  const cut = dest.search(/[?#]/)
  const pathPart = cut >= 0 ? dest.slice(0, cut) : dest
  const suffix = cut >= 0 ? dest.slice(cut) : ''
  if (!pathPart) return null
  const fileUrl = pathPart.startsWith('file://')
  const decoded = safeDecode(fileUrl ? pathPart.slice('file://'.length) : pathPart)
  const absolute = decoded.startsWith('/')
  const resolved = absolute ? normalizePath(decoded) : joinPath(docDir, decoded)
  let target: string
  let omittedMd = false
  if (covers(resolved, from)) {
    target = to + resolved.slice(from.length)
  } else if (covers(`${resolved}.md`, from)) {
    // 省略 .md 的写法(对照表 X-10)改完仍然省略
    target = to + `${resolved}.md`.slice(from.length)
    omittedMd = true
  } else {
    return null
  }
  let out = absolute ? target : relativePath(docDir, target)
  if (!absolute && decoded.startsWith('./') && !out.startsWith('.')) out = `./${out}`
  if (omittedMd) out = out.replace(/\.md$/i, '')
  if (fileUrl) return `file://${encodeURI(out)}${suffix}`
  return (encode ? markdownHref(out) : out) + suffix
}

/** 文档 docPath 的原文里,把指向 from 的链接改成指向 to。返回新文本与改动处数。 */
export function rewriteLinks(text: string, docPath: string, from: string, to: string): { text: string; count: number } {
  const docDir = dirname(docPath)
  let count = 0
  const swap = (dest: string, encode: boolean): string | null => {
    const r = retarget(dest, docDir, from, to, encode)
    if (r !== null) count++
    return r
  }
  const oldName = displayName(from)
  const newName = displayName(to)
  const renamedDoc = isTextDocument(from) && oldName !== newName

  let inFence = false
  const lines = text.split('\n').map((line) => {
    if (/^ {0,3}(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence
      return line
    }
    if (inFence) return line
    let out = line.replace(/(\]\(\s*)(<[^>\n]*>|[^\s()<>]+)/g, (m, open: string, dest: string) => {
      if (dest.startsWith('<')) {
        const r = swap(dest.slice(1, -1), true)
        return r === null ? m : `${open}<${r}>`
      }
      const r = swap(dest, true)
      return r === null ? m : open + r
    })
    out = out.replace(/^( {0,3}\[[^\]]+\]:[ \t]*)(<[^>]*>|\S+)/, (m, open: string, dest: string) => {
      if (dest.startsWith('<')) {
        const r = swap(dest.slice(1, -1), true)
        return r === null ? m : `${open}<${r}>`
      }
      const r = swap(dest, true)
      return r === null ? m : open + r
    })
    out = out.replace(/(\b(?:href|src)\s*=\s*)(["'])([^"'\n]*)\2/gi, (m, open: string, quote: string, dest: string) => {
      const r = swap(dest, false)
      return r === null ? m : `${open}${quote}${r}${quote}`
    })
    if (renamedDoc) {
      out = out.replace(/\[\[([^\]|#\n]+)((?:#[^\]|\n]*)?(?:\|[^\]\n]*)?)\]\]/g, (m, name: string, rest: string) => {
        if (name.trim() !== oldName) return m
        count++
        return `[[${newName}${rest}]]`
      })
    }
    return out
  })
  return { text: lines.join('\n'), count }
}
