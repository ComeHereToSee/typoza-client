// 公式源码预处理(PRD 3.7「公式选项」,对照表 PM-20~PM-22、X-41):\label / \ref / \eqref、「全部编号」、physics 宏。
// KaTeX 不认 \label、\ref,这里先按文档顺序算出编号再换成文字;纯函数,便于单测。
export type AutoNumber = 'none' | 'ams' | 'all'

/** AMS 规则下自动编号的环境(不带星号的才编号)。 */
const NUMBERED_ENV = /\\begin\{(equation|align|gather|multline|flalign|alignat)(\*?)\}([\s\S]*?)\\end\{\1\*?\}/g
const ANY_NUMBERED_ENV = /\\begin\{(?:equation|align|gather|multline|flalign|alignat)\*?\}/
const TAG = /\\tag\*?\s*\{([^{}]*)\}/
const LABEL = /\\label\s*\{([^{}]*)\}/g
const NO_NUMBER = /\\(?:notag|nonumber)\b/
/** 宏定义放进 equation 环境会变成局部定义,后面的公式用不到 */
const DEFINES = /\\(?:newcommand|renewcommand|def|gdef|let)\b/

/** 去掉 \label{…}(编号已由 equationLabels 记下)。 */
export function stripLabels(tex: string): string {
  return tex.replace(LABEL, '')
}

/**
 * 按文档顺序给块公式编号,返回「标签 → 编号文字」。
 * 手写 \tag 优先;AMS 规则只给 equation / align 等环境编号(多行环境每行一个,\notag 跳过);
 * 「全部编号」再给其余块公式各编一个号;「不编号」只认手写 \tag。
 */
export function equationLabels(texs: readonly string[], mode: AutoNumber): Map<string, string> {
  const labels = new Map<string, string>()
  const record = (source: string, value: string) => {
    for (const m of source.matchAll(LABEL)) labels.set(m[1].trim(), value)
  }
  let n = 0
  for (const tex of texs) {
    const manual = TAG.exec(tex)
    if (manual) {
      record(tex, manual[1].trim())
      continue
    }
    if (mode === 'none') continue
    let hasEnv = false
    for (const env of tex.matchAll(NUMBERED_ENV)) {
      hasEnv = true
      const [, name, star, body] = env
      if (star) continue
      const rows = name === 'equation' || name === 'multline' ? [body] : body.split(/\\\\/)
      rows.forEach((row, i) => {
        // 末尾 \\ 之后的空行不编号(与 KaTeX 一致)
        if (NO_NUMBER.test(row) || (i === rows.length - 1 && i > 0 && !row.trim())) return
        n++
        record(row, String(n))
      })
    }
    if (!hasEnv && mode === 'all' && !NO_NUMBER.test(tex) && !DEFINES.test(tex)) {
      n++
      record(tex, String(n))
    }
  }
  return labels
}

/** 把 \ref{…} 换成编号、\eqref{…} 换成带括号的编号;找不到的标签显示 ??(与 LaTeX 一致)。 */
export function resolveRefs(tex: string, labels: ReadonlyMap<string, string>): string {
  return tex.replace(/\\(eq)?ref\s*\{([^{}]*)\}/g, (_m, eq: string | undefined, key: string) => {
    const value = labels.get(key.trim()) ?? '??'
    return eq ? `\\text{(${value})}` : `\\text{${value}}`
  })
}

/** 「全部编号」:没有编号环境、\tag、\notag 的块公式包进 equation 环境,由 KaTeX 编号;含 \\ 换行时再包一层 gathered。 */
export function numberDisplayTex(tex: string, mode: AutoNumber): string {
  if (mode !== 'all' || !tex.trim()) return tex
  if (TAG.test(tex) || NO_NUMBER.test(tex) || ANY_NUMBERED_ENV.test(tex) || DEFINES.test(tex)) return tex
  const body = /\\\\|\\newline\b/.test(tex) ? `\\begin{gathered}${tex}\\end{gathered}` : tex
  return `\\begin{equation}${body}\\end{equation}`
}

/**
 * physics 宏包的常用命令(KaTeX 没有 physics,这里用宏实现一个子集;按 PM-21 覆盖同名原有宏,如 \div)。
 * \qty 依赖括号种类自动选定界符,宏写不出来,不提供。
 */
export const PHYSICS_MACROS: Readonly<Record<string, string>> = {
  '\\abs': '\\left\\lvert #1 \\right\\rvert',
  '\\norm': '\\left\\lVert #1 \\right\\rVert',
  '\\eval': '\\left. #1 \\right\\rvert',
  '\\order': '\\mathcal{O}\\left( #1 \\right)',
  '\\bra': '\\left\\langle #1 \\right\\rvert',
  '\\ket': '\\left\\lvert #1 \\right\\rangle',
  '\\braket': '\\left\\langle #1 \\middle\\vert #2 \\right\\rangle',
  '\\expval': '\\left\\langle #1 \\right\\rangle',
  '\\mel': '\\left\\langle #1 \\middle\\vert #2 \\middle\\vert #3 \\right\\rangle',
  '\\comm': '\\left[ #1 , #2 \\right]',
  '\\acomm': '\\left\\{ #1 , #2 \\right\\}',
  '\\dd': '\\mathrm{d}',
  '\\dv': '\\frac{\\mathrm{d} #1}{\\mathrm{d} #2}',
  '\\pdv': '\\frac{\\partial #1}{\\partial #2}',
  '\\grad': '\\nabla',
  '\\div': '\\nabla\\cdot',
  '\\curl': '\\nabla\\times',
  '\\laplacian': '\\nabla^2',
  '\\vb': '\\mathbf{#1}',
  '\\va': '\\vec{\\mathrm{#1}}',
  '\\vu': '\\hat{\\mathbf{#1}}',
  '\\vdot': '\\cdot',
  '\\cross': '\\times',
  '\\tr': '\\operatorname{tr}',
  '\\Tr': '\\operatorname{Tr}',
  '\\rank': '\\operatorname{rank}',
  '\\erf': '\\operatorname{erf}',
  '\\Res': '\\operatorname{Res}',
  '\\qq': '\\quad\\text{#1}\\quad',
}

/** 按开关把 physics 宏放进 / 移出共享宏表(用户自己 \newcommand 的同名宏不动)。 */
export function syncPhysicsMacros(macros: Record<string, string>, enabled: boolean): void {
  for (const [name, body] of Object.entries(PHYSICS_MACROS)) {
    if (enabled) {
      if (!(name in macros)) macros[name] = body
    } else if (macros[name] === body) delete macros[name]
  }
}
