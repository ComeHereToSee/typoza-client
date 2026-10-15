import { expect, test } from '@playwright/test'
import { loadDoc, markdown, modKey, openApp } from './helpers'

// 折叠块与折叠标题(notion-input.md 2.1 第 9~11 行、7.5)。

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('> 建折叠块,展开时标题行回车进入内容,⌥⌘T 全部收起 / 展开', async ({ page }) => {
  const mod = await modKey(page)
  await loadDoc(page, '')
  await page.keyboard.type('> 标题')
  await page.keyboard.press('Enter')
  await page.keyboard.type('内容')
  expect((await markdown(page)).trim()).toBe('<details>\n<summary>标题</summary>\n\n内容\n\n</details>')
  await page.keyboard.press(`${mod}+Alt+t`)
  await expect(page.locator('.tz-editor .tz-toggle.is-open')).toHaveCount(0)
  await page.keyboard.press(`${mod}+Alt+t`)
  await expect(page.locator('.tz-editor .tz-toggle.is-open')).toHaveCount(1)
  // 展开收起只是界面状态,不写进文件
  expect((await markdown(page)).trim()).toBe('<details>\n<summary>标题</summary>\n\n内容\n\n</details>')
})

test('收起时标题行末尾回车:在折叠块下方新建同级块', async ({ page }) => {
  const mod = await modKey(page)
  await loadDoc(page, '')
  await page.keyboard.type('> 标题')
  await page.keyboard.press(`${mod}+Enter`)
  await expect(page.locator('.tz-editor .tz-toggle.is-open')).toHaveCount(0)
  await page.keyboard.press('Enter')
  await page.keyboard.type('后面')
  expect((await markdown(page)).trim()).toBe('<details>\n<summary>标题</summary>\n\n</details>\n\n后面')
})

test('空标题里敲 > 变折叠标题;空折叠块里敲 ## 也变折叠标题', async ({ page }) => {
  await loadDoc(page, '')
  await page.keyboard.type('## ')
  await page.keyboard.type('>')
  await page.keyboard.type('二级')
  expect((await markdown(page)).trim()).toBe('<details>\n<summary><h2>二级</h2></summary>\n\n</details>')

  await loadDoc(page, '')
  await page.keyboard.type('> ')
  await page.keyboard.type('### ')
  await page.keyboard.type('三级')
  expect((await markdown(page)).trim()).toBe('<details>\n<summary><h3>三级</h3></summary>\n\n</details>')
})

test('折叠块内容为空时在标题开头退格:还原为正文', async ({ page }) => {
  await loadDoc(page, '')
  await page.keyboard.type('> 标题')
  await page.keyboard.press('Home')
  await page.keyboard.press('Backspace')
  expect((await markdown(page)).trim()).toBe('标题')
})

test('⌘/ 把段落转成折叠标题 1', async ({ page }) => {
  const mod = await modKey(page)
  await loadDoc(page, '文字\n')
  await page.keyboard.press(`${mod}+/`)
  await page.keyboard.type('折叠标题1')
  await page.keyboard.press('Enter')
  expect((await markdown(page)).trim()).toBe('<details>\n<summary><h1>文字</h1></summary>\n\n</details>')
})
