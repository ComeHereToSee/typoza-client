import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Node as PMNode } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { parseMarkdown } from '../../src/core/markdown/parse'
import { serializeMarkdown } from '../../src/core/markdown/serialize'
import { schema } from '../../src/core/schema'

const parseOpts = { inlineMath: true }
const serOpts = { inlineMath: true, ensureTrailingNewline: false }

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')
}

/** 用 JSON 重建文档:所有节点都是新对象,不再命中原文缓存,相当于「每个块都被编辑过」。 */
function rebuild(doc: PMNode): PMNode {
  return schema.nodeFromJSON(doc.toJSON())
}

function semanticRoundTrip(md: string) {
  const a = parseMarkdown(md, parseOpts)
  const out = serializeMarkdown(rebuild(a.doc), a.meta, serOpts)
  const b = parseMarkdown(out, parseOpts)
  return { a: a.doc.toJSON(), b: b.doc.toJSON(), out }
}

function find(doc: PMNode, type: string): PMNode[] {
  const out: PMNode[] = []
  doc.descendants((n) => {
    if (n.type.name === type) out.push(n)
  })
  return out
}

function marksOf(doc: PMNode, text: string): string[] {
  let found: string[] | null = null
  doc.descendants((n) => {
    if (n.isText && n.text === text) found = n.marks.map((m) => m.type.name)
  })
  if (!found) throw new Error(`文档里没有文本「${text}」`)
  return found
}

describe('原文保真:未编辑的文档原样写回', () => {
  const cases: Record<string, string> = {
    语料: fixture('typora-corpus.md'),
    CRLF: '# 标题\r\n\r\n段落一\r\n段落二\r\n',
    BOM: '\uFEFF# 带 BOM\n',
    无结尾换行: '段落',
    多空行: '\n\n# 前导空行\n\n\n\n段落\n\n\n',
    星号列表: '* a\n* b\n\n  c\n',
  }
  for (const [name, md] of Object.entries(cases)) {
    it(name, () => {
      const { doc, meta } = parseMarkdown(md, parseOpts)
      expect(serializeMarkdown(doc, meta, serOpts)).toBe(md)
    })
  }

  it('只改一个块时,其它块逐字不变', () => {
    const md = '# 标题\n\n*  奇怪缩进的列表\n*  第二项\n\n要修改的段落\n\n尾段  \n'
    const { doc, meta } = parseMarkdown(md, parseOpts)
    let end = -1
    doc.forEach((n, offset) => {
      if (n.textContent === '要修改的段落') end = offset + 1 + n.content.size
    })
    const edited = EditorState.create({ doc }).tr.insertText('!', end).doc
    expect(serializeMarkdown(edited, meta, serOpts)).toBe('# 标题\n\n*  奇怪缩进的列表\n*  第二项\n\n要修改的段落!\n\n尾段  \n')
  })
})

