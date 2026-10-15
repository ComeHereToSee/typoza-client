import { EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { describe, expect, it } from 'vitest'
import { appendMarkdown, createDocumentIn, documentRefs, firstHeadingOf, pickWikiTarget } from '../../src/app/doc-links'
import type { EditorEnv } from '../../src/core/env'
import { parseMarkdown } from '../../src/core/markdown/parse'
import { createMemoryHost } from '../../src/host/memory'
import { BLOCK_KINDS, slashItems } from '../../src/plugins/items'
import { slashAllowedAfter } from '../../src/plugins/slash'
import { type MenuItem, filterMenuItems } from '../../src/ui/menu'

describe('文档标题与链接(notion-input.md 4.3)', () => {
  it('首个一级标题:跳过 YAML 与代码块,去掉格式标记;Setext 写法也认', () => {
    expect(firstHeadingOf('---\ntitle: x\n---\n\n## 二级\n\n# **主** 标题\n')).toBe('主 标题')
    expect(firstHeadingOf('```\n# 代码里的\n```\n\n# 真标题 #\n')).toBe('真标题')
    expect(firstHeadingOf('Setext 标题\n===\n')).toBe('Setext 标题')
    expect(firstHeadingOf('#不是标题\n正文\n')).toBeNull()
  })

  it('[[文档名]] 同名时优先当前文档所在文件夹', () => {
    const all = ['/r/a/笔记.md', '/r/b/笔记.md', '/r/b/其它.md']
    expect(pickWikiTarget(all, '笔记', '/r/b')).toBe('/r/b/笔记.md')
    expect(pickWikiTarget(all, '笔记', '/r/c')).toBe('/r/a/笔记.md')
    expect(pickWikiTarget(all, '没有', '/r/b')).toBeNull()
  })

  it('文档引用的标题取首个一级标题,链接相对当前文件夹', async () => {
    const host = createMemoryHost()
    host.files.set('/r/sub/甲.md', { kind: 'file', data: '# 甲的标题\n', mtime: 1 })
    host.files.set('/r/乙.md', { kind: 'file', data: '正文\n', mtime: 1 })
    const refs = await documentRefs(host, ['/r/sub/甲.md', '/r/乙.md'], '/r', '/r')
    expect(refs).toEqual([
      { path: '/r/sub/甲.md', title: '甲的标题', name: '甲', dir: 'sub', href: 'sub/甲.md' },
      { path: '/r/乙.md', title: '乙', name: '乙', dir: '.', href: '乙.md' },
    ])
  })

  it('新建文档重名时加序号;追加 Markdown 与原文空一行', async () => {
    const host = createMemoryHost()
    host.files.set('/r/新笔记.md', { kind: 'file', data: '已有\n', mtime: 1 })
    const ref = await createDocumentIn(host, '/r', '新笔记', '# 新笔记\n', '/r')
    expect(ref.path).toBe('/r/新笔记-1.md')
    expect(ref.title).toBe('新笔记')
    expect(ref.href).toBe('新笔记-1.md')
    await appendMarkdown(host, '/r/新笔记.md', '- 移过来的块')
    expect((await host.readText('/r/新笔记.md')).text).toBe('已有\n\n- 移过来的块\n')
  })
})

describe('斜杠菜单条目与过滤(notion-input.md 4.1、4.2)', () => {
  const view = { state: EditorState.create({ doc: parseMarkdown('文字\n', { inlineMath: true }).doc }) } as unknown as EditorView
  const env = { settings: { inlineMath: true }, actions: {} } as unknown as EditorEnv
  const items = slashItems(view, env, { openLinkMenu: () => {} })
  const first = (query: string): MenuItem | undefined => filterMenuItems(items, query)[0]

  it('条目名按 PRD', () => {
    const labels = items.filter((it) => !it.searchOnly).map((it) => it.label)
    for (const name of ['正文', '新文档', '标题 1', '待办', '折叠块', '折叠标题 1', '标注块', '链接到文档', '提及文档', '日期', '表情', '书签', '文件', '嵌入', '代码', '复制块', '移动到', '删除', '转换为', '图表', 'HTML', '链接引用', '页面图标', '页面封面', 'YAML 元数据']) {
      expect(labels).toContain(name)
    }
    expect(labels).toEqual(expect.arrayContaining(['提示框:提醒', '提示框:建议', '提示框:重要', '提示框:警告', '提示框:注意']))
  })

  it('中文名(忽略空格)、英文别名、拼音缩写都能命中', () => {
    expect(first('标题1')?.label).toBe('标题 1')
    expect(first('#')?.label).toBe('标题 1')
    expect(first('plain')?.label).toBe('正文')
    expect(first('book')?.label).toBe('书签')
    expect(first('blue background')?.label).toBe('蓝色背景')
    expect(first('red')?.label).toBe('红色')
    expect(first('daiban')?.label).toBe('待办')
    expect(first('caution')?.label).toBe('提示框:注意')
    expect(first('sequence')?.label).toBe('图表')
  })

  it('「/turnbullet」这类直达条目只在搜索时出现', () => {
    expect(filterMenuItems(items, '').some((it) => it.label.startsWith('转换为无'))).toBe(false)
    expect(first('turnbullet')?.label).toBe('转换为无序列表')
    expect(first('turnintotoggleh1')?.label).toBe('转换为折叠标题 1')
  })

  it('「转换为」目标含折叠标题 1~3', () => {
    expect(BLOCK_KINDS.map((k) => k.label)).toEqual(expect.arrayContaining(['折叠标题 1', '折叠标题 2', '折叠标题 3']))
  })

  it('/ 在块开头、空白或标点后触发;单词中间与网址里不触发', () => {
    expect(slashAllowedAfter('')).toBe(true)
    expect(slashAllowedAfter('a ')).toBe(true)
    expect(slashAllowedAfter('好,')).toBe(true)
    expect(slashAllowedAfter('(')).toBe(true)
    expect(slashAllowedAfter('abc')).toBe(false)
    expect(slashAllowedAfter('ttp:')).toBe(false)
    expect(slashAllowedAfter('p:/')).toBe(false)
  })
})
