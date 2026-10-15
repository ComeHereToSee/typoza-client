// 构建期生成表情数据(虚拟模块 virtual:tz-emoji):从 emojibase-data(CLDR 英文 / 中文名称与关键词、
// GitHub 短码)裁剪出编辑器需要的字段,去掉肤色变体与「组件」类,按 Unicode 推荐顺序排列。
// 不提交生成文件:每次构建从依赖现算,数据来源可追溯。
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'

interface CompactEmoji {
  hexcode: string
  label: string
  unicode: string
  group?: number
  order?: number
  tags?: string[]
}

const VIRTUAL_ID = 'virtual:tz-emoji'
/** emojibase 的第 2 组是肤色、发型等组件,单独插入没有意义 */
const COMPONENT_GROUP = 2

export function emojiData(): Plugin {
  const require = createRequire(import.meta.url)
  const read = <T>(file: string): T => JSON.parse(readFileSync(require.resolve(`emojibase-data/${file}`), 'utf8')) as T
  return {
    name: 'tz-emoji-data',
    resolveId: (id) => (id === VIRTUAL_ID ? `\0${VIRTUAL_ID}` : undefined),
    load(id) {
      if (id !== `\0${VIRTUAL_ID}`) return undefined
      const en = read<CompactEmoji[]>('en/compact.json')
      const zh = new Map(read<CompactEmoji[]>('zh/compact.json').map((e) => [e.hexcode, e]))
      const github = read<Record<string, string | string[]>>('en/shortcodes/github.json')
      const rows = en
        .filter((e) => e.group !== undefined && e.group !== COMPONENT_GROUP)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((e) => {
          const z = zh.get(e.hexcode)
          const codes = github[e.hexcode]
          const keywords = [...new Set([...(e.tags ?? []), ...(z?.tags ?? [])])].join(' ').toLowerCase()
          // [字符, 英文名, 中文名, 关键词, GitHub 短码, 分组]
          return [e.unicode, e.label, z?.label ?? '', keywords, codes === undefined ? [] : Array.isArray(codes) ? codes : [codes], e.group]
        })
      return `export default ${JSON.stringify(rows)}`
    },
  }
}
