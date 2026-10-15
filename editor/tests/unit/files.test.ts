import { describe, expect, it } from 'vitest'
import { excerptOf, firstHeadingOf, plainText } from '../../src/core/excerpt'
import { bundleOf, displayName, isOpenable, isTextBundle, isTextDocument, TEXT_EXTENSIONS } from '../../src/core/filetypes'
import { findAnchor } from '../../src/core/links'
import { parseMarkdown } from '../../src/core/markdown/parse'
import { rewriteLinks } from '../../src/app/linkrewrite'
import { formatVersionTime, renderVersionPreview } from '../../src/app/historypanel'
import { outlineRows, sortFiles } from '../../src/app/sidebar'
import type { HeadingItem } from '../../src/core/blocks'
import type { FileStat } from '../../src/host/types'

describe('可打开的文件类型(对照表 F-04、X-53)', () => {
  it('扩展名清单与 PRD 一致', () => {
    expect(TEXT_EXTENSIONS).toEqual(['md', 'markdown', 'mmd', 'mdown', 'mkd', 'mdwn', 'mdtxt', 'mdtext', 'txt', 'text', 'rmd', 'rmarkdown'])
    for (const ext of TEXT_EXTENSIONS) expect(isTextDocument(`/a/笔记.${ext.toUpperCase()}`)).toBe(true)
    expect(isTextDocument('/a/图.png')).toBe(false)
  })

  it('TextBundle 是一个文档,标题取包名', () => {
    expect(isTextBundle('/a/游记.textbundle')).toBe(true)
    expect(isOpenable('/a/游记.textbundle')).toBe(true)
    expect(bundleOf('/a/游记.textbundle/text.md')).toBe('/a/游记.textbundle')
    expect(bundleOf('/a/笔记.md')).toBeNull()
    expect(displayName('/a/游记.textbundle/text.md')).toBe('游记')
    expect(displayName('/a/笔记.md')).toBe('笔记')
    expect(displayName('/a/笔记.txt')).toBe('笔记.txt')
  })
})

describe('标题与摘要', () => {
  it('第一个标题:跳过 front matter 与代码块,支持 Setext', () => {
    expect(firstHeadingOf('---\ntitle: x\n---\n\n```\n# 不是标题\n```\n\n## **第二** 节 ##\n')).toBe('第二 节')
    expect(firstHeadingOf('季度总结\n====\n\n正文')).toBe('季度总结')
    expect(firstHeadingOf('#标签 不是标题\n\n正文')).toBeNull()
    expect(firstHeadingOf('\uFEFF# 带 BOM\n')).toBe('带 BOM')
  })

  it('首段摘要:跳过标题、图片、表格,去掉标记', () => {
    const md = '# 标题\n\n![图](a.png)\n\n| a | b |\n| - | - |\n\n> [!TIP]\n> 这是**提示**,见 [链接](x.md) 与 [[另一篇|别名]]。\n\n第二段'
    expect(excerptOf(md)).toBe('这是提示,见 链接 与 别名。')
    expect(excerptOf('# 只有标题\n')).toBe('')
    expect(excerptOf(`正文${'字'.repeat(200)}`, 10)).toBe(`正文${'字'.repeat(8)}…`)
  })

  it('plainText 去掉行内标记', () => {
    expect(plainText('**粗** `码` ==亮== <u>下</u> ![图](a.png)')).toBe('粗 码 亮 下 图')
  })
})

describe('改名联动:改写指向它的链接(PRD 3.8)', () => {
  it('相对链接、图片、引用定义、HTML、省略 .md 的写法都改,其余字节不动', () => {
    const doc = '/r/docs/索引.md'
    const text = [
      '见 [旧文](../notes/旧文.md#第一节) 与 [省略](../notes/旧文) 。',
      '![图](../notes/旧文.md)',
      '[ref]: <../notes/旧文.md> "标题"',
      '<a href="../notes/旧文.md">html</a>',
      '[别的](../notes/别的.md) [网址](https://example.com/旧文.md)',
      '```',
      '[代码里](../notes/旧文.md)',
      '```',
    ].join('\n')
    const r = rewriteLinks(text, doc, '/r/notes/旧文.md', '/r/归档/新 文.md')
    expect(r.count).toBe(5)
    expect(r.text.split('\n')).toEqual([
      '见 [旧文](../归档/新%20文.md#第一节) 与 [省略](../归档/新%20文) 。',
      '![图](../归档/新%20文.md)',
      '[ref]: <../归档/新%20文.md> "标题"',
      '<a href="../归档/新 文.md">html</a>',
      '[别的](../notes/别的.md) [网址](https://example.com/旧文.md)',
      '```',
      '[代码里](../notes/旧文.md)',
      '```',
    ])
  })

  it('文件夹改名:里面的文件链接一起改;wikilink 只在文件改名时改', () => {
    const moved = rewriteLinks('[a](notes/a.md) [[a]]', '/r/x.md', '/r/notes', '/r/笔记')
    expect(moved).toEqual({ text: '[a](笔记/a.md) [[a]]', count: 1 })
    const renamed = rewriteLinks('[[旧名]] [[旧名#节|别名]] [[别的]]', '/r/x.md', '/r/旧名.md', '/r/新名.md')
    expect(renamed).toEqual({ text: '[[新名]] [[新名#节|别名]] [[别的]]', count: 2 })
  })

  it('与它无关的文档不变', () => {
    const text = '# 标题\n\n[a](b.md)\n'
    expect(rewriteLinks(text, '/r/x.md', '/r/c.md', '/r/d.md')).toEqual({ text, count: 0 })
  })
})

