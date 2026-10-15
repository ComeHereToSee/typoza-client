// 图表渲染(按需加载 mermaid,首屏不付这笔体积)。
let mermaidReady: Promise<typeof import('mermaid').default> | null = null
let seq = 0

const DIAGRAM_LANGUAGES = new Set(['mermaid'])

/** 偏好「Markdown ▸ 图表」(PM-12):关闭后图表代码块按普通代码显示。 */
let diagramsEnabled = true

export function setDiagramsEnabled(on: boolean): void {
  diagramsEnabled = on
}

export function isDiagramLanguage(language: string | null | undefined): boolean {
  return diagramsEnabled && DIAGRAM_LANGUAGES.has((language ?? '').toLowerCase())
}

function loadMermaid() {
  mermaidReady ??= import('mermaid').then((mod) => {
    const mermaid = mod.default
    const dark = document.documentElement.classList.contains('tz-dark')
    // strict:禁止图表里的脚本与点击回调,文档内容不可信
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' })
    return mermaid
  })
  return mermaidReady
}

export async function renderDiagram(language: string, code: string, container: HTMLElement): Promise<void> {
  if (!code.trim()) {
    container.textContent = '空图表'
    container.classList.add('is-empty')
    return
  }
  container.classList.remove('is-empty', 'is-error')
  try {
    const mermaid = await loadMermaid()
    const { svg } = await mermaid.render(`tz-mermaid-${++seq}`, code)
    container.innerHTML = svg
  } catch (err) {
    container.classList.add('is-error')
    container.textContent = `${language} 语法错误:${err instanceof Error ? err.message : String(err)}`
  }
}
