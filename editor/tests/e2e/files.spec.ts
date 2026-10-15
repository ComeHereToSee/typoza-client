import { expect, test, type Page } from '@playwright/test'
import { loadDoc, markdown, modKey, openApp } from './helpers'

// 文件与窗口(PRD 3.1)、侧栏文件操作(PRD 3.8)、未命名草稿、异常文件。浏览器里由内存宿主模拟文件系统。

async function command(page: Page, id: string): Promise<void> {
  await page.evaluate((cmd) => window.typozaTest!.host.emit('menu.command', { id: cmd }), id)
}

async function fileText(page: Page, path: string): Promise<string | null> {
  return page.evaluate((p) => {
    const e = window.typozaTest!.host.files.get(p)
    return e && e.kind === 'file' ? (typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data)) : null
  }, path)
}

async function currentPath(page: Page): Promise<string | null> {
  return page.evaluate(() => window.typozaTest!.app.session.path)
}

async function confirmTitles(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    window.typozaTest!.host.calls.filter((c) => c.method === 'confirm').map((c) => (c.args[0] as { title: string }).title),
  )
}

test.describe('保存与外部修改', () => {
  test('自动保存:停止输入约 1 秒后写盘', async ({ page }) => {
    await openApp(page)
    await loadDoc(page, '# 自动保存\n\n第一段\n')
    const path = (await currentPath(page))!
    await page.keyboard.type('追加')
    await expect.poll(() => fileText(page, path), { timeout: 5000 }).toBe('# 自动保存\n\n第一段追加\n')
  })

  test('关闭自动保存后关窗:询问「是否保存更改?」,选「不保存」不写盘', async ({ page }) => {
    await openApp(page)
    await loadDoc(page, '# 关窗\n\n内容\n')
    const path = (await currentPath(page))!
    await page.evaluate(() => window.typozaTest!.app.updateSettings({ autoSave: false }))
    await page.keyboard.type('改')
    await page.evaluate(() => {
      const host = window.typozaTest!.host
      host.confirmQueue.push(1)
      host.emit('window.willClose', {})
    })
    await expect.poll(() => page.evaluate(() => window.typozaTest!.host.calls.some((c) => c.method === 'closeWindow'))).toBe(true)
    const ask = await page.evaluate(() => window.typozaTest!.host.calls.find((c) => c.method === 'confirm')?.args[0] as { title: string; message: string; buttons: string[] })
    expect(ask).toEqual(expect.objectContaining({ title: '是否保存更改?', message: '如果不保存,您的更改将会丢失。', buttons: ['保存', '不保存', '取消'] }))
    expect(await fileText(page, path)).toBe('# 关窗\n\n内容\n')
  })

  test('外部修改:没有未保存修改就静默重新加载', async ({ page }) => {
    await openApp(page)
    await loadDoc(page, '# 外部\n\n原文\n')
    await page.evaluate(() => {
      const t = window.typozaTest!
      const p = t.app.session.path!
      t.host.files.set(p, { kind: 'file', data: '# 外部\n\n别处改的\n', mtime: Date.now() + 1000 })
      t.host.emit('fs.changed', { paths: [p] })
    })
    await expect.poll(() => markdown(page)).toBe('# 外部\n\n别处改的\n')
    expect(await confirmTitles(page)).toEqual([])
  })

  test('外部修改:有未保存修改时询问,选「保留我的修改」', async ({ page }) => {
    await openApp(page)
    await loadDoc(page, '# 外部\n\n原文\n')
    await page.evaluate(() => window.typozaTest!.app.updateSettings({ autoSave: false }))
    await page.keyboard.type('我的')
    await page.evaluate(() => {
      const t = window.typozaTest!
      const p = t.app.session.path!
      t.host.confirmQueue.push(1)
      t.host.files.set(p, { kind: 'file', data: '# 外部\n\n别处改的\n', mtime: Date.now() + 1000 })
      t.host.emit('fs.changed', { paths: [p] })
    })
    await expect.poll(() => confirmTitles(page)).toEqual(['文件已被其他程序修改'])
    const ask = await page.evaluate(() => window.typozaTest!.host.calls.find((c) => c.method === 'confirm')?.args[0] as { buttons: string[] })
    expect(ask.buttons).toEqual(['重新加载', '保留我的修改'])
    expect(await markdown(page)).toBe('# 外部\n\n原文我的\n')
  })

  test('写盘失败:提示保存失败,全文放进剪贴板', async ({ page }) => {
    await openApp(page)
    await loadDoc(page, '# 失败\n\n内容\n')
    await page.evaluate(() => {
      window.typozaTest!.host.writeText = async () => {
        throw new Error('保存失败:/demo/x.md(磁盘已满)')
      }
    })
    await page.keyboard.type('新')
    const toast = page.locator('.tz-toast')
    await expect(toast).toContainText('全文已放入剪贴板', { timeout: 5000 })
    await expect(toast).toContainText('磁盘已满')
    await expect(toast.locator('.tz-toast-action')).toHaveText('另存为')
    expect(await page.evaluate(() => window.typozaTest!.host.clipboard.text)).toBe('# 失败\n\n内容新\n')
  })
})

