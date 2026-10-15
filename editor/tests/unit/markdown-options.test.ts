// 偏好「Markdown」「编辑器」页里接到解析 / 序列化的选项(对照表 PM-01 ~ PM-05、PM-10 ~ PM-11、PE-01、PE-07)。
import type { Node as PMNode } from 'prosemirror-model'
import { describe, expect, it } from 'vitest'
import { type ParseOptions, parseMarkdown } from '../../src/core/markdown/parse'
import { type SerializeOptions, serializeMarkdown } from '../../src/core/markdown/serialize'
import { schema } from '../../src/core/schema'
import { parseOptionsFrom, serializeOptionsFrom } from '../../src/app/markdown-prefs'
import { DEFAULT_SETTINGS } from '../../src/app/settings'

const base: ParseOptions = { inlineMath: true }
const ser: SerializeOptions = { inlineMath: true, ensureTrailingNewline: false }

function types(doc: PMNode): string[] {
  const out: string[] = []
  doc.forEach((n) => out.push(n.type.name))
  return out
}

function hasMark(doc: PMNode, mark: string): boolean {
  let found = false
  doc.descendants((n) => {
    if (n.marks.some((m) => m.type.name === mark)) found = true
  })
  return found
}

/** 新建(未从原文解析)的文档按选项序列化;空原文没有结尾换行。 */
function write(blocks: PMNode[], options: Partial<SerializeOptions> = {}): string {
  const doc = schema.nodes.doc.create(null, blocks)
  const meta = parseMarkdown('', base).meta
  return serializeMarkdown(doc, meta, { ...ser, ...options })
}

const p = (text: string) => schema.nodes.paragraph.create(null, schema.text(text))
const li = (text: string) => schema.nodes.list_item.create(null, p(text))

describe('解析选项', () => {
  it('高亮可以关掉:==文字== 按普通文字显示,原文不变', () => {
    const md = '要 ==高亮== 的字\n'
    expect(hasMark(parseMarkdown(md, base).doc, 'highlight')).toBe(true)
    const { doc, meta } = parseMarkdown(md, { ...base, highlight: false })
    expect(hasMark(doc, 'highlight')).toBe(false)
    expect(doc.textContent).toBe('要 ==高亮== 的字')
    expect(serializeMarkdown(doc, meta, ser)).toBe(md)
  })

  it('警报框可以关掉:> [!NOTE] 显示为普通引用,内部照常识别', () => {
    const md = '> [!NOTE]\n> 带 **加粗** 的提示\n'
    expect(types(parseMarkdown(md, base).doc)).toEqual(['callout'])
    const { doc, meta } = parseMarkdown(md, { ...base, alerts: false })
    expect(types(doc)).toEqual(['blockquote'])
    expect(doc.textContent).toContain('[!NOTE]')
    expect(hasMark(doc, 'strong')).toBe(true)
    expect(serializeMarkdown(doc, meta, ser)).toBe(md)
  })

  it('自动识别链接可以关掉:裸网址是普通文字,写回时不加转义', () => {
    const md = '见 https://example.com/a 与 www.example.org\n'
    expect(hasMark(parseMarkdown(md, base).doc, 'link')).toBe(true)
    const { doc, meta } = parseMarkdown(md, { ...base, autolink: false })
    expect(hasMark(doc, 'link')).toBe(false)
    expect(doc.textContent).toBe('见 https://example.com/a 与 www.example.org')
    // 编辑过(重新生成)的段落里网址也原样写回
    const rebuilt = schema.nodeFromJSON(doc.toJSON())
    expect(serializeMarkdown(rebuilt, meta, { ...ser, autolink: false })).toBe(md)
  })

  it('尖括号链接不受「自动识别链接」影响', () => {
    const { doc } = parseMarkdown('<https://example.com>\n', { ...base, autolink: false })
    expect(hasMark(doc, 'link')).toBe(true)
  })

  it('严格模式默认开;关掉后 #标题(# 后没有空格)也是标题', () => {
    expect(types(parseMarkdown('#标题\n', base).doc)).toEqual(['paragraph'])
    const { doc } = parseMarkdown('#标题\n\n##二级 **粗**\n\n正文 #话题\n', { ...base, strict: false })
    expect(types(doc)).toEqual(['heading', 'heading', 'paragraph'])
    expect(doc.child(0).attrs.level).toBe(1)
    expect(doc.child(0).textContent).toBe('标题')
    expect(doc.child(1).attrs.level).toBe(2)
    expect(hasMark(doc.child(1), 'strong')).toBe(true)
  })

  it('偏好设置映射到解析选项', () => {
    expect(parseOptionsFrom(DEFAULT_SETTINGS)).toEqual({
      inlineMath: true,
      subscript: false,
      superscript: false,
      highlight: true,
      alerts: true,
      autolink: true,
      strict: true,
    })
  })
})

describe('序列化选项(只影响新建或编辑过的块)', () => {
  const h1 = () => schema.nodes.heading.create({ level: 1 }, schema.text('标题'))
  const h3 = () => schema.nodes.heading.create({ level: 3 }, schema.text('三级'))

  it('标题样式:atx / atx 带后缀 / setext / 可变宽 setext', () => {
    expect(write([h1()])).toBe('# 标题')
    expect(write([h1()], { headingStyle: 'atx-closed' })).toBe('# 标题 #')
    expect(write([h1()], { headingStyle: 'setext' })).toBe('标题\n===')
    expect(write([schema.nodes.heading.create({ level: 1 }, schema.text('Long title'))], { headingStyle: 'setext-variable' })).toBe('Long title\n==========')
    // setext 只有一、二级,三级以下仍写 #
    expect(write([h3()], { headingStyle: 'setext' })).toBe('### 三级')
  })

  it('无序列表符号:原文没有无序列表时按偏好,有则沿用原文', () => {
    const list = () => schema.nodes.bullet_list.create(null, [li('a'), li('b')])
    expect(write([list()], { bullet: '+' })).toBe('+ a\n+ b')
    const { doc, meta } = parseMarkdown('* 原有\n', base)
    const edited = schema.nodes.doc.create(null, [...doc.content.content, p('段'), list()])
    expect(serializeMarkdown(edited, meta, { ...ser, bullet: '+' })).toBe('* 原有\n\n段\n\n* a\n* b\n')
  })

  it('有序列表编号:1. 2. 3. 或 1. 1. 1.', () => {
    const list = () => schema.nodes.ordered_list.create({ start: 1 }, [li('一'), li('二')])
    expect(write([list()])).toBe('1. 一\n2. 二')
    expect(write([list()], { incrementListMarker: false })).toBe('1. 一\n1. 二')
  })

  it('默认缩进:与列表标记对齐 / 4 个空格', () => {
    const list = () => schema.nodes.bullet_list.create(null, [li('a')])
    expect(write([list()], { bullet: '-' })).toBe('- a')
    expect(write([list()], { bullet: '-', listItemIndent: 'tab' })).toBe('-   a')
  })

  it('偏好设置映射到序列化选项', () => {
    expect(serializeOptionsFrom({ ...DEFAULT_SETTINGS, headingStyle: 'setext', listBullet: '*', orderedListIncrement: false, listIndent: 'tab' })).toEqual({
      inlineMath: true,
      ensureTrailingNewline: true,
      headingStyle: 'setext',
      bullet: '*',
      incrementListMarker: false,
      listItemIndent: 'tab',
      autolink: true,
    })
  })
})
