import { describe, expect, it } from 'vitest'
import { loadEmoji, searchEmoji } from '../../src/core/emoji'
import { markdownHref } from '../../src/core/paths'
import { localDate } from '../../src/plugins/suggest'

describe('表情数据(构建期由 emojibase 生成)', () => {
  it('包含中英文名与 GitHub 短码,不含肤色等组件', async () => {
    const { list, byShortcode } = await loadEmoji()
    expect(list.length).toBeGreaterThan(1800)
    expect(byShortcode.get('smile')).toBe('😄')
    expect(byShortcode.get('+1')).toBe('👍️')
    expect(byShortcode.get('thumbsup')).toBe('👍️')
    expect(list.some((e) => e.group === 2)).toBe(false)
    const cat = list.find((e) => e.char === '🐱')
    expect(cat).toMatchObject({ zh: '猫脸', shortcodes: ['cat'] })
  })

  it('搜索排序:短码全等 > 短码前缀 > 英文名前缀 > 中文名 > 关键词', async () => {
    const { list } = await loadEmoji()
    expect(searchEmoji(list, 'smile')[0].char).toBe('😄')
    expect(searchEmoji(list, 'SMILE')[0].char).toBe('😄')
    expect(searchEmoji(list, '猫脸')[0].char).toBe('🐱')
    expect(searchEmoji(list, 'party popper')[0].char).toBe('🎉')
    expect(searchEmoji(list, 'tada')[0].char).toBe('🎉')
    expect(searchEmoji(list, '庆祝').length).toBeGreaterThan(0)
    expect(searchEmoji(list, '   ')).toEqual([])
    expect(searchEmoji(list, 'a', 5)).toHaveLength(5)
  })
})

describe('提及与链接', () => {
  it('日期按本地时区,跨月跨年', () => {
    const now = new Date(2026, 11, 31, 23, 30)
    expect(localDate(0, now)).toBe('2026-12-31')
    expect(localDate(1, now)).toBe('2027-01-01')
    expect(localDate(-1, new Date(2026, 2, 1))).toBe('2026-02-28')
  })

  it('文档链接地址:中文原样,空格括号等转义', () => {
    expect(markdownHref('另一篇.md')).toBe('另一篇.md')
    expect(markdownHref('../周报/第 1 周 (草稿).md')).toBe('../周报/第%201%20周%20%28草稿%29.md')
    expect(markdownHref('a#b?.md')).toBe('a%23b%3F.md')
  })
})