test.describe('打开异常(PRD 3.1)', () => {
  test('文件不存在', async ({ page }) => {
    await openApp(page)
    await page.evaluate(() => window.typozaTest!.app.openFile('/demo/没有这个.md'))
    await expect(page.locator('.tz-toast')).toHaveText('目标文件或文件夹不存在。')
  })

  test('只读文件可以浏览,输入时提示不能保存并给【另存为】', async ({ page }) => {
    await openApp(page)
    await page.evaluate(async () => {
      const t = window.typozaTest!
      t.host.files.set('/demo/只读.md', { kind: 'file', data: '# 只读\n\n内容\n', mtime: Date.now(), readonly: true })
      await t.app.openFile('/demo/只读.md', { replace: true })
    })
    await page.locator('.tz-editor p').click()
    await page.keyboard.press('End')
    await page.keyboard.type('改')
    const toast = page.locator('.tz-toast')
    await expect(toast).toContainText('该文件只读,修改无法保存')
    await expect(toast.locator('.tz-toast-action')).toHaveText('另存为')
    await expect(page.locator('.tz-statusbar')).toContainText('只读')
    await page.waitForTimeout(1500)
    expect(await fileText(page, '/demo/只读.md')).toBe('# 只读\n\n内容\n')
  })

  test('超大文件以只读源码打开', async ({ page }) => {
    await openApp(page)
    await page.evaluate(async () => {
      const t = window.typozaTest!
      t.host.files.set('/demo/超大.md', { kind: 'file', data: '一行文字内容 abcdefghij\n'.repeat(600_000), mtime: Date.now() })
      await t.app.openFile('/demo/超大.md', { replace: true })
    })
    await expect(page.locator('.tz-source-host')).toBeVisible()
    await expect(page.locator('.tz-toast')).toContainText('已以只读源码方式打开')
    await command(page, 'view.sourceMode')
    await expect(page.locator('.tz-toast')).toHaveText('文件过大,只能以只读源码方式查看')
    await expect(page.locator('.tz-source-host')).toBeVisible()
  })
})

