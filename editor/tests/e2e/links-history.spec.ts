import { expect, test, type Page } from '@playwright/test'
import { loadDoc, markdown, modKey, openApp } from './helpers'

// 链接(PRD 3.2)、后退 / 前进、源代码模式光标(PRD 3.10)、本地历史版本(PRD 3.14)、文内查找替换(PRD 3.9)。

async function command(page: Page, id: string): Promise<void> {
  await page.evaluate((cmd) => window.typozaTest!.host.emit('menu.command', { id: cmd }), id)
}

async function currentPath(page: Page): Promise<string | null> {
  return page.evaluate(() => window.typozaTest!.app.session.path)
}

async function cursor(page: Page): Promise<{ from: number; parent: string }> {
  return page.evaluate(() => {
    const s = window.typozaTest!.app.view.state
    return { from: s.selection.from, parent: s.selection.$from.parent.textContent }
  })
}

/** 把光标放到某段文字之后 */
async function placeAfter(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const v = window.typozaTest!.app.view
    let pos = -1
    v.state.doc.descendants((node, p) => {
      if (pos < 0 && node.isText && node.text!.includes(t)) pos = p + node.text!.indexOf(t) + t.length
      return pos < 0
    })
    const Sel = v.state.selection.constructor as unknown as { create(doc: unknown, pos: number): typeof v.state.selection }
    v.dispatch(v.state.tr.setSelection(Sel.create(v.state.doc, pos)))
    v.focus()
  }, text)
}

const LINKS_DOC = '# 第一节\n\n去看 [另一篇](另一篇.md)、[跳到第二节](#第二节)、[缺的](新建的.md)、[省略](另一篇)、[网址](https://example.com)。\n\n## 第二节\n\n结尾\n'

function link(page: Page, text: string) {
  return page.locator('.tz-editor a', { hasText: text }).first()
}

