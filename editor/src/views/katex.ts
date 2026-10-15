// KaTeX 按需加载;同一文档的公式共享宏定义(\newcommand 在后续公式里可用,与 Typora 一致)。
type Katex = typeof import('katex').default

let katexReady: Promise<Katex> | null = null
const macros: Record<string, string> = {}

/** 偏好「Markdown」页的公式选项:自动编号(PM-22)、physics 宏(PM-21)。 */
export interface MathOptions {
  /** none:不编号;ams:equation / align / gather 等环境编号(KaTeX 默认行为);all:每个块级公式都编号 */
  numbering: 'none' | 'ams' | 'all'
  physics: boolean
}

const mathOptions: MathOptions = { numbering: 'ams', physics: false }

// physics 包常用宏的近似实现(KaTeX 不带 physics 包);开启时允许覆盖同名宏(如 \div 变成散度),与 Typora 说明一致
const PHYSICS_MACROS: Record<string, string> = {
  '\\abs': '\\left\\lvert #1 \\right\\rvert',
  '\\norm': '\\left\\lVert #1 \\right\\rVert',
  '\\order': '\\mathcal{O}\\left(#1\\right)',
  '\\bra': '\\left\\langle #1 \\right\\rvert',
  '\\ket': '\\left\\lvert #1 \\right\\rangle',
  '\\braket': '\\left\\langle #1 \\middle\\vert #2 \\right\\rangle',
  '\\expval': '\\left\\langle #1 \\right\\rangle',
  '\\dv': '\\frac{\\mathrm{d} #1}{\\mathrm{d} #2}',
  '\\pdv': '\\frac{\\partial #1}{\\partial #2}',
  '\\dd': '\\mathrm{d}',
  '\\vb': '\\mathbf{#1}',
  '\\vu': '\\hat{\\mathbf{#1}}',
  '\\grad': '\\nabla',
  '\\div': '\\nabla\\cdot',
  '\\curl': '\\nabla\\times',
  '\\laplacian': '\\nabla^2',
  '\\comm': '\\left[#1, #2\\right]',
  '\\tr': '\\operatorname{tr}',
  '\\Tr': '\\operatorname{Tr}',
  '\\rank': '\\operatorname{rank}',
  '\\erf': '\\operatorname{erf}',
  '\\Res': '\\operatorname{Res}',
}

function applyPhysics(): void {
  for (const k of Object.keys(PHYSICS_MACROS)) delete macros[k]
  if (mathOptions.physics) Object.assign(macros, PHYSICS_MACROS)
}

/** 改公式选项;已渲染的公式要由调用方重绘。 */
export function setMathOptions(options: MathOptions): void {
  Object.assign(mathOptions, options)
  applyPhysics()
}

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
  applyPhysics()
}

/** 「全部编号」:没写环境、没写 \tag 的块级公式套一层编号环境(多行用 gather,每行一个编号)。 */
export function numberedTex(tex: string): string {
  if (/\\begin\{|\\tag\b|\\notag\b|\\nonumber\b/.test(tex)) return tex
  const env = /\\\\/.test(tex) ? 'gather' : 'equation'
  return `\\begin{${env}}${tex}\\end{${env}}`
}

export async function renderTex(tex: string, el: HTMLElement, displayMode: boolean): Promise<void> {
  const katex = await loadKatex()
  const source = displayMode && mathOptions.numbering === 'all' ? numberedTex(tex) : tex
  try {
    katex.render(source, el, { displayMode, throwOnError: true, output: 'htmlAndMathml', trust: false, macros, globalGroup: true })
    el.classList.remove('is-error')
  } catch (err) {
    el.classList.add('is-error')
    el.textContent = err instanceof Error ? err.message : String(err)
  }
}
