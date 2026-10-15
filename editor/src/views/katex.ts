// KaTeX 按需加载;同一文档的公式共享宏定义(\newcommand 在后续公式里可用,与 Typora 一致)。
type Katex = typeof import('katex').default

let katexReady: Promise<Katex> | null = null
const macros: Record<string, string> = {}

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

export async function renderTex(tex: string, el: HTMLElement, displayMode: boolean): Promise<void> {
  const katex = await loadKatex()
  try {
    katex.render(tex, el, { displayMode, throwOnError: true, output: 'htmlAndMathml', trust: false, macros, globalGroup: true })
    el.classList.remove('is-error')
  } catch (err) {
    el.classList.add('is-error')
    el.textContent = err instanceof Error ? err.message : String(err)
  }
}