test.describe('链接', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await loadDoc(page, LINKS_DOC)
  })

  test('⌘+点击本地文档在新标签打开,⌥⇧+点击在新窗口打开', async ({ page }) => {
    await link(page, '另一篇').click({ modifiers: [await modKey(page)] })
    await link(page, '另一篇').click({ modifiers: ['Alt', 'Shift'] })
    await expect
      .poll(() => page.evaluate(() => window.typozaTest!.host.calls.filter((c) => c.method === 'openDocument').map((c) => c.args)))
      .toEqual([
        ['/demo/另一篇.md', { tab: true }],
        ['/demo/另一篇.md', { newWindow: true }],
      ])
  })

  test('单击显示浮层:复制、打开后 ⌘[ 返回原位置、⌘] 前进', async ({ page }) => {
    const origin = await currentPath(page)
    await link(page, '另一篇').click()
    const card = page.locator('.tz-link-card')
    await expect(card).toBeVisible()
    await expect(card.locator('button')).toHaveText(['打开', '编辑', '复制', '移除'])
    await card.locator('button[name=copy]').click()
    await expect.poll(() => page.evaluate(() => window.typozaTest!.host.clipboard.text)).toBe('另一篇.md')
    const before = await cursor(page)
    await card.locator('button[name=open]').click()
    await expect.poll(() => currentPath(page)).toBe('/demo/另一篇.md')
    await command(page, 'nav.back')
    await expect.poll(() => currentPath(page)).toBe(origin)
    await expect.poll(() => cursor(page)).toEqual(before)
    await command(page, 'nav.forward')
    await expect.poll(() => currentPath(page)).toBe('/demo/另一篇.md')
  })

  test('文内锚点跳转可以 ⌘[ 返回;省略 .md 也能打开;网址交给浏览器', async ({ page }) => {
    await link(page, '跳到第二节').click()
    await page.locator('.tz-link-card button[name=open]').click()
    await expect.poll(async () => (await cursor(page)).parent).toBe('第二节')
    await command(page, 'nav.back')
    await expect.poll(async () => (await cursor(page)).parent).toContain('去看')

    await link(page, '网址').click()
    await page.locator('.tz-link-card button[name=open]').click()
    await expect.poll(() => page.evaluate(() => window.typozaTest!.host.calls.some((c) => c.method === 'openExternal' && c.args[0] === 'https://example.com'))).toBe(true)

    await link(page, '省略').click()
    await page.locator('.tz-link-card button[name=open]').click()
    await expect.poll(() => currentPath(page)).toBe('/demo/另一篇.md')
  })

  test('目标不存在时询问并新建', async ({ page }) => {
    await link(page, '缺的').click()
    await page.locator('.tz-link-card button[name=open]').click()
    await expect.poll(() => currentPath(page)).toBe('/demo/新建的.md')
    const titles = await page.evaluate(() => window.typozaTest!.host.calls.filter((c) => c.method === 'confirm').map((c) => (c.args[0] as { title: string }).title))
    expect(titles).toEqual(['无法打开 新建的.md,是否在 /demo 新建文件并继续?'])
  })

  test('编辑与移除链接;⌘K 新建时自动填入剪贴板里的网址', async ({ page }) => {
    await link(page, '另一篇').click()
    await page.locator('.tz-link-card button[name=edit]').click()
    const input = page.locator('.tz-prompt-input')
    await expect(input).toHaveValue('另一篇.md')
    await input.fill('https://example.org')
    await input.press('Enter')
    await expect.poll(() => markdown(page)).toContain('[另一篇](https://example.org)')

    await link(page, '缺的').click()
    await page.locator('.tz-link-card button[name=remove]').click()
    await expect.poll(() => markdown(page)).toContain('、缺的、')

    await page.evaluate(() => (window.typozaTest!.host.clipboard.text = 'https://example.net/a'))
    await placeAfter(page, '结尾')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')
    await command(page, 'format.link')
    await expect(input).toHaveValue('https://example.net/a')
    await input.press('Enter')
    await expect.poll(() => markdown(page)).toContain('[结尾](https://example.net/a)')
  })

  test('悬停本地文档链接显示目标的标题与首段', async ({ page }) => {
    // loadDoc 点编辑区时可能正好点在链接上弹出了浮层;浮层开着时不显示悬停预览
    await page.keyboard.press('Escape')
    await expect(page.locator('.tz-link-card')).toBeHidden()
    await link(page, '另一篇').hover()
    const preview = page.locator('.tz-link-preview')
    await expect(preview).toBeVisible()
    await expect(preview.locator('.tz-link-preview-title')).toHaveText('另一篇')
    await expect(preview.locator('.tz-link-preview-excerpt')).toHaveText('用于测试文档链接。')
  })
})

test.describe('源代码模式(PRD 3.10)', () => {
  test('切换前后 Markdown 不变,来回切换保持光标位置', async ({ page }) => {
    await openApp(page)
    const md = '# 标题\n\n第一段 **粗体** 结尾\n\n- 项目一\n- 项目二\n'
    await loadDoc(page, md)
    await command(page, 'view.sourceMode')
    await expect(page.locator('.tz-source-host')).toBeVisible()
    await command(page, 'view.sourceMode')
    await expect(page.locator('.tz-source-host')).toHaveCount(0)
    expect(await markdown(page)).toBe(md)

    await placeAfter(page, '粗体')
    await command(page, 'view.sourceMode')
    await page.keyboard.type('Z')
    await command(page, 'view.sourceMode')
    await page.keyboard.type('Y')
    expect(await markdown(page)).toBe('# 标题\n\n第一段 **粗体**ZY 结尾\n\n- 项目一\n- 项目二\n')
  })
})

