import { expect, type Page, test } from '@playwright/test'
import { loadDoc, markdown, modKey, openApp } from './helpers'

// 表格(PRD 3.6、对照表 X-36~X-38):键位、行列选择弹窗、工具条、行列拖动、批量填充与序列化。

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

const rows = (page: Page) => page.locator('.tz-editor tr')
const cell = (page: Page, text: string) => page.locator('.tz-editor td, .tz-editor th').filter({ hasText: new RegExp(`^${text}$`) })

test('|a|b| 回车建表,Tab 跳格,末格 Tab 新增一行', async ({ page }) => {
  await loadDoc(page, '')
  await page.keyboard.type('|a|b|')
  await page.keyboard.press('Enter')
  await expect(rows(page)).toHaveCount(2)
  await page.keyboard.type('1')
  await page.keyboard.press('Tab')
  await page.keyboard.type('2')
  await page.keyboard.press('Tab')
  await expect(rows(page)).toHaveCount(3)
  await page.keyboard.type('3')
  expect(await markdown(page)).toContain('| a | b |\n| - | - |\n| 1 | 2 |\n| 3 |')
})

test('⌘↩ 下方插入行,⇧⌘⌫ 删除行', async ({ page }) => {
  const mod = await modKey(page)
  await loadDoc(page, '| a | b |\n| - | - |\n| 1 | 2 |\n')
  await cell(page, '1').click()
  await page.keyboard.press(`${mod}+Enter`)
  await expect(rows(page)).toHaveCount(3)
  await page.keyboard.press(`${mod}+Shift+Backspace`)
  await expect(rows(page)).toHaveCount(2)
})

test('⌃⌘↓ 下移该行', async ({ page }) => {
  const mod = await modKey(page)
  await loadDoc(page, '| a |\n| - |\n| 1 |\n| 2 |\n')
  await cell(page, '1').click()
  await page.keyboard.press(mod === 'Meta' ? 'Control+Meta+ArrowDown' : 'Control+ArrowDown')
  expect((await markdown(page)).trim()).toBe('| a |\n| - |\n| 2 |\n| 1 |')
})

test('⌥⇧⌘T 弹窗选行列后插入表格', async ({ page }) => {
  await loadDoc(page, '')
  await page.evaluate(() => window.typozaTest!.host.emit('menu.command', { id: 'insert.table' }))
  const dialog = page.locator('.tz-table-size')
  await expect(dialog).toBeVisible()
  await dialog.locator('.tz-table-size-input').nth(0).fill('4')
  await dialog.locator('.tz-table-size-input').nth(1).fill('2')
  await dialog.locator('.tz-table-size-input').nth(1).press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(rows(page)).toHaveCount(2)
  await expect(page.locator('.tz-editor th')).toHaveCount(4)
})

test('多选单元格:⌘D 向下填充,⌘R 向右填充', async ({ page }) => {
  const mod = await modKey(page)
  await loadDoc(page, '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n')
  // 第 row 行(表头为 0)第 col 列的单元格
  const at = (row: number, col: number) => rows(page).nth(row).locator('td, th').nth(col)
  const drag = async (from: [number, number], to: [number, number]) => {
    const a = await at(...from).boundingBox()
    const b = await at(...to).boundingBox()
    if (!a || !b) throw new Error('取不到单元格位置')
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 })
    await page.mouse.up()
    await expect(page.locator('.tz-editor .selectedCell')).toHaveCount(2)
  }
  await drag([1, 0], [2, 0])
  await page.keyboard.press(`${mod}+d`)
  expect((await markdown(page)).trim()).toBe('| a | b |\n| - | - |\n| 1 | 2 |\n| 1 | 4 |')
  await drag([1, 0], [1, 1])
  await page.keyboard.press(`${mod}+r`)
  expect((await markdown(page)).trim()).toBe('| a | b |\n| - | - |\n| 1 | 1 |\n| 1 | 4 |')
})

test('工具条:调整行列数、更多 ▸ 格式化源码', async ({ page }) => {
  await loadDoc(page, '|a|b|\n|-|-|\n|1|2|\n')
  await cell(page, '1').click()
  const toolbar = page.locator('.tz-table-toolbar')
  await expect(toolbar).toBeVisible()
  await toolbar.locator('button[title="更多"]').click()
  await page.locator('.tz-table-more .tz-menu-item', { hasText: '格式化源码' }).click()
  expect((await markdown(page)).trim()).toBe('| a | b |\n| - | - |\n| 1 | 2 |')

  await toolbar.locator('button[title="调整行列数"]').click()
  const dialog = page.locator('.tz-table-size')
  await expect(dialog).toBeVisible()
  await dialog.locator('.tz-table-size-input').nth(0).fill('3')
  await dialog.locator('.tz-table-size-input').nth(1).fill('4')
  await dialog.locator('.tz-table-size-input').nth(1).press('Enter')
  await expect(rows(page)).toHaveCount(4)
  await expect(page.locator('.tz-editor th')).toHaveCount(3)
})

test('拖行左边框调整行的位置', async ({ page }) => {
  await loadDoc(page, '| a |\n| - |\n| 1 |\n| 2 |\n| 3 |\n')
  await cell(page, '1').hover()
  const grip = page.locator('.tz-table-grip-row')
  await expect(grip).toBeVisible()
  const g = await grip.boundingBox()
  const target = await cell(page, '3').boundingBox()
  if (!g || !target) throw new Error('取不到手柄位置')
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
  await page.mouse.down()
  await page.mouse.move(g.x + g.width / 2, target.y + target.height / 2, { steps: 6 })
  await page.mouse.up()
  expect((await markdown(page)).trim()).toBe('| a |\n| - |\n| 2 |\n| 3 |\n| 1 |')
})
