import { expect, test } from '@playwright/test'
import { loadDoc, markdown, modKey, openApp } from './helpers'

// 代码块、公式、图表(PRD 3.7)与自动转换的撤回(PRD 3.3「撤回」)。

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('``` 后回车建代码块,~~~ 同效', async ({ page }) => {
  await loadDoc(page, '')
  await page.keyboard.type('```py')
  await page.keyboard.press('Enter')
  await expect(page.locator('.tz-editor .tz-code-block')).toHaveCount(1)
  await page.keyboard.type('x = 1')
  expect((await markdown(page)).trim()).toBe('```py\nx = 1\n```')

  await loadDoc(page, '')
  await page.keyboard.type('~~~')
  await page.keyboard.press('Enter')
  await expect(page.locator('.tz-editor .tz-code-block')).toHaveCount(1)
})

test('代码工具:为整个代码块调整缩进(缩进宽度默认 2)', async ({ page }) => {
  await loadDoc(page, '```js\nfunction f() {\nreturn 1\n}\n```\n')
  // 语言包按需加载,出现语法高亮后按语言的缩进规则才可用
  await expect(page.locator('.tz-code-block .tok-keyword').first()).toBeVisible({ timeout: 15_000 })
  await page.locator('.tz-code-block .cm-line').nth(1).click()
  await page.evaluate(() => window.typozaTest!.host.emit('menu.command', { id: 'code.indentBlock' }))
  await expect.poll(async () => (await markdown(page)).trim()).toBe('```js\nfunction f() {\n  return 1\n}\n```')
})

test('自动转换后立即 ⌘Z 撤回为输入的原字符,且不再二次转换', async ({ page }) => {
  const mod = await modKey(page)
  await loadDoc(page, '')
  await page.keyboard.type('# ')
  await expect(page.locator('.tz-editor h1')).toHaveCount(1)
  await page.keyboard.press(`${mod}+z`)
  await expect(page.locator('.tz-editor h1')).toHaveCount(0)
  await page.keyboard.type('x')
  await expect(page.locator('.tz-editor p')).toHaveText('# x')

  await loadDoc(page, '')
  await page.keyboard.type('**粗**')
  await expect(page.locator('.tz-editor strong')).toHaveCount(1)
  await page.keyboard.press(`${mod}+z`)
  await expect(page.locator('.tz-editor strong')).toHaveCount(0)
  await expect(page.locator('.tz-editor p')).toHaveText('**粗**')
})

test('<网址> 敲完即成链接,保存仍写 <网址>', async ({ page }) => {
  await loadDoc(page, '')
  await page.keyboard.type('见 <https://example.com>')
  await expect(page.locator('.tz-editor a[href="https://example.com"]')).toHaveText('https://example.com')
  expect((await markdown(page)).trim()).toBe('见 <https://example.com>')
})

test('```math 显示为公式,源码原样保存', async ({ page }) => {
  const source = '```math\nE=mc^2\n```\n'
  await loadDoc(page, source)
  await expect(page.locator('.tz-code-block .tz-diagram-preview .katex').first()).toBeVisible({ timeout: 15_000 })
  expect(await markdown(page)).toBe(source)
})

test('公式语法错误显示错误提示,源码不清空', async ({ page }) => {
  const source = '$$\n\\frac{\n$$\n'
  await loadDoc(page, source)
  await expect(page.locator('.tz-math-preview.is-error')).toBeVisible({ timeout: 15_000 })
  expect(await markdown(page)).toBe(source)
})

test('\\tag 与 \\label / \\eqref:引用显示编号;刷新所有数学公式', async ({ page }) => {
  await loadDoc(page, '$$\nE=mc^2 \\tag{1} \\label{eq:e}\n$$\n\n$$\n\\eqref{eq:e}\n$$\n')
  const second = page.locator('.tz-math-preview').nth(1)
  await expect(second.locator('.katex')).toBeVisible({ timeout: 15_000 })
  await expect(second).toContainText('(1)')
  await page.evaluate(() => window.typozaTest!.host.emit('menu.command', { id: 'math.refresh' }))
  await expect(second).toContainText('(1)')
})

test('mermaid、sequence、flow 渲染为图;语法错误保留源码', async ({ page }) => {
  await loadDoc(page, '```sequence\nAlice->Bob: 你好\n```\n\n```flow\nst=>start: 开始\ne=>end: 结束\nst->e\n```\n\n```mermaid\ngraph TD\n  A-->B\n```\n')
  const previews = page.locator('.tz-diagram-preview')
  for (let i = 0; i < 3; i++) await expect(previews.nth(i).locator('svg')).toBeVisible({ timeout: 20_000 })

  const broken = '```sequence\n这不是时序图\n```\n'
  await loadDoc(page, broken)
  await expect(page.locator('.tz-diagram-preview.is-error')).toContainText('sequence 语法错误')
  expect(await markdown(page)).toBe(broken)
})