test.describe('本地历史版本(PRD 3.14)', () => {
  test('预览标出差异;复制内容;恢复此版本前先记快照并提示恢复到的时间', async ({ page }) => {
    await openApp(page)
    await loadDoc(page, '# 历史\n\n原来的内容\n')
    const path = (await currentPath(page))!
    await page.keyboard.type('改动')
    await expect
      .poll(() => page.evaluate((p) => window.typozaTest!.host.history.get(p)?.length ?? 0, path), { timeout: 5000 })
      .toBeGreaterThanOrEqual(2)
    await command(page, 'file.history')
    const oldest = page.locator('.tz-history-list > .tz-history-item').last()
    await oldest.click()
    await expect(page.locator('.tz-diff-line.is-removed')).toHaveText(['原来的内容改动'])
    await expect(page.locator('.tz-diff-line.is-added')).toHaveText(['原来的内容'])
    await page.locator('button[name=copy]').click()
    await expect.poll(() => page.evaluate(() => window.typozaTest!.host.clipboard.text)).toBe('# 历史\n\n原来的内容\n')
    await page.locator('button[name=restore]').click()
    await expect.poll(() => markdown(page)).toBe('# 历史\n\n原来的内容\n')
    await expect(page.locator('.tz-toast')).toHaveText(/^已恢复到 \d{4}-\d{2}-\d{2} \d{2}:\d{2} 的版本$/)
    const pinned = await page.evaluate(() => window.typozaTest!.host.calls.filter((c) => c.method === 'historySnapshot').map((c) => c.args[1]))
    expect(pinned).toEqual(['# 历史\n\n原来的内容改动\n'])
  })

  test('删除后在「已删除的文件」里找回;改名后历史跟着走', async ({ page }) => {
    await openApp(page)
    await page.evaluate(() => window.typozaTest!.load('# 待删\n\n内容\n', '/demo/待删.md'))
    await page.locator('.tz-editor p').click()
    await page.keyboard.press('End')
    await page.keyboard.type('二')
    await expect.poll(() => page.evaluate(() => window.typozaTest!.host.history.get('/demo/待删.md')?.length ?? 0), { timeout: 5000 }).toBeGreaterThanOrEqual(2)

    await page.evaluate(() => window.typozaTest!.host.rename('/demo/待删.md', '/demo/改了名.md'))
    expect(await page.evaluate(() => window.typozaTest!.host.history.has('/demo/改了名.md'))).toBe(true)
    await page.evaluate(() => window.typozaTest!.host.rename('/demo/改了名.md', '/demo/待删.md'))

    await command(page, 'file.delete')
    await expect.poll(() => currentPath(page)).toBeNull()
    await command(page, 'file.history')
    const deleted = page.locator('.tz-history-deleted > .tz-history-item', { hasText: '待删.md' })
    await deleted.click()
    await page.locator('.tz-history-sub .tz-history-item').first().click()
    await expect(page.locator('.tz-history-preview')).toContainText('内容二')
    await page.locator('button[name=restore]').click()
    await expect
      .poll(() => page.evaluate(() => {
        const e = window.typozaTest!.host.files.get('/demo/待删.md')
        return e && e.kind === 'file' ? e.data : null
      }))
      .toBe('# 待删\n\n内容二\n')
  })
})

test.describe('文内查找与替换(PRD 3.9)', () => {
  test('全部替换后一次 ⌘Z 撤回', async ({ page }) => {
    await openApp(page)
    await loadDoc(page, '苹果 香蕉 苹果\n\n苹果派\n')
    await command(page, 'find.replace')
    const inputs = page.locator('.tz-find-input')
    await inputs.first().fill('苹果')
    await inputs.nth(1).fill('梨')
    await page.locator('.tz-find-action', { hasText: '全部替换' }).click()
    await expect.poll(() => markdown(page)).toBe('梨 香蕉 梨\n\n梨派\n')
    await page.locator('.tz-editor p').last().click()
    await page.keyboard.press(`${await modKey(page)}+z`)
    await expect.poll(() => markdown(page)).toBe('苹果 香蕉 苹果\n\n苹果派\n')
  })
})