describe('文内锚点(对照表 X-09)', () => {
  it('先找标题,重名加序号;再找 <a id> 命名锚点', () => {
    const { doc } = parseMarkdown('# 介绍\n\n## 介绍\n\n段落 <a id="here"></a> 结尾\n', { inlineMath: true })
    const first = findAnchor(doc, '介绍')
    const second = findAnchor(doc, '介绍-1')
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(second!).toBeGreaterThan(first!)
    const named = findAnchor(doc, 'here')
    expect(named).not.toBeNull()
    expect(doc.nodeAt(named!)?.type.name).toBe('html_inline')
    expect(findAnchor(doc, '%E4%BB%8B%E7%BB%8D')).toBe(first)
    expect(findAnchor(doc, '没有')).toBeNull()
  })
})

describe('文档列表排序(对照表 S-04)', () => {
  const stat = (path: string, mtime: number, ctime: number): FileStat => ({ path, name: path.slice(path.lastIndexOf('/') + 1), isDir: false, size: 1, mtime, ctime })
  const files = [stat('/r/b10.md', 3, 1), stat('/r/b2.md', 1, 3), stat('/r/a/c.md', 2, 2)]
  const order = (by: Parameters<typeof sortFiles>[1], desc: boolean) => sortFiles(files, by, desc, '/r').map((s) => s.path)

  it('四种排序各分升降序', () => {
    expect(order('natural', false)).toEqual(['/r/a/c.md', '/r/b2.md', '/r/b10.md'])
    expect(order('name', false)).toEqual(['/r/b10.md', '/r/b2.md', '/r/a/c.md'])
    expect(order('mtime', true)).toEqual(['/r/b10.md', '/r/a/c.md', '/r/b2.md'])
    expect(order('ctime', false)).toEqual(['/r/b10.md', '/r/a/c.md', '/r/b2.md'])
    expect(order('natural', true)).toEqual(['/r/b10.md', '/r/b2.md', '/r/a/c.md'])
  })
})

describe('大纲折叠(对照表 S-01)', () => {
  const heading = (level: number, text: string): HeadingItem => ({ level, text, pos: 0, id: text })
  const headings = [heading(1, 'A'), heading(2, 'A1'), heading(3, 'A1a'), heading(2, 'A2'), heading(1, 'B')]

  it('折叠的标题下级都隐藏,同级与上级不受影响', () => {
    const rows = outlineRows(headings, new Set(['A1']))
    expect(rows.map((r) => [r.item.text, r.depth, r.hasChildren, r.hidden])).toEqual([
      ['A', 0, true, false],
      ['A1', 1, true, false],
      ['A1a', 2, false, true],
      ['A2', 1, false, false],
      ['B', 0, false, false],
    ])
    expect(outlineRows(headings, new Set(['A'])).filter((r) => r.hidden).map((r) => r.item.text)).toEqual(['A1', 'A1a', 'A2'])
  })
})

describe('历史版本预览', () => {
  it('时间按 PRD 写法', () => {
    expect(formatVersionTime(new Date(2026, 9, 16, 14, 30, 5).getTime())).toBe('2026-10-16 14:30')
  })

  it('标出这个版本多出、少了的行', () => {
    const box = renderVersionPreview('a\nb\nc', 'a\nB\nc\nd')
    expect(box.querySelector('.tz-diff-summary')?.textContent).toBe('与当前内容相比:这个版本多 2 行、少 1 行')
    expect([...box.querySelectorAll('.is-removed')].map((x) => x.textContent)).toEqual(['b'])
    expect([...box.querySelectorAll('.is-added')].map((x) => x.textContent)).toEqual(['B', 'd'])
    expect(renderVersionPreview('x', 'x').querySelector('.tz-diff-summary')?.textContent).toBe('与当前内容相同')
    expect(renderVersionPreview(null, 'x').querySelector('.tz-diff-plain')?.textContent).toBe('x')
  })
})