describe('Typora 扩展语法识别', () => {
  const { doc } = parseMarkdown(fixture('typora-corpus.md'), parseOpts)

  it('高亮、上下标、下划线、颜色、删除线', () => {
    expect(marksOf(doc, '高亮')).toEqual(['highlight'])
    expect(marksOf(doc, '2')).toEqual(['sup'])
    expect(marksOf(doc, '删除线')).toEqual(['strike'])
    expect(marksOf(doc, '下划线')).toEqual(['underline'])
    expect(marksOf(doc, '红字')).toEqual(['color'])
    const sub = find(doc, 'paragraph').flatMap((p) => {
      const r: string[] = []
      p.forEach((c) => {
        if (c.marks.some((m) => m.type.name === 'sub')) r.push(c.text ?? '')
      })
      return r
    })
    expect(sub).toContain('2')
  })

  it('转义的定界符保持为文本', () => {
    const text = find(doc, 'paragraph').map((p) => p.textContent).find((t) => t.startsWith('转义的'))
    expect(text).toBe('转义的 ==不是高亮== 与 ^不是上标^。')
  })

  it('front matter、目录、提示框、折叠块', () => {
    expect(doc.firstChild?.type.name).toBe('frontmatter')
    expect(find(doc, 'toc')).toHaveLength(1)
    const callouts = find(doc, 'callout')
    expect(callouts.map((c) => [c.attrs.kind, c.attrs.title])).toEqual([
      ['note', ''],
      ['warning', '自定义标题'],
    ])
    expect(callouts[0].textContent).toBe('提示框内容')
    const toggle = find(doc, 'toggle')[0]
    expect(toggle.firstChild?.textContent).toBe('折叠标题')
    expect(toggle.lastChild?.textContent).toBe('折叠内容')
  })

  it('媒体块与 HTML 图片', () => {
    const media = find(doc, 'media').map((m) => [m.attrs.kind, m.attrs.src])
    expect(media).toEqual([
      ['video', 'assets/demo.mp4'],
      ['embed', 'https://www.youtube.com/embed/abc'],
      ['bookmark', 'https://example.com'],
    ])
    const zoomed = find(doc, 'image').find((i) => i.attrs.src === 'assets/b.png')
    expect(zoomed?.attrs).toMatchObject({ zoom: '50%', html: true, alt: '缩放图' })
  })

  it('表格对齐与单元格换行', () => {
    const table = find(doc, 'table')[0]
    expect(table.firstChild?.content.content.map((c) => c.attrs.align)).toEqual(['left', 'center', 'right'])
    expect(find(table, 'hard_break')[0].attrs.syntax).toBe('html')
  })

  it('任务列表、wikilink、脚注、公式、引用定义', () => {
    expect(find(doc, 'list_item').map((li) => li.attrs.checked).filter((c) => c !== null)).toEqual([false, true])
    expect(find(doc, 'wikilink').map((w) => [w.attrs.target, w.attrs.alias])).toEqual([
      ['另一篇', '别名'],
      ['笔记', null],
    ])
    expect(find(doc, 'footnote_ref')[0].attrs.label).toBe('1')
    expect(find(doc, 'footnote_def')[0].textContent).toBe('脚注内容。')
    expect(find(doc, 'math_inline')[0].attrs.tex).toBe('E=mc^2')
    expect(find(doc, 'math_block')[0].textContent).toBe('\\int_0^1 x\\,dx')
    expect(find(doc, 'definition')[0].attrs).toMatchObject({ label: 'doc', url: 'https://example.com/doc' })
    expect(find(doc, 'code_block')[0].attrs).toMatchObject({ language: 'js', meta: '{1,3}' })
  })

  it('换行的三种写法分别记录', () => {
    const syntaxes = find(doc, 'hard_break').map((b) => b.attrs.syntax)
    expect(syntaxes).toEqual(expect.arrayContaining(['html', 'spaces', 'backslash']))
  })
})

describe('语义往返:每个块都重新生成后再解析,结构不变', () => {
  it('Typora 语料', () => {
    const { a, b, out } = semanticRoundTrip(fixture('typora-corpus.md'))
    expect(b, out).toEqual(a)
  })

  it('相邻的两个同类列表不会被合并', () => {
    const { a, b, out } = semanticRoundTrip('- a\n- b\n\n<!-- -->\n\n- c\n')
    expect(b, out).toEqual(a)
  })

  const spec = JSON.parse(fixture('commonmark-spec.json')) as { markdown: string; example: number; section: string }[]
  // 已知无法语义往返的用例:见 docs/knowledge/pitfalls(随 CI 结果维护,每条写原因)
  const known = new Set<number>([])
  for (const ex of spec) {
    const name = `CommonMark #${ex.example} ${ex.section}`
    if (known.has(ex.example)) {
      it.skip(name)
      continue
    }
    it(name, () => {
      const { a, b, out } = semanticRoundTrip(ex.markdown)
      expect(b, `输入:\n${ex.markdown}\n输出:\n${out}`).toEqual(a)
    })
  }
})
