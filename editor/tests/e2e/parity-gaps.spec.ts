import { expect, test } from '@playwright/test'
import { loadDoc, markdown, openApp } from './helpers'
import { contextMenuAt, hostCalls, runMenuCommand } from './media-helpers'

// 对照表「实现」行里此前没有用例为证的几项:X-15、X-60、C-10、C-13、C-14、P-11、P-13、P-17、P-23、M-12,以及 HTML 块里的图片双击放大
test.beforeEach(async ({ page }) => {
  await openApp(page)
})

const menuItem = (id: string) => `.tz-context-menu [data-id="${id}"]`
const selectionFrom = (page: import('@playwright/test').Page) => page.evaluate(() => window.typozaTest!.app.view.state.selection.from)

test('X-15 剪贴板里是图片文件(Finder 里拷贝)时粘贴:存进 assets 并插入图片', async ({ page }) => {
  await loadDoc(page, '段落\n', '/demo/粘贴文件.md')
  // WebKit 粘贴 Finder 拷贝的文件时只给 Files,不给含路径的 text/plain
  await page.evaluate(() => {
    const bytes = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0))
    const data = new DataTransfer()
    data.items.add(new File([bytes], '贴图.gif', { type: 'image/gif' }))
    document.querySelector('.tz-editor')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await expect.poll(() => markdown(page)).toContain('![贴图](assets/贴图.gif)')
  expect(await page.evaluate(() => window.typozaTest!.host.files.has('/demo/assets/贴图.gif'))).toBe(true)
})

test('X-60 段落只有一张图时居中,和文字同段时不居中;补上文字后不再居中', async ({ page }) => {
  // id.svg 宽 400,比正文窄,看得出是否居中
  await loadDoc(page, '![标识](assets/id.svg)\n\n前面的字 ![标识](assets/id.svg)\n')
  const paras = page.locator('.tz-editor > p')
  const offset = (i: number) =>
    paras.nth(i).evaluate((p) => {
      const img = p.querySelector<HTMLElement>('.tz-image')!
      const a = p.getBoundingClientRect()
      const b = img.getBoundingClientRect()
      return { center: Math.abs(a.left + a.width / 2 - (b.left + b.width / 2)), narrower: b.width > 0 && b.width < a.width - 40 }
    })
  await expect.poll(async () => (await offset(0)).narrower, { timeout: 5000 }).toBe(true)
  await expect(paras.nth(0)).toHaveClass(/tz-image-only/)
  await expect(paras.nth(1)).not.toHaveClass(/tz-image-only/)
  expect((await offset(0)).center).toBeLessThan(2)
  expect((await offset(1)).center).toBeGreaterThan(20)
  // 在第一段图片后补字:不再是单图段落
  await page.evaluate(() => {
    const view = window.typozaTest!.app.view
    view.dispatch(view.state.tr.insertText('说明', 2))
  })
  await expect(paras.nth(0)).not.toHaveClass(/tz-image-only/)
  expect((await offset(0)).center).toBeGreaterThan(20)
})

test.describe('C-10 右键图片:在浏览器 / 默认应用中打开', () => {
  test('网络图片:在浏览器中打开图片', async ({ page }) => {
    await loadDoc(page, '![远程](https://img.example.com/pic.png)\n')
    await page.locator('.tz-editor .tz-image img').click({ button: 'right' })
    await expect(page.locator(menuItem('ctx.image.open'))).toHaveCount(0)
    await page.locator(menuItem('ctx.image.browser')).click()
    await expect.poll(() => hostCalls(page, 'openExternal')).toContainEqual(['https://img.example.com/pic.png'])
  })

  test('本机图片:用默认应用打开(传绝对路径)', async ({ page }) => {
    await loadDoc(page, '![表单](assets/form.svg)\n', '/demo/默认应用.md')
    await page.locator('.tz-editor .tz-image img').click({ button: 'right' })
    await expect(page.locator(menuItem('ctx.image.browser'))).toHaveCount(0)
    await page.locator(menuItem('ctx.image.open')).click()
    await expect.poll(() => hostCalls(page, 'openWithDefaultApp')).toContainEqual(['/demo/assets/form.svg'])
  })
})

