// 图表渲染(按需加载 mermaid,首屏不付这笔体积)。
// sequence、flow(Typora 用的 js-sequence-diagrams / flowchart.js 写法)先转成 Mermaid 再渲染,不另引依赖(对照表 X-42)。
import { flowToMermaid, sequenceToMermaid } from './diagram-syntax'

let mermaidReady: Promise<typeof import('mermaid').default> | null = null
let seq = 0

/**
 * 有渲染预览的代码块语言:图表(mermaid / sequence / flow)与 ```math 公式。
 * 光标不在块里时只显示渲染结果,进入块时露出源码(编辑态标记也按它判断)。
 */
const PREVIEW_LANGUAGES = new Set(['mermaid', 'sequence', 'flow', 'math'])

export function isDiagramLanguage(language: string | null | undefined): boolean {
  return PREVIEW_LANGUAGES.has((language ?? '').toLowerCase())
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

/** 图表源码 → Mermaid 源码。 */
export function toMermaid(language: string, code: string): string {
  const name = language.toLowerCase()
  if (name === 'sequence') return sequenceToMermaid(code)
  if (name === 'flow') return flowToMermaid(code)
  return code
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
    const { svg } = await mermaid.render(`tz-mermaid-${++seq}`, toMermaid(language, code))
    container.innerHTML = svg
  } catch (err) {
    container.classList.add('is-error')
    container.textContent = `${language} 语法错误:${err instanceof Error ? err.message : String(err)}`
  }
}
