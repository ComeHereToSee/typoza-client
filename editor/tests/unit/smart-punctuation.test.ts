// 智能标点(对照表 E-32 ~ E-34、PM-13、PM-14):直引号变弯引号,-- 变 –、--- 变 —(独占一行的 --- 仍是分割线)。
import { describe, expect, it } from 'vitest'
import { type SmartPunctuation, findReplacements, smartDash, smartQuote } from '../../src/core/smart-punctuation'

const sp: SmartPunctuation = { mode: 'render', quotes: true, doubleQuotes: '“”', singleQuotes: '‘’', dashes: true, dashRule: 'en-em' }

describe('智能标点', () => {
  it('按前一个字符决定左右引号;单引号在字母后是撇号', () => {
    expect(smartQuote('"', '', sp)).toBe('“')
    expect(smartQuote('"', ' ', sp)).toBe('“')
    expect(smartQuote('"', '(', sp)).toBe('“')
    expect(smartQuote('"', 'a', sp)).toBe('”')
    expect(smartQuote("'", 'n', sp)).toBe('’')
    expect(smartQuote("'", ' ', sp)).toBe('‘')
  })

  it('引号样式', () => {
    const fr = { ...sp, doubleQuotes: '«»', singleQuotes: '‹›' }
    expect(smartQuote('"', '', fr)).toBe('«')
    expect(smartQuote('"', '字', fr)).toBe('»')
    expect(smartQuote("'", ' ', fr)).toBe('‹')
  })

  it('破折号规则', () => {
    expect(smartDash('--', sp)).toBe('–')
    expect(smartDash('---', sp)).toBe('—')
    expect(smartDash('--', { ...sp, dashRule: 'em' })).toBe('—')
  })

  it('渲染时转换:找出要替换的位置', () => {
    expect(findReplacements('他说 "你好" -- 再见', sp)).toEqual([
      { from: 3, to: 4, text: '“' },
      { from: 6, to: 7, text: '”' },
      { from: 8, to: 10, text: '–' },
    ])
    // 连字符后面没有字(行末)或超过 3 个时不转
    expect(findReplacements('a---', sp)).toEqual([])
    expect(findReplacements('a----b', sp)).toEqual([])
    expect(findReplacements('a---b', sp)).toEqual([{ from: 1, to: 4, text: '—' }])
  })

  it('行内代码里不转换;关掉引号或破折号时只转另一种', () => {
    const text = 'x "y" z'
    const mask = [false, false, true, true, true, false, false]
    expect(findReplacements(text, sp, mask)).toEqual([])
    expect(findReplacements('"a" -- b', { ...sp, quotes: false })).toEqual([{ from: 4, to: 6, text: '–' }])
    expect(findReplacements('"a" -- b', { ...sp, dashes: false })).toHaveLength(2)
  })
})
