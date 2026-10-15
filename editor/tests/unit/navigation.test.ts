import { describe, expect, it } from 'vitest'
import { NavHistory, openWhereOf, resolveLinkTarget } from '../../src/app/navigation'
import { fuzzyScore, quickOpenScore } from '../../src/app/quickopen'
import { createMemoryHost } from '../../src/host/memory'

describe('后退 / 前进(notion 5.1 第 4、5 行)', () => {
  it('后退回到跳转前的文档与位置,前进再回来;新的跳转清空前进', () => {
    const nav = new NavHistory()
    nav.push({ path: '/a.md', pos: 5 })
    nav.push({ path: '/b.md', pos: 9 })
    expect(nav.goBack({ path: '/c.md', pos: 1 })).toEqual({ path: '/b.md', pos: 9 })
    expect(nav.goBack({ path: '/b.md', pos: 9 })).toEqual({ path: '/a.md', pos: 5 })
    expect(nav.goBack({ path: '/a.md', pos: 5 })).toBeNull()
    expect(nav.goForward({ path: '/a.md', pos: 5 })).toEqual({ path: '/b.md', pos: 9 })
    nav.push({ path: '/b.md', pos: 2 })
    expect(nav.canGoForward).toBe(false)
  })

  it('文件改名后历史里的路径跟着改', () => {
    const nav = new NavHistory()
    nav.push({ path: '/r/old/a.md', pos: 3 })
    nav.rename('/r/old', '/r/new')
    expect(nav.goBack({ path: '/r/x.md', pos: 0 })).toEqual({ path: '/r/new/a.md', pos: 3 })
  })

  it('修饰键:⌘ 新标签,⌥⇧ 新窗口', () => {
    const e = (o: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>>) => ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o })
    expect(openWhereOf(e({}))).toBe('current')
    expect(openWhereOf(e({ metaKey: true }))).toBe('tab')
    expect(openWhereOf(e({ altKey: true, shiftKey: true }))).toBe('window')
  })
})

describe('链接目标(PRD 3.2、对照表 X-09、X-10)', () => {
  const setup = () => {
    const host = createMemoryHost()
    const put = (path: string, data = '') => host.files.set(path, { kind: 'file', data, mtime: 1 })
    put('/r/docs/当前.md')
    put('/r/docs/同目录.md')
    put('/r/other/同目录.md')
    put('/r/notes/笔记.md')
    put('/r/docs/图.png')
    host.files.set('/r/docs/游记.textbundle', { kind: 'dir', mtime: 1 })
    put('/r/docs/游记.textbundle/text.md')
    return host
  }
  const ctx = { path: '/r/docs/当前.md', rootUrl: null }

  it('相对路径、省略 .md、锚点、TextBundle、其它文件', async () => {
    const host = setup()
    expect(await resolveLinkTarget(host, '#标题', ctx, '/r')).toEqual({ kind: 'anchor', anchor: '标题' })
    expect(await resolveLinkTarget(host, '../notes/笔记.md#第一节', ctx, '/r')).toEqual({ kind: 'doc', path: '/r/notes/笔记.md', anchor: '第一节' })
    expect(await resolveLinkTarget(host, '../notes/笔记', ctx, '/r')).toEqual({ kind: 'doc', path: '/r/notes/笔记.md', anchor: '' })
    expect(await resolveLinkTarget(host, '游记.textbundle', ctx, '/r')).toEqual({ kind: 'doc', path: '/r/docs/游记.textbundle', anchor: '' })
    expect(await resolveLinkTarget(host, '图.png', ctx, '/r')).toEqual({ kind: 'file', path: '/r/docs/图.png' })
  })

  it('wikilink 按文件名在根文件夹里找,同名优先当前文档所在文件夹', async () => {
    const host = setup()
    expect(await resolveLinkTarget(host, '同目录', ctx, '/r')).toEqual({ kind: 'doc', path: '/r/docs/同目录.md', anchor: '' })
    expect(await resolveLinkTarget(host, '笔记#节', ctx, '/r')).toEqual({ kind: 'doc', path: '/r/notes/笔记.md', anchor: '节' })
  })

  it('不存在:Markdown 与省略扩展名的写法可以新建,其它文件不能', async () => {
    const host = setup()
    expect(await resolveLinkTarget(host, '新文档.md', ctx, '/r')).toEqual({ kind: 'missing', path: '/r/docs/新文档.md', creatable: true })
    expect(await resolveLinkTarget(host, '新文档', ctx, '/r')).toEqual({ kind: 'missing', path: '/r/docs/新文档.md', creatable: true })
    expect(await resolveLinkTarget(host, '缺.pdf', ctx, '/r')).toEqual({ kind: 'missing', path: '/r/docs/缺.pdf', creatable: false })
  })
})

describe('快速打开模糊匹配(PRD 3.9)', () => {
  it('连续命中、命中文件名开头得分更高;不匹配为 -1', () => {
    expect(fuzzyScore('abc', 'x/y.md')).toBe(-1)
    expect(fuzzyScore('', 'x.md')).toBe(0)
    expect(fuzzyScore('note', 'notes/todo.md')).toBeGreaterThan(-1)
    expect(fuzzyScore('todo', 'todo.md')).toBeGreaterThan(fuzzyScore('todo', 'xtxoxdxo.md'))
    expect(fuzzyScore('周报', '周报/2026.md')).toBeLessThan(fuzzyScore('周报', '归档/周报.md'))
  })

  it('也按首个标题匹配', () => {
    expect(quickOpenScore('季度', 'a/x1.md', '季度总结')).toBeGreaterThan(0)
    expect(quickOpenScore('季度', 'a/x1.md', null)).toBe(-1)
    expect(quickOpenScore('季度', 'a/季度.md', null)).toBeGreaterThan(0)
    // 同样的字,标题命中比文件名命中略低一分
    expect(quickOpenScore('总结', 'a/x.md', '总结')).toBe(fuzzyScore('总结', '总结') - 1)
  })
})
