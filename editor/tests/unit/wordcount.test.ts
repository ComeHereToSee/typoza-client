// 字数统计(PRD 3.2 字数、对照表 X-47、PA-05):中日韩按字、西文按词;阅读时间按偏好的阅读速度。
import { describe, expect, it } from 'vitest'
import { countWords } from '../../src/app/panels'

describe('countWords', () => {
  it('中日韩字符每字算一个词,西文按词', () => {
    const s = countWords('你好世界 hello world')
    expect(s.cjk).toBe(4)
    expect(s.words).toBe(6)
    expect(s.characters).toBe(16)
    expect(s.charactersNoSpace).toBe(14)
    expect(s.lines).toBe(1)
    expect(s.paragraphs).toBe(1)
  })

  it('撇号、连字符连在词里;日文假名与韩文也按字', () => {
    expect(countWords("don't stop well-known").words).toBe(3)
    expect(countWords('ひらがな 한국').cjk).toBe(6)
  })

  it('段落与行数', () => {
    const s = countWords('a\n\nb\n\n\nc')
    expect(s.paragraphs).toBe(3)
    expect(s.lines).toBe(6)
  })

  it('空文本', () => {
    expect(countWords('')).toMatchObject({ words: 0, characters: 0, lines: 0, paragraphs: 0, readingMinutes: 1 })
  })

  it('阅读时间按阅读速度(默认 382 字每分钟,不足 1 分钟按 1 分钟)', () => {
    const text = '字'.repeat(1000)
    expect(countWords(text).readingMinutes).toBe(3)
    expect(countWords(text, 120).readingMinutes).toBe(8)
    expect(countWords(text, 240).readingMinutes).toBe(4)
    expect(countWords('短', 382).readingMinutes).toBe(1)
  })
})
