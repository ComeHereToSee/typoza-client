import type { Node as PMNode } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { blockRanges, docPosToSource, sourceToDocPos } from '../../src/app/sourcemap'
import { parseMarkdown } from '../../src/core/markdown/parse'
import { serializeMarkdown } from '../../src/core/markdown/serialize'
import { buildPattern, findMatches } from '../../src/plugins/find'

const opts = { inlineMath: true, ensureTrailingNewline: true }
const MD = '# 标题\n\n第一段 **粗体** 结尾\n\n- 项目一\n- 项目二\n'

/** 文档里某段文字之后的位置 */
function after(doc: PMNode, text: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return found < 0
    const i = node.text!.indexOf(text)
    if (i >= 0) found = pos + i + text.length
    return false
  })
  if (found < 0) throw new Error(`文档里没有「${text}」`)
  return found
}

describe('源代码模式光标映射(PRD 3.10)', () => {
  it('顶层块在原文里的范围与序列化结果一致', () => {
    const { doc, meta } = parseMarkdown(MD, { inlineMath: true })
    expect(blockRanges(doc, meta, opts)).toEqual([
      { from: 0, to: 4 },
      { from: 6, to: 19 },
      { from: 21, to: 34 },
    ])
  })

  it('文档 → 原文:跳过标记符,光标在标题开头时放到 # 之后', () => {
    const { doc, meta } = parseMarkdown(MD, { inlineMath: true })
    const text = serializeMarkdown(doc, meta, opts)
    expect(text).toBe(MD)
    expect(text.slice(0, docPosToSource(doc, after(doc, '粗体'), text, meta, opts))).toMatch(/\*\*粗体\*\*$/)
    expect(docPosToSource(doc, 1, text, meta, opts)).toBe(2)
    const inList = docPosToSource(doc, after(doc, '项目二') - 1, text, meta, opts)
    expect(text.slice(inList - 2, inList + 1)).toBe('项目二')
  })

  it('原文 → 文档:来回切换回到同一位置', () => {
    const { doc, meta } = parseMarkdown(MD, { inlineMath: true })
    for (const target of ['粗体', '第一段', '项目一', '结尾']) {
      const pos = after(doc, target)
      const offset = docPosToSource(doc, pos, MD, meta, opts)
      expect(sourceToDocPos(doc, offset, MD, meta, opts)).toBe(pos)
    }
    // 落在块与块之间的空行里:放到下一个块开头
    expect(sourceToDocPos(doc, 5, MD, meta, opts)).toBe(after(doc, '第') - 1)
  })

  it('改过的块(重新生成原文)也能映射', () => {
    const parsed = parseMarkdown(MD, { inlineMath: true })
    const state = EditorState.create({ doc: parsed.doc })
    const doc = state.apply(state.tr.insertText('新', after(parsed.doc, '第') - 1)).doc
    const text = serializeMarkdown(doc, parsed.meta, opts)
    expect(text).toContain('新第一段 **粗体** 结尾')
    expect(text.slice(0, docPosToSource(doc, after(doc, '粗体'), text, parsed.meta, opts))).toMatch(/新第一段 \*\*粗体\*\*$/)
  })

  it('带 BOM 的文件:偏移多算文首一个字符', () => {
    const md = `\uFEFF${MD}`
    const { doc, meta } = parseMarkdown(md, { inlineMath: true })
    const offset = docPosToSource(doc, 1, md, meta, opts)
    expect(offset).toBe(3)
    expect(sourceToDocPos(doc, offset, md, meta, opts)).toBe(1)
  })
})

describe('文内查找(find.ts)', () => {
  const base = { caseSensitive: false, wholeWord: false, regex: false }

  it('buildPattern:空查询为 null;普通文字按字面匹配;大小写与全词', () => {
    expect(buildPattern({ ...base, query: '' })).toBeNull()
    expect(buildPattern({ ...base, query: 'a.b' })!.test('axb')).toBe(false)
    expect(buildPattern({ ...base, query: 'a.b' })!.test('a.b')).toBe(true)
    expect('Cat cat'.match(buildPattern({ ...base, query: 'cat' })!)).toEqual(['Cat', 'cat'])
    expect('Cat cat'.match(buildPattern({ ...base, query: 'cat', caseSensitive: true })!)).toEqual(['cat'])
    expect('cat category'.match(buildPattern({ ...base, query: 'cat', wholeWord: true })!)).toEqual(['cat'])
    expect('a1 b22'.match(buildPattern({ ...base, query: '\\d+', regex: true })!)).toEqual(['1', '22'])
  })

  it('findMatches:返回文档位置,行内公式等原子节点不打乱偏移;正则有误时报错', () => {
    const { doc } = parseMarkdown('foo $x$ foo\n\n# Foo\n', { inlineMath: true })
    const { matches, error } = findMatches(doc, { ...base, query: 'foo' })
    expect(error).toBeNull()
    expect(matches.map((m) => doc.textBetween(m.from, m.to))).toEqual(['foo', 'foo', 'Foo'])
    expect(findMatches(doc, { ...base, query: '(', regex: true }).error).not.toBeNull()
    expect(findMatches(doc, { ...base, query: 'foo', caseSensitive: true }).matches).toHaveLength(2)
  })
})
