import { expect, test } from '@playwright/test'
import { loadDoc, markdown, openApp } from './helpers'

// 斜杠菜单(notion-input.md 4.1、4.2)与 [[ 文档链接(4.3)。

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

const menu = '.tz-slash-menu'

test('条目名按 PRD,中文名不计空格也能命中', async ({ page }) => {
  await loadDoc(page, '')
  await page.keyboard.type('/标题1')
  await expect(page.locator(`${menu} .tz-menu-item`).first()).toContainText('标题 1')
  await page.keyboard.press('Enter')
  await page.keyboard.type('大标题')
  expect((await markdown(page)).trim()).toBe('# 大标题')
})

test('/blue background 命中蓝色背景,/callout 默认提醒类', async ({ page }) => {
  await loadDoc(page, '')
  await page.keyboard.type('/blue background')
  await expect(page.locator(`${menu} .tz-menu-item`).first()).toContainText('蓝色背景')
  await page.keyboard.press('Escape')
  await expect(page.locator(menu)).toHaveCount(0)

  await loadDoc(page, '')
  await page.keyboard.type('/callout')
  await expect(page.locator(`${menu} .tz-menu-item`).first()).toContainText('标注块')
  await page.keyboard.press('Enter')
  await page.keyboard.type('提示')
  expect((await markdown(page)).trim()).toBe('> [!NOTE]\n> 提示')
})

test('无匹配显示「无结果」,再输入 2 个字符仍无匹配自动关闭', async ({ page }) => {
  await loadDoc(page, '')
  // 「/qq」时开始无匹配,再输入 z、x 两个字符后关闭
  await page.keyboard.type('/qq')
  await expect(page.locator(`${menu} .tz-menu-empty`)).toHaveText('无结果')
  await page.keyboard.type('z')
  await expect(page.locator(menu)).toBeVisible()
  await page.keyboard.type('x')
  await expect(page.locator(menu)).toHaveCount(0)
  expect((await markdown(page)).trim()).toBe('/qqzx')
})

test('/ 在标点后触发,单词中间不触发', async ({ page }) => {
  await loadDoc(page, '')
  await page.keyboard.type('a/')
  await expect(page.locator(menu)).toHaveCount(0)
  await page.keyboard.type(',/')
  await expect(page.locator(menu)).toBeVisible()
})

test('当前块有内容时,块类型条目插在下方而不是转换', async ({ page }) => {
  await loadDoc(page, '已有文字')
  await page.keyboard.type(' /h2')
  await expect(page.locator(`${menu} .tz-menu-item`).first()).toContainText('标题 2')
  await page.keyboard.press('Enter')
  await page.keyboard.type('新标题')
  expect((await markdown(page)).trim()).toBe('已有文字\n\n## 新标题')
})

test('/日期 子菜单插入今天的日期文字', async ({ page }) => {
  await loadDoc(page, '')
  await page.keyboard.type('/date')
  await expect(page.locator(`${menu} .tz-menu-item`).first()).toContainText('日期')
  await page.keyboard.press('Enter')
  await expect(page.locator(`${menu} .tz-menu-item`, { hasText: '今天' })).toBeVisible()
  await page.keyboard.press('Enter')
  expect((await markdown(page)).trim()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
})

test('/warning 插入警告提示框,/toggleh2 插入折叠标题 2', async ({ page }) => {
  await loadDoc(page, '')
  await page.keyboard.type('/warning')
  await expect(page.locator(`${menu} .tz-menu-item`).first()).toContainText('提示框:警告')
  await page.keyboard.press('Enter')
  await page.keyboard.type('小心')
  expect((await markdown(page)).trim()).toBe('> [!WARNING]\n> 小心')

  await loadDoc(page, '')
  await page.keyboard.type('/toggleh2')
  await page.keyboard.press('Enter')
  await page.keyboard.type('章节')
  expect((await markdown(page)).trim()).toBe('<details>\n<summary><h2>章节</h2></summary>\n\n</details>')
})

test('[[ 就地模糊匹配文档,链接标题取目标文档首个一级标题', async ({ page }) => {
  await loadDoc(page, '')
  await page.keyboard.type('见 [[另一')
  const item = page.locator(`${menu} .tz-menu-item`, { hasText: '另一篇' })
  await expect(item).toBeVisible()
  await page.keyboard.press('Enter')
  expect((await markdown(page)).trim()).toBe('见 [另一篇](另一篇.md)')
})

test('[[ 末项「+ 新建『关键字』」:在当前文件夹新建并插入链接', async ({ page }) => {
  await loadDoc(page, '')
  await page.keyboard.type('[[新笔记')
  const create = page.locator(`${menu} .tz-menu-item`).last()
  await expect(create).toContainText('+ 新建『新笔记』')
  await create.click()
  await expect.poll(async () => (await markdown(page)).trim()).toBe('[新笔记](新笔记.md)')
  const created = await page.evaluate(async () => (await window.typozaTest!.host.readText('/demo/新笔记.md')).text)
  expect(created).toBe('# 新笔记\n')
})

test('/链接到文档 打开 [[ 菜单', async ({ page }) => {
  await loadDoc(page, '')
  await page.keyboard.type('/link')
  await expect(page.locator(`${menu} .tz-menu-item`).first()).toContainText('链接到文档')
  await page.keyboard.press('Enter')
  await expect(page.locator(`${menu} .tz-menu-item`, { hasText: '另一篇' })).toBeVisible()
})
