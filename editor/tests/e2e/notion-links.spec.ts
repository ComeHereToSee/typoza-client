import { expect, test } from '@playwright/test'
import { loadDoc, modKey, openApp } from './helpers'

// ⌘+点击:脚注跳到定义、未定义提示(对照表 X-46)、未定义引用链接提示(X-13)、[[文档名]] 打开(notion-input.md 4.3);
// 焦点不在正文时 ⌘K 打开快速打开(5.1 第 2 行)。

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('脚注:单击不跳转,⌘+点击跳到定义;未定义时提示语法', async ({ page }) => {
  const mod = await modKey(page)
  await loadDoc(page, '正文[^1]\n\n[^1]: 定义内容\n')
  const ref = page.locator('.tz-editor .tz-footnote-ref')
  await ref.click()
  const parentText = () => page.evaluate(() => window.typozaTest!.app.view.state.selection.$from.parent.textContent)
  expect(await parentText()).not.toBe('定义内容')
  await ref.click({ modifiers: [mod] })
  await expect.poll(parentText).toBe('定义内容')

  // 删掉定义后再 ⌘+点击:提示定义语法(没有定义的 [^x] 在打开文件时不会被识别为脚注,所以在编辑中删定义)
  await page.evaluate(() => {
    const view = window.typozaTest!.app.view
    let from = -1
    let to = -1
    view.state.doc.forEach((node, offset) => {
      if (node.type.name === 'footnote_def') {
        from = offset
        to = offset + node.nodeSize
      }
    })
    view.dispatch(view.state.tr.delete(from, to))
  })
  await page.locator('.tz-editor .tz-footnote-ref').click({ modifiers: [mod] })
  await expect(page.locator('.tz-toast')).toHaveText('请按语法 [^1]: www.example.com 定义脚注 1')
})

test('未定义的引用式链接 ⌘+点击提示定义语法', async ({ page }) => {
  const mod = await modKey(page)
  await loadDoc(page, '见 [文字][缺失]\n')
  const p = page.locator('.tz-editor p')
  const box = await p.boundingBox()
  if (!box) throw new Error('取不到段落位置')
  // 点在行尾(仍在 [文字][缺失] 范围的末端)
  await p.click({ modifiers: [mod], position: { x: box.width - 4, y: box.height / 2 } })
  await expect(page.locator('.tz-toast')).toHaveText('请按语法 [缺失]: www.example.com 定义链接 [文字]')
})

test('[[文档名]] 单击不打开,⌘+点击在新标签页打开;同名优先同文件夹', async ({ page }) => {
  const mod = await modKey(page)
  await page.evaluate(() => {
    window.typozaTest!.host.files.set('/demo/sub/另一篇.md', { kind: 'file', data: '# 子文件夹里的\n', mtime: Date.now() })
  })
  await page.evaluate(() => window.typozaTest!.load('见 [[另一篇]]\n', '/demo/sub/当前.md'))
  const opened = () =>
    page.evaluate(() => window.typozaTest!.host.calls.filter((c) => c.method === 'openDocument').map((c) => [c.args[0], (c.args[1] as { tab?: boolean }).tab]))
  const link = page.locator('.tz-editor .tz-wikilink')
  await link.click()
  expect(await opened()).toEqual([])
  await link.click({ modifiers: [mod] })
  await expect.poll(opened).toEqual([['/demo/sub/另一篇.md', true]])
})

test('焦点不在正文时 ⌘K 打开快速打开', async ({ page }) => {
  const mod = await modKey(page)
  await loadDoc(page, '文字\n')
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press(`${mod}+k`)
  await expect(page.locator('.tz-quick-open')).toBeVisible()
})
