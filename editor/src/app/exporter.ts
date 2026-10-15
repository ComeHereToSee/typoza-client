// 导出 HTML:克隆当前渲染结果(公式、图表已渲染),去掉编辑器界面元素,本机资源改成相对导出位置的路径。
import { dirname, relativePath } from '../core/paths'
import { escapeHtml } from '../core/markdown/html'

function collectCss(): string {
  const out: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) out.push(rule.cssText)
    } catch {
      // 跨源样式表(不会出现在本应用里)读不了,跳过
    }
  }
  return out.join('\n')
}

function localPathFromUrl(url: string): string | null {
  if (!url.startsWith('typoza://local/')) return null
  try {
    return decodeURIComponent(url.slice('typoza://local'.length))
  } catch {
    return null
  }
}

/** 生成可独立打开的 HTML。withStyles=false 时为「HTML(无样式)」。 */
export function buildExportHtml(editorDom: HTMLElement, title: string, targetPath: string | null, withStyles: boolean, darkTheme: boolean): string {
  const clone = editorDom.cloneNode(true) as HTMLElement
  clone.removeAttribute('contenteditable')
  clone.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'))
  // 编辑器专用元素
  clone
    .querySelectorAll('.tz-image-toolbar, .tz-image-handle, .tz-media-toolbar, .tz-code-header, .tz-toggle-btn, .ProseMirror-gapcursor, .tz-frontmatter, .tz-html-source, .tz-math-source, .ProseMirror-separator, .ProseMirror-trailingBreak')
    .forEach((el) => el.remove())
  // 代码块:CodeMirror → 普通 <pre><code>
  clone.querySelectorAll<HTMLElement>('.tz-code-block').forEach((block) => {
    const lang = block.dataset.language ?? ''
    const lines = Array.from(block.querySelectorAll('.cm-line')).map((l) => l.textContent ?? '')
    const diagram = block.querySelector('.tz-diagram-preview')
    if (diagram && block.classList.contains('is-diagram')) {
      block.replaceWith(Object.assign(document.createElement('div'), { className: 'tz-diagram', innerHTML: diagram.innerHTML }))
      return
    }
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    if (lang) code.className = `language-${lang}`
    code.textContent = lines.join('\n')
    pre.append(code)
    block.replaceWith(pre)
  })
  // 本机资源:改成相对导出文件的路径
  const base = targetPath ? dirname(targetPath) : null
  clone.querySelectorAll<HTMLElement>('[src]').forEach((el) => {
    const local = localPathFromUrl(el.getAttribute('src') ?? '')
    if (local) el.setAttribute('src', base ? relativePath(base, local) : `file://${local}`)
  })
  const css = withStyles ? `<style>\n${collectCss()}\n</style>` : ''
  return `<!doctype html>
<html lang="zh-CN"${darkTheme ? ' class="tz-dark"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${css}
</head>
<body class="tz-export">
<div id="write" class="tz-editor">
${clone.innerHTML}
</div>
</body>
</html>
`
}