test.describe('C-14 右键 ▸ 跳转到', () => {
  test('文首、文末', async ({ page }) => {
    await loadDoc(page, '# 标题\n\n中间段落\n\n末段文字\n')
    const end = await selectionFrom(page)
    await contextMenuAt(page, '.tz-editor p', { x: 8, y: 10 })
    await page.locator(menuItem('ctx.jump')).hover()
    await page.locator(menuItem('ctx.jump.start')).click()
    await expect.poll(() => selectionFrom(page)).toBe(1)
    await contextMenuAt(page, '.tz-editor p', { x: 8, y: 10 })
    await page.locator(menuItem('ctx.jump')).hover()
    await page.locator(menuItem('ctx.jump.end')).click()
    await expect.poll(() => selectionFrom(page)).toBe(end)
  })

  test('脚注引用上右键跳到脚注定义,定义上右键跳回引用', async ({ page }) => {
    await loadDoc(page, '正文[^1]说明\n\n中间段落\n\n[^1]: 脚注内容\n')
    const inDef = () =>
      page.evaluate(() => {
        const $from = window.typozaTest!.app.view.state.selection.$from
        for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'footnote_def') return true
        return false
      })
    await page.locator('.tz-editor .tz-footnote-ref').click({ button: 'right' })
    await page.locator(menuItem('ctx.jump')).hover()
    await expect(page.locator(menuItem('ctx.jump.footnote'))).toHaveText(/脚注定义/)
    await page.locator(menuItem('ctx.jump.footnote')).click()
    await expect.poll(inDef).toBe(true)

    await page.locator('.tz-editor .tz-footnote-def').click({ button: 'right' })
    await page.locator(menuItem('ctx.jump')).hover()
    await expect(page.locator(menuItem('ctx.jump.footnote'))).toHaveText(/脚注引用/)
    await page.locator(menuItem('ctx.jump.footnote')).click()
    await expect.poll(inDef).toBe(false)
    // 跳回第一处引用之后:光标在第一段
    expect(await page.evaluate(() => window.typozaTest!.app.view.state.selection.$from.parent.textContent)).toContain('正文')
  })
})

test('HTML 块里的图片双击打开灯箱', async ({ page }) => {
  await loadDoc(page, '<div align="center"><img src="assets/form.svg" alt="表单"></div>\n')
  await page.locator('.tz-html-preview img').dblclick()
  await expect(page.locator('.tz-lightbox')).toBeVisible()
  await expect.poll(() => page.locator('.tz-lb-img').evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 5000 }).toBeGreaterThan(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('.tz-lightbox')).toHaveCount(0)
})

test.describe('P-11 / P-13 / P-17 右键 ▸ 表格', () => {
  test('上方插入行、左侧 / 右侧插入列、删除列', async ({ page }) => {
    await loadDoc(page, '| a | b |\n| - | - |\n| 1 | 2 |\n')
    const rows = page.locator('.tz-editor tr')
    const cols = rows.first().locator('th, td')
    const one = page.locator('.tz-editor td').filter({ hasText: /^1$/ })
    const pick = async (id: string) => {
      await one.click({ button: 'right' })
      await page.locator(menuItem('ctx.table')).hover()
      await page.locator(menuItem(`ctx.${id}`)).click()
    }
    await pick('table.rowAbove')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(1)).not.toContainText('1')
    await expect(rows.nth(2)).toContainText('1')
    await pick('table.colLeft')
    await expect(cols).toHaveCount(3)
    await pick('table.colRight')
    await expect(cols).toHaveCount(4)
    // 删掉「1」所在列:表头 a 与「1」一起没了,b、2 还在
    await pick('table.deleteCol')
    await expect(cols).toHaveCount(3)
    await expect(one).toHaveCount(0)
    await expect(page.locator('.tz-editor th').filter({ hasText: /^a$/ })).toHaveCount(0)
    await expect(page.locator('.tz-editor td').filter({ hasText: /^2$/ })).toHaveCount(1)
  })

  test('表格外右键没有「表格」子菜单', async ({ page }) => {
    await loadDoc(page, '段落\n\n| a |\n| - |\n| 1 |\n')
    await page.locator('.tz-editor > p').first().click({ button: 'right' })
    await expect(page.locator(menuItem('ctx.insert'))).toBeVisible()
    await expect(page.locator(menuItem('ctx.table'))).toHaveCount(0)
  })
})

test('C-13 / M-12 右键链接:复制链接地址、复制链接文字、打开链接', async ({ page }) => {
  await loadDoc(page, '看 [示例站点](https://example.com/a) 这里\n')
  const link = page.locator('.tz-editor a', { hasText: '示例站点' })
  const clipboard = () => page.evaluate(() => window.typozaTest!.host.clipboard.text)
  await link.click({ button: 'right' })
  await page.locator(menuItem('ctx.link.copyUrl')).click()
  await expect.poll(clipboard).toBe('https://example.com/a')
  await link.click({ button: 'right' })
  await expect(page.locator(menuItem('ctx.link.copyText'))).toContainText('复制「示例站点」')
  await page.locator(menuItem('ctx.link.copyText')).click()
  await expect.poll(clipboard).toBe('示例站点')
  await link.click({ button: 'right' })
  await page.locator(menuItem('ctx.link.open')).click()
  await expect.poll(() => hostCalls(page, 'openExternal')).toContainEqual(['https://example.com/a'])
})

test('P-23 代码工具 ▸ 复制代码块内容;右上角【复制代码】按钮同样写进剪贴板', async ({ page }) => {
  await loadDoc(page, '```js\nconst a = 1\nconst b = 2\n```\n\n段落\n')
  const clipboard = () => page.evaluate(() => window.typozaTest!.host.clipboard.text)
  await page.locator('.tz-editor .tz-code-block .cm-content').click()
  await runMenuCommand(page, 'code.copyBlock')
  await expect.poll(clipboard).toBe('const a = 1\nconst b = 2')
  await page.evaluate(() => {
    window.typozaTest!.host.clipboard.text = ''
  })
  await page.locator('.tz-editor .tz-code-block .tz-code-copy').click()
  await expect.poll(clipboard).toBe('const a = 1\nconst b = 2')
})
