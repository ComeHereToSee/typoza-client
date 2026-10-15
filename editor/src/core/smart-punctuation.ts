// 智能标点(Typora 偏好 E-32 ~ E-34、PM-13、PM-14):直引号变弯引号,-- / --- 变短 / 长破折号。
// 输入时转换由 inputrules.ts 改写字符;渲染时转换由 plugins/smart-punctuation.ts 只改显示,文件里保留 ASCII。

export interface SmartPunctuation {
  /** off:不转换;input:输入时改写字符;render:只在显示时替换 */
  mode: 'off' | 'input' | 'render'
  quotes: boolean
  /** 左右双引号(两个字符) */
  doubleQuotes: string
  /** 左右单引号(两个字符) */
  singleQuotes: string
  dashes: boolean
  /** en-em:-- 转 –、--- 转 —;em:-- 与 --- 都转 — */
  dashRule: 'en-em' | 'em'
}

export const SMART_PUNCTUATION_OFF: SmartPunctuation = { mode: 'off', quotes: false, doubleQuotes: '“”', singleQuotes: '‘’', dashes: false, dashRule: 'en-em' }

// 引号前是这些字符(或在块首)时是左引号:空白、左括号类、连字符与破折号、另一个左引号、行内节点占位符 U+FFFC
const OPENING_CONTEXT = /[\s([{<\-\u{2013}\u{2014}\u{201C}\u{2018}\u{00AB}\u{2039}\u{201E}\u{201A}\u{300C}\u{300E}\u{FF08}\u{3010}\u{300A}\u{FFFC}]/u

/** 直引号 → 弯引号:prev 是引号前一个字符(块首为空串)。单引号在字母后是撇号(don't),与右单引号同形。 */
export function smartQuote(quote: '"' | "'", prev: string, sp: SmartPunctuation): string {
  const pair = quote === '"' ? sp.doubleQuotes : sp.singleQuotes
  const chars = Array.from(pair)
  const open = chars[0] ?? quote
  const close = chars[1] ?? open
  return prev === '' || OPENING_CONTEXT.test(prev) ? open : close
}

/** 连字符串 → 破折号:dashes 为 '--' 或 '---'。 */
export function smartDash(dashes: string, sp: SmartPunctuation): string {
  return dashes.length === 3 || sp.dashRule === 'em' ? '\u{2014}' : '\u{2013}'
}

/** Typora 的引号样式(PM-13 各 8 种):值是左右两个引号。 */
export const DOUBLE_QUOTE_STYLES = ['“”', '„“', '„”', '«»', '»«', '»»', '””', '「」']
export const SINGLE_QUOTE_STYLES = ['‘’', '‚‘', '‚’', '‹›', '›‹', '››', '’’', '『』']

export interface SmartReplacement {
  /** 在文本里的偏移 */
  from: number
  to: number
  text: string
}

/**
 * 一段纯文本里需要替换的位置(渲染时转换用)。text 里非文字的行内节点用 U+FFFC 占位,codeMask[i] 为 true 的字符(行内代码)不转换。
 * 规则与输入时转换一致:-- / --- 后面跟非连字符才转;整段只有 --- 的情况在 Markdown 里本来就是分割线,不会出现在文字里。
 */
export function findReplacements(text: string, sp: SmartPunctuation, codeMask?: boolean[]): SmartReplacement[] {
  const out: SmartReplacement[] = []
  const skip = (i: number) => codeMask?.[i] === true
  for (let i = 0; i < text.length; i++) {
    if (skip(i)) continue
    const ch = text[i]
    if (sp.quotes && (ch === '"' || ch === "'")) {
      out.push({ from: i, to: i + 1, text: smartQuote(ch, i === 0 ? '' : text[i - 1], sp) })
      continue
    }
    if (sp.dashes && ch === '-' && text[i - 1] !== '-') {
      let j = i
      while (j < text.length && text[j] === '-' && !skip(j)) j++
      const run = j - i
      if ((run === 2 || run === 3) && j < text.length) {
        out.push({ from: i, to: j, text: smartDash(text.slice(i, j), sp) })
      }
      i = j - 1
    }
  }
  return out
}