test.describe('未命名草稿(PRD 3.1)', () => {
  test('备份到数据目录,刷新(相当于重启)后恢复;首次保存后删除备份', async ({ page }) => {
    await openApp(page, '?empty')
    await page.locator('.tz-editor').click()
    await page.keyboard.type('还没保存的草稿')
    await expect.poll(() => page.evaluate(() => window.typozaTest!.host.drafts.size), { timeout: 5000 }).toBe(1)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true')
    await expect(page.locator('.tz-editor')).toContainText('还没保存的草稿')
    expect(await currentPath(page)).toBeNull()
    await command(page, 'file.save')
    await expect.poll(() => page.evaluate(() => window.typozaTest!.host.drafts.size)).toBe(0)
    expect(await fileText(page, '/Users/test/未命名.md')).toBe('还没保存的草稿\n')
  })

  test('未保存时插入的图片,首次保存时搬到文档旁并改成相对路径', async ({ page }) => {
    await openApp(page, '?empty')
    await page.evaluate(async () => {
      const t = window.typozaTest!
      await t.app.importFiles(t.app.view, [{ name: '截图.gif', base64: 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' }])
    })
    expect(await page.evaluate(() => window.typozaTest!.host.files.has('/Users/test/Library/Application Support/Typoza/assets/截图.gif'))).toBe(true)
    await command(page, 'file.save')
    await expect.poll(() => fileText(page, '/Users/test/未命名.md')).toContain('](assets/截图.gif)')
    const moved = await page.evaluate(() => {
      const files = window.typozaTest!.host.files
      return { here: files.has('/Users/test/assets/截图.gif'), draft: files.has('/Users/test/Library/Application Support/Typoza/assets/截图.gif') }
    })
    expect(moved).toEqual({ here: true, draft: false })
  })
})

test.describe('侧栏(PRD 3.8)', () => {
  async function contextMenu(page: Page, path: string, item: string): Promise<void> {
    await page.locator(`.tz-tree-item[data-path="${path}"]`).click({ button: 'right' })
    await page.locator(`.tz-context-menu .tz-menu-item[data-id="${item}"]`).click()
  }

  test('文件树:创建副本并撤销;移到废纸篓并撤销;属性', async ({ page }) => {
    await openApp(page)
    await command(page, 'view.fileTree')
    await contextMenu(page, '/demo/另一篇.md', 'duplicate')
    await expect(page.locator('.tz-tree-item[data-path="/demo/另一篇 副本.md"]')).toBeVisible()
    expect(await fileText(page, '/demo/另一篇 副本.md')).toBe('# 另一篇\n\n用于测试文档链接。\n')
    await page.locator('.tz-toast-action', { hasText: '撤销' }).click()
    await expect(page.locator('.tz-tree-item[data-path="/demo/另一篇 副本.md"]')).toHaveCount(0)

    await contextMenu(page, '/demo/另一篇.md', 'trash')
    expect(await confirmTitles(page)).toContain('要把「另一篇.md」移到废纸篓吗?')
    await expect(page.locator('.tz-tree-item[data-path="/demo/另一篇.md"]')).toHaveCount(0)
    expect(await fileText(page, '/demo/另一篇.md')).toBeNull()
    await page.locator('.tz-toast-action', { hasText: '撤销' }).click()
    await expect(page.locator('.tz-tree-item[data-path="/demo/另一篇.md"]')).toBeVisible()

    await contextMenu(page, '/demo/另一篇.md', 'info')
    const info = page.locator('.tz-modal .tz-file-info')
    await expect(info).toContainText('/demo/另一篇.md')
    await expect(info).toContainText('utf-8')
  })

  test('重命名后询问并更新其他文档中指向它的链接', async ({ page }) => {
    await openApp(page)
    await page.evaluate(() => window.typozaTest!.load('# 链接页\n\n见 [另一篇](另一篇.md)。\n', '/demo/链接页.md'))
    await command(page, 'view.fileTree')
    await contextMenu(page, '/demo/另一篇.md', 'rename')
    await page.locator('.tz-prompt-input').fill('改名.md')
    await page.locator('.tz-prompt-input').press('Enter')
    await expect.poll(() => confirmTitles(page)).toContain('是否更新其他文档中指向它的 1 处链接?')
    await expect.poll(() => fileText(page, '/demo/链接页.md')).toBe('# 链接页\n\n见 [另一篇](改名.md)。\n')
    await expect.poll(() => markdown(page)).toBe('# 链接页\n\n见 [另一篇](改名.md)。\n')
    expect(await fileText(page, '/demo/改名.md')).toBe('# 另一篇\n\n用于测试文档链接。\n')
  })

  test('重命名正在编辑的文档:当前文档跟着改名,保存写到新路径', async ({ page }) => {
    await openApp(page)
    await loadDoc(page, '# 当前\n\n内容\n')
    const path = (await currentPath(page))!
    await command(page, 'file.rename')
    await page.locator('.tz-prompt-input').fill('新名字.md')
    await page.locator('.tz-prompt-input').press('Enter')
    await expect.poll(() => currentPath(page)).toBe('/demo/新名字.md')
    await page.locator('.tz-editor p').click()
    await page.keyboard.press('End')
    await page.keyboard.type('加')
    await expect.poll(() => fileText(page, '/demo/新名字.md'), { timeout: 5000 }).toBe('# 当前\n\n内容加\n')
    expect(await fileText(page, path)).toBeNull()
  })

  test('拖到文件夹上移动', async ({ page }) => {
    await openApp(page)
    await command(page, 'view.fileTree')
    await expect(page.locator('.tz-tree-item[data-path="/demo/assets"]')).toBeVisible()
    await page.locator('.tz-tree-item[data-path="/demo/另一篇.md"]').dragTo(page.locator('.tz-tree-item[data-path="/demo/assets"]'))
    await expect.poll(() => fileText(page, '/demo/assets/另一篇.md')).toBe('# 另一篇\n\n用于测试文档链接。\n')
    expect(await fileText(page, '/demo/另一篇.md')).toBeNull()
  })

  test('文档列表:首段摘要、排序重启后保留、按文件夹分组', async ({ page }) => {
    await openApp(page)
    await command(page, 'view.docList')
    await expect(page.locator('.tz-doc-item[data-path="/demo/另一篇.md"] .tz-doc-excerpt')).toHaveText('用于测试文档链接。')
    await page.locator('.tz-list-sort').click()
    await page.locator('.tz-menu-item[data-id="sort.name"]').click()
    await page.locator('.tz-list-sort').click()
    await page.locator('.tz-menu-item[data-id="asc"]').click()
    await expect(page.locator('.tz-doc-item').first()).toHaveAttribute('data-path', '/demo/另一篇.md')
    expect(await page.evaluate(() => window.typozaTest!.host.settings)).toEqual(expect.objectContaining({ docListSort: 'name', docListSortDesc: false }))
    await page.locator('.tz-list-sort').click()
    await page.locator('.tz-menu-item[data-id="group"]').click()
    await expect(page.locator('.tz-doc-group').first()).toBeVisible()
  })

  test('大纲:折叠、全部折叠 / 展开、空态、大纲窗口', async ({ page }) => {
    await openApp(page)
    await loadDoc(page, '# A\n\n## A1\n\n### A1a\n\n# B\n')
    await command(page, 'view.outline')
    const rows = page.locator('.tz-outline .tz-outline-item:visible')
    const labels = page.locator('.tz-outline .tz-outline-item:visible > span:nth-child(2)')
    await expect(rows).toHaveCount(4)
    await page.locator('button[name=collapseAll]').click()
    await expect(labels).toHaveText(['A', 'B'])
    await page.locator('button[name=expandAll]').click()
    await expect(rows).toHaveCount(4)
    await rows.nth(1).locator('.tz-outline-twisty').click()
    await expect(labels).toHaveText(['A', 'A1', 'B'])

    await command(page, 'view.outlinePopover')
    const pop = page.locator('.tz-outline-popover .tz-outline-item')
    await expect(pop).toHaveCount(4)
    await pop.last().click()
    await expect(page.locator('.tz-outline-popover')).toHaveCount(0)

    await loadDoc(page, '没有标题\n')
    await expect(page.locator('.tz-outline .tz-side-empty')).toHaveText('大纲内容为空')
  })

  test('全局搜索:文件名与正文、点击定位到命中处、选项、#标签、结果过多', async ({ page }) => {
    await openApp(page)
    await page.evaluate(() => {
      const files = window.typozaTest!.host.files
      files.set('/demo/标签.md', { kind: 'file', data: '记录 #待办 一条\n', mtime: Date.now() })
      files.set('/demo/很多.md', { kind: 'file', data: 'hit\n'.repeat(1100), mtime: Date.now() })
    })
    await command(page, 'view.search')
    const input = page.locator('.tz-search-input')
    await input.fill('用于测试')
    const hit = page.locator('.tz-hit[data-path="/demo/另一篇.md"]')
    await expect(hit).toBeVisible()
    await hit.locator('.tz-hit-line').first().click()
    await expect.poll(() => currentPath(page)).toBe('/demo/另一篇.md')
    const selected = await page.evaluate(() => {
      const v = window.typozaTest!.app.view
      return v.state.doc.textBetween(v.state.selection.from, v.state.selection.to)
    })
    expect(selected).toBe('用于测试')

    await input.fill('#待办')
    await expect(page.locator('.tz-hit[data-path="/demo/标签.md"]')).toBeVisible()

    await page.locator('.tz-search-options button[name=regex]').click()
    await input.fill('用于.试')
    await expect(page.locator('.tz-hit[data-path="/demo/另一篇.md"]')).toBeVisible()
    await page.locator('.tz-search-options button[name=regex]').click()

    await input.fill('很多')
    await expect(page.locator('.tz-hit[data-path="/demo/很多.md"] .tz-hit-count')).toHaveText('文件名')

    await input.fill('hit')
    await expect(page.locator('.tz-search-results .tz-side-notice')).toHaveText('匹配结果过多')
  })

  test('没有打开文件夹时的空态', async ({ page }) => {
    await openApp(page)
    await page.evaluate(() => window.typozaTest!.app['sidebar'].setRoot(null))
    await command(page, 'view.fileTree')
    await expect(page.locator('.tz-side-empty p')).toHaveText('没有打开的文件夹')
    await expect(page.locator('.tz-folder-item[data-folder="/demo"]')).toBeVisible()
  })
})

test.describe('快速打开(PRD 3.9)', () => {
  test('按文件名与首个标题查找;↩ 当前标签打开,⌘↩ 新标签;无结果提示', async ({ page }) => {
    await openApp(page)
    await page.evaluate(() => window.typozaTest!.host.files.set('/demo/x1.md', { kind: 'file', data: '# 季度总结\n', mtime: Date.now() }))
    await command(page, 'file.quickOpen')
    const input = page.locator('.tz-qo-input')
    await input.fill('另一')
    await expect(page.locator('.tz-qo-item').first()).toHaveAttribute('data-path', '/demo/另一篇.md')
    await input.press('Enter')
    await expect.poll(() => currentPath(page)).toBe('/demo/另一篇.md')

    await command(page, 'file.quickOpen')
    await input.fill('季度')
    await expect(page.locator('.tz-qo-item').first()).toHaveAttribute('data-path', '/demo/x1.md')
    await input.press(`${await modKey(page)}+Enter`)
    const opened = await page.evaluate(() => window.typozaTest!.host.calls.filter((c) => c.method === 'openDocument').map((c) => c.args))
    expect(opened).toEqual([['/demo/x1.md', { tab: true }]])

    await command(page, 'file.quickOpen')
    await input.fill('zzqqxx')
    await expect(page.locator('.tz-quick-open .tz-menu-empty')).toHaveText('没有找到对应的内容')
  })
})
