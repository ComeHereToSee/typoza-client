import { expect, type Page, test } from '@playwright/test'
import { loadDoc, markdown, modKey, openApp } from './helpers'

// Notion 块操作(notion-input.md 第七节):块选中态、多块选择、块菜单、⌘/ 转换为。

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

/** 鼠标移到块上,点「⋮⋮」打开块菜单。 */
async function openBlockMenu(page: Page, block: ReturnType<Page['locator']>) {
  await block.hover()
  const grip = page.locator('.tz-handle-grip')
  await expect(grip).toBeVisible()
  await grip.click()
  const menu = page.locator('.tz-block-menu').first()
  await expect(menu).toBeVisible()
  return menu
}

test('块选中态直接输入文字:不改内容,退出选中态', async ({ page }) => {
  await loadDoc(page, '第一段\n\n第二段\n')
  await page.keyboard.press('Escape')
  await expect(page.locator('.tz-editor .ProseMirror-selectednode')).toHaveText('第二段')
  await page.keyboard.type('x')
  expect((await markdown(page)).trim()).toBe('第一段\n\n第二段')
  await expect(page.locator('.tz-editor .ProseMirror-selectednode')).toHaveCount(0)
  // 退出后光标在块末尾,继续输入正常
  await page.keyboard.type('y')
  expect((await markdown(page)).trim()).toBe('第一段\n\n第二段y')
})

test('⇧↑ 扩选多块后 ⌘D 复制、⌫ 删除', async ({ page }) => {
  const mod = await modKey(page)
  await loadDoc(page, '一\n\n二\n\n三\n')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Shift+ArrowUp')
  await expect(page.locator('.tz-editor .tz-block-selected')).toHaveCount(2)
  await page.keyboard.press(`${mod}+d`)
  expect((await markdown(page)).trim()).toBe('一\n\n二\n\n三\n\n二\n\n三')
  await page.keyboard.press('Backspace')
  expect((await markdown(page)).trim()).toBe('一\n\n二\n\n三')
})

test('⇧+点击选连续多块,⇧⌘+点击增减单块', async ({ page }) => {
  const mod = await modKey(page)
  await loadDoc(page, 'A\n\nB\n\nC\n')
  const paras = page.locator('.tz-editor p')
  await paras.nth(0).click()
  await paras.nth(2).click({ modifiers: ['Shift'] })
  await expect(page.locator('.tz-editor .tz-block-selected')).toHaveCount(3)
  await paras.nth(1).click({ modifiers: ['Shift', mod] })
  await expect(page.locator('.tz-editor .tz-block-selected')).toHaveText(['A', 'C'])
  // 状态栏显示所选块字数
  await expect(page.locator('.tz-statusbar')).toContainText('已选 2 字')
})

test('正文左侧空白处按下拖动框选', async ({ page }) => {
  await loadDoc(page, '甲\n\n乙\n\n丙\n')
  const editor = await page.locator('.tz-editor').boundingBox()
  const first = await page.locator('.tz-editor p').nth(0).boundingBox()
  const last = await page.locator('.tz-editor p').nth(2).boundingBox()
  if (!editor || !first || !last) throw new Error('取不到块的位置')
  const x = editor.x - 80
  await page.mouse.move(x, first.y + 4)
  await page.mouse.down()
  await page.mouse.move(x, (first.y + last.y) / 2, { steps: 4 })
  await page.mouse.move(x, last.y + last.height / 2, { steps: 4 })
  await page.mouse.up()
  await expect(page.locator('.tz-editor .tz-block-selected')).toHaveCount(3)
})

test('块选中态粘贴插在所选块下方', async ({ page }) => {
  await loadDoc(page, '一\n\n二\n')
  await page.locator('.tz-editor p').nth(0).click()
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.typozaTest!.app.view.pasteText('新段落'))
  expect((await markdown(page)).trim()).toBe('一\n\n新段落\n\n二')
})

test('⌘/ 在块选中态转换多块;搜索框可输入类型名', async ({ page }) => {
  const mod = await modKey(page)
  await loadDoc(page, '一\n\n二\n\n三\n')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Shift+ArrowUp')
  await page.keyboard.press(`${mod}+/`)
  const menu = page.locator('.tz-turn-menu')
  await expect(menu.locator('.tz-menu-search')).toBeFocused()
  await page.keyboard.type('h2')
  await expect(menu.locator('.tz-menu-item').first()).toContainText('标题 2')
  await page.keyboard.press('Enter')
  expect((await markdown(page)).trim()).toBe('一\n\n## 二\n\n## 三')
})

