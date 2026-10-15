// 从 Markdown 原文取标题与首段摘要:文档列表摘要(PRD 3.8)、悬停本地链接预览(对照表 X-06)、快速打开按标题匹配(PRD 3.9)。
// 只做轻量的逐行处理,不完整解析:列表里几百个文件逐个解析太慢,摘要也不需要精确。

const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/

function bodyLines(text: string): string[] {
  const t = text.startsWith('\uFEFF') ? text.slice(1) : text
  const m = FRONT_MATTER.exec(t)
  return (m ? t.slice(m[0].length) : t).split(/\r?\n/)
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/

/** 行内 Markdown → 纯文字(近似):图片、链接只留文字,去掉强调符号与 HTML 标签。 */
export function plainText(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias: string | undefined) => alias ?? target)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*|__|==|~~|`|\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 第一个标题(ATX `# 标题` 或 Setext)的文字;跳过 front matter 与代码块。没有标题返回 null。 */
export function firstHeadingOf(text: string): string | null {
  const lines = bodyLines(text)
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (FENCE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const atx = /^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line)
    if (atx) return plainText(atx[1]) || null
    const next = lines[i + 1]
    if (line.trim() && next !== undefined && /^ {0,3}(=+|-+)[ \t]*$/.test(next) && !/^ {0,3}([-*+>]|\d+[.)])[ \t]/.test(line)) {
      return plainText(line) || null
    }
  }
  return null
}

/** 首段摘要:跳过标题、代码块、分割线、表格、单独的图片与 HTML,取第一段正文,最长 max 个字符。 */
export function excerptOf(text: string, max = 120): string {
  const para: string[] = []
  let inFence = false
  for (const raw of bodyLines(text)) {
    if (FENCE.test(raw)) {
      inFence = !inFence
      if (para.length) break
      continue
    }
    if (inFence) continue
    const line = raw.trim()
    const skip =
      !line ||
      /^#{1,6}([ \t]|$)/.test(line) ||
      /^([-*_=])(\s*\1){2,}$/.test(line) ||
      line.startsWith('|') ||
      /^\[toc\]$/i.test(line) ||
      /^!\[[^\]]*\]\([^)]*\)$/.test(line) ||
      /^<\/?[a-z!][^>]*>$/i.test(line) ||
      line.startsWith('$$')
    if (skip) {
      if (para.length) break
      continue
    }
    const content = plainText(
      line
        .replace(/^(>\s*)+/, '')
        .replace(/^\[![A-Za-z]+\][+-]?\s*/, '')
        .replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, ''),
    )
    if (!content) {
      if (para.length) break
      continue
    }
    para.push(content)
    if (para.join(' ').length >= max) break
  }
  const s = para.join(' ')
  return s.length > max ? `${s.slice(0, max)}…` : s
}
