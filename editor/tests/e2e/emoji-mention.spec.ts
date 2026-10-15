import { expect, test } from '@playwright/test'
import { loadDoc, markdown, openApp } from './helpers'

// Notion 的 : 表情与 @ 提及;Typora 的 :smile: 短码显示。

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('冒号表情:输入 2 个字符后弹出,回车插入 Unicode 表情', async ({ page }) => {
  await loadDoc(page, '')
  await page.keyboard.type('好 :s')
  const menu = page.locator('.tz-suggest-menu')
  await expect(menu).toHaveCount(0)
  await page.keyboard.type('mile')
  await expect(menu.locator('.tz-menu-item').first()).toContainText(':smile:')
  await page.keyboard.press('Enter')
  await expect(menu).toHaveCount(0)
  expect((await markdown(page)).trim()).toBe('好 😄')
})

test('冒号表情:中文名搜索', async ({ page }) => {
  await loadDoc(page, '')
  await page.keyboard.type(':猫脸')
  const first = page.locator('.tz-suggest-menu .tz-menu-item').first()
  await expect(first).toContainText('🐱')
  await first.click()
  expect((await markdown(page)).trim()).toBe('🐱')
})

test('冒号表情:敲完整短码直接换成表情;时间里的冒号不触发', async ({ page }) => {
  await loadDoc(page, '')
  await page.keyboard.type('会议 10:30 开始 :tada:')
  await expect.poll(async () => (await markdown(page)).trim()).toBe('会议 10:30 开始 🎉')
  await expect(page.locator('.tz-suggest-menu')).toHaveCount(0)
  await page.keyboard.type(' 网址 https://example.com')
  await expect(page.locator('.tz-suggest-menu')).toHaveCount(0)
})

test('冒号表情:Esc 收起后照常输入文字', async ({ page }) => {
  await loadDoc(page, '')
  await page.keyboard.type(':sm')
  await expect(page.locator('.tz-suggest-menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.tz-suggest-menu')).toHaveCount(0)
  await page.keyboard.type('art')
  expect((await markdown(page)).trim()).toBe(':smart')
})

test('Typora 短码 :white_check_mark: 显示成表情,源文字原样保存', async ({ page }) => {
  await loadDoc(page, '完成 :white_check_mark: 了\n\n`:smile:` 在代码里不变\n')
  const emoji = page.locator('.tz-editor .tz-emoji')
  await expect(emoji).toHaveCount(1)
  await expect(emoji).toHaveText('✅️')
  expect(await markdown(page)).toBe('完成 :white_check_mark: 了\n\n`:smile:` 在代码里不变\n')
  // 光标移到短码处露出源文字
  await page.locator('.tz-editor p').first().click({ position: { x: 2, y: 8 } })
  await page.keyboard.press('Home')
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
  await expect(emoji).toHaveCount(0)
})

test('@ 提及日期:插入日期文字', async ({ page }) => {
  await loadDoc(page, '')
  await page.keyboard.type('截止 @')
  const menu = page.locator('.tz-suggest-menu')
  await expect(menu.locator('.tz-menu-group').first()).toHaveText('日期')
  await page.keyboard.type('明天')
  const item = menu.locator('.tz-menu-item').first()
  await expect(item).toContainText('明天')
  const date = (await item.locator('.tz-menu-hint').textContent()) ?? ''
  expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  await page.keyboard.press('Enter')
  expect((await markdown(page)).trim()).toBe(`截止 ${date}`)
})

test('@ 提及文档:插入相对链接;邮箱里的 @ 不触发', async ({ page }) => {
  await loadDoc(page, '')
  await page.keyboard.type('邮箱 me@example.com 见 @另一')
  const item = page.locator('.tz-suggest-menu .tz-menu-item', { hasText: '另一篇' })
  await expect(item).toBeVisible()
  await page.keyboard.press('Enter')
  await page.keyboard.type('。')
  expect((await markdown(page)).trim()).toBe('邮箱 me@example.com 见 [另一篇](另一篇.md) 。')
})
