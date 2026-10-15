// KaTeX 按需加载;同一文档的公式共享宏定义(\newcommand 在后续公式里可用,与 Typora 一致)。
// 公式选项(自动编号、physics、\\ 换行,PRD 3.7)在这里转成 KaTeX 参数,源码预处理见 math-tex.ts。
import type { KatexOptions } from 'katex'
import { type AutoNumber, numberDisplayTex, resolveRefs, stripLabels, syncPhysicsMacros } from './math-tex'

type Katex = typeof import('katex').default

let katexReady: Promise<Katex> | null = null
const macros: Record<string, string> = {}

export interface MathOptions {
  autoNumber: AutoNumber
  physics: boolean
  /** 块公式里顶层的 \\、\newline 换行 */
  lineBreak: boolean
  /** \ref / \eqref 用的「标签 → 编号」 */
  labels?: ReadonlyMap<string, string>
}

export const DEFAULT_MATH_OPTIONS: MathOptions = { autoNumber: 'none', physics: false, lineBreak: true }

export function loadKatex(): Promise<Katex> {
  katexReady ??= Promise.all([
    import('katex'),
    import('katex/dist/katex.min.css'),
    // 化学式 \ce{}(mhchem),Typora 也支持
    import('katex/contrib/mhchem'),
  ]).then(([mod]) => mod.default)
  return katexReady
}

export function resetMacros(): void {
  for (const k of Object.keys(macros)) delete macros[k]
}

/** 交给 KaTeX 的源码:去掉 \label、换掉 \ref,「全部编号」时给块公式加编号环境。 */
export function prepareTex(tex: string, displayMode: boolean, options: MathOptions): string {
  const source = resolveRefs(stripLabels(tex), options.labels ?? new Map<string, string>())
  return displayMode ? numberDisplayTex(source, options.autoNumber) : source
}

function katexOptions(displayMode: boolean, options: MathOptions): KatexOptions {
  return {
    displayMode,
    throwOnError: true,
    output: 'htmlAndMathml',
    trust: false,
    macros,
    globalGroup: true,
    // 块公式顶层 \\ 是否换行由偏好决定(LaTeX 里它不换行);其余非严格写法照常放行
    strict: (code: string) => (code === 'newLineInDisplayMode' ? (options.lineBreak ? 'ignore' : 'error') : 'ignore'),
  }
}

export async function renderTex(tex: string, el: HTMLElement, displayMode: boolean, options: MathOptions = DEFAULT_MATH_OPTIONS): Promise<void> {
  const katex = await loadKatex()
  syncPhysicsMacros(macros, options.physics)
  // 「不编号」:KaTeX 给 equation 等环境自动加的编号用样式隐藏,手写 \tag 照常显示
  el.classList.toggle('tz-math-nonumber', options.autoNumber === 'none')
  try {
    katex.render(prepareTex(tex, displayMode, options), el, katexOptions(displayMode, options))
    el.classList.remove('is-error')
  } catch (err) {
    el.classList.add('is-error')
    el.textContent = err instanceof Error ? err.message : String(err)
  }
}

/** 公式 → MathML 源码(右键「复制为 MathML」,对照表 C-07)。语法错误时抛出。 */
export async function texToMathML(tex: string, displayMode: boolean, options: MathOptions = DEFAULT_MATH_OPTIONS): Promise<string> {
  const katex = await loadKatex()
  syncPhysicsMacros(macros, options.physics)
  const html = katex.renderToString(prepareTex(tex, displayMode, options), { ...katexOptions(displayMode, options), output: 'mathml' })
  const math = /<math[\s\S]*<\/math>/.exec(html)
  if (!math) throw new Error('公式转 MathML 失败')
  return math[0]
}

// ---------- 刷新所有公式(对照表 E-24) ----------

/** 正在显示的公式视图;「刷新所有数学公式」时按创建顺序重新渲染。 */
const liveMath = new Set<{ refresh(): void }>()

export function trackMath(view: { refresh(): void }): void {
  liveMath.add(view)
}

export function untrackMath(view: { refresh(): void }): void {
  liveMath.delete(view)
}

export function refreshAllMath(): void {
  resetMacros()
  for (const v of liveMath) v.refresh()
}
