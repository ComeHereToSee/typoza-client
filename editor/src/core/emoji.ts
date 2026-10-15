// 表情数据与搜索:数据在构建期从 emojibase 生成(build/emoji-data.ts),首次用到时按需加载。

export interface Emoji {
  char: string
  name: string
  zh: string
  keywords: string
  shortcodes: string[]
  group: number
}

export interface EmojiIndex {
  list: Emoji[]
  /** GitHub 短码 → 字符(Typora 的 :smile: 语法) */
  byShortcode: Map<string, string>
}

let loading: Promise<EmojiIndex> | null = null
let loaded: EmojiIndex | null = null

export function loadEmoji(): Promise<EmojiIndex> {
  loading ??= import('virtual:tz-emoji').then(({ default: rows }) => {
    const list = rows.map(([char, name, zh, keywords, shortcodes, group]) => ({ char, name, zh, keywords, shortcodes, group }))
    const byShortcode = new Map<string, string>()
    for (const e of list) for (const s of e.shortcodes) byShortcode.set(s, e.char)
    loaded = { list, byShortcode }
    return loaded
  })
  return loading
}

/** 已加载时同步取得数据(装饰插件用);未加载返回 null。 */
export function emojiIndexIfLoaded(): EmojiIndex | null {
  return loaded
}

/**
 * 按查询词找表情:短码全等 > 短码前缀 > 英文名前缀 > 中文名包含 > 英文名或关键词包含;同档按 Unicode 顺序。
 * 查询词不区分大小写,空格与下划线等价。
 */
export function searchEmoji(list: Emoji[], query: string, limit = 40): Emoji[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, '_')
  if (!q) return []
  const words = q.replace(/_/g, ' ')
  const ranked: { e: Emoji; rank: number; i: number }[] = []
  list.forEach((e, i) => {
    let rank = -1
    if (e.shortcodes.includes(q)) rank = 0
    else if (e.shortcodes.some((s) => s.startsWith(q))) rank = 1
    else if (e.name.toLowerCase().startsWith(words)) rank = 2
    else if (e.zh.includes(query.trim())) rank = 3
    else if (e.name.toLowerCase().includes(words) || e.keywords.includes(words) || e.shortcodes.some((s) => s.includes(q))) rank = 4
    if (rank >= 0) ranked.push({ e, rank, i })
  })
  ranked.sort((a, b) => a.rank - b.rank || a.i - b.i)
  return ranked.slice(0, limit).map((r) => r.e)
}