test('⌘/ 含折叠标题与新文档;不可转换的块只给块操作', async ({ page }) => {
  const mod = await modKey(page)
  await loadDoc(page, '文字\n')
  await page.keyboard.press(`${mod}+/`)
  const menu = page.locator('.tz-turn-menu')
  await expect(menu.locator('.tz-menu-item', { hasText: '折叠标题 3' })).toHaveCount(1)
  await expect(menu.locator('.tz-menu-item', { hasText: '新文档' })).toHaveCount(1)
  await page.keyboard.press('Escape')

  await loadDoc(page, '文字\n\n***\n')
  await page.locator('.tz-editor hr').click()
  await expect(page.locator('.tz-editor hr.ProseMirror-selectednode')).toHaveCount(1)
  await page.keyboard.press(`${mod}+/`)
  await expect(page.locator('.tz-turn-menu .tz-menu-label')).toHaveText(['创建副本', '移动到…', '复制为 Markdown', '删除'])
})

test('块菜单:条目、颜色显示规则、底部字数', async ({ page }) => {
  await loadDoc(page, '# 标题\n\n五个字正文\n\n```js\nx\n```\n')
  let menu = await openBlockMenu(page, page.locator('.tz-editor p').first())
  await expect(menu.locator('.tz-menu-label')).toHaveText(['转换为', '颜色', '创建副本', '移动到…', '复制为 Markdown', '删除'])
  await expect(menu.locator('.tz-menu-footer')).toHaveText('字数 5 · 字符 5')
  // 点正文关闭菜单
  await page.locator('.tz-editor p').first().click()
  await expect(page.locator('.tz-block-menu')).toHaveCount(0)

  // 标题块多一项「复制块链接」
  menu = await openBlockMenu(page, page.locator('.tz-editor h1'))
  await expect(menu.locator('.tz-menu-item', { hasText: '复制块链接' })).toHaveCount(1)
  await page.locator('.tz-editor p').first().click()
  await expect(page.locator('.tz-block-menu')).toHaveCount(0)

  // 代码块不显示「颜色」
  menu = await openBlockMenu(page, page.locator('.tz-editor .tz-code-block'))
  await expect(menu.locator('.tz-menu-item', { hasText: '颜色' })).toHaveCount(0)
  await expect(menu.locator('.tz-menu-item', { hasText: '转换为' })).toHaveCount(1)
})

test('块菜单「转换为」带搜索框;「删除」删除该块', async ({ page }) => {
  await loadDoc(page, '甲\n\n乙\n')
  const menu = await openBlockMenu(page, page.locator('.tz-editor p').first())
  // 悬停只展开子菜单;点击展开时焦点进搜索框
  await menu.locator('.tz-menu-item', { hasText: '转换为' }).hover()
  const search = page.locator('.tz-block-menu .tz-menu-search')
  await expect(search).toBeVisible()
  await menu.locator('.tz-menu-item', { hasText: '转换为' }).click()
  await expect(search).toBeFocused()
  await page.keyboard.type('引用')
  await page.keyboard.press('Enter')
  expect((await markdown(page)).trim()).toBe('> 甲\n\n乙')

  const again = await openBlockMenu(page, page.locator('.tz-editor p').last())
  await again.locator('.tz-menu-item', { hasText: '删除' }).click()
  expect((await markdown(page)).trim()).toBe('> 甲')
})

test('标注块的「颜色」切换类型', async ({ page }) => {
  await loadDoc(page, '> [!NOTE]\n> 内容\n')
  const menu = await openBlockMenu(page, page.locator('.tz-editor .tz-callout p'))
  await menu.locator('.tz-menu-item', { hasText: '颜色' }).hover()
  await page.locator('.tz-block-menu .tz-menu-item', { hasText: '警告' }).click()
  expect((await markdown(page)).trim()).toBe('> [!WARNING]\n> 内容')
})

test('块菜单「移动到…」:块追加到目标文档末尾并从当前文档删除', async ({ page }) => {
  await loadDoc(page, '留下\n\n移走\n')
  const menu = await openBlockMenu(page, page.locator('.tz-editor p').last())
  await menu.locator('.tz-menu-item', { hasText: '移动到' }).click()
  const picker = page.locator('.tz-pick-menu')
  await expect(picker.locator('.tz-menu-search')).toBeFocused()
  await page.keyboard.type('另一篇')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await markdown(page)).trim()).toBe('留下')
  const target = await page.evaluate(async () => (await window.typozaTest!.host.readText('/demo/另一篇.md')).text)
  expect(target).toBe('# 另一篇\n\n用于测试文档链接。\n\n移走\n')
})
