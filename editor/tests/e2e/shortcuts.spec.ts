import { expect, test } from '@playwright/test'
import { loadDoc, markdown, modKey, openApp } from './helpers'

// 段落快捷键(notion-input.md 5.1 第 25~33 行、5.2「段落」行):对一段「文字」按键后的存储结果。

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

/** [按键(Mod 代表 ⌘ / Ctrl), 期望的 Markdown] */
const cases: [string, string][] = [
  ['Mod+1', '# 文字'],
  ['Mod+2', '## 文字'],
  ['Mod+3', '### 文字'],
  ['Mod+4', '#### 文字'],
  ['Mod+5', '##### 文字'],
  ['Mod+6', '###### 文字'],
  ['Mod+Alt+1', '# 文字'],
  ['Mod+Alt+2', '## 文字'],
  ['Mod+Alt+3', '### 文字'],
  ['Mod+Alt+4', '- [ ] 文字'],
  ['Mod+Alt+5', '- 文字'],
  ['Mod+Alt+6', '1. 文字'],
  ['Mod+Alt+7', '<details>\n<summary>文字</summary>\n\n</details>'],
  ['Mod+Alt+8', '```\n文字\n```'],
  ['Mod+Alt+x', '- [ ] 文字'],
  ['Mod+Alt+u', '- 文字'],
  ['Mod+Alt+o', '1. 文字'],
  ['Mod+Alt+q', '> 文字'],
  ['Mod+Alt+c', '```\n文字\n```'],
  ['Mod+Alt+b', '$$\n文字\n$$'],
]

for (const [keys, expected] of cases) {
  test(`段落快捷键 ${keys}`, async ({ page }) => {
    const mod = await modKey(page)
    await loadDoc(page, '文字\n')
    await page.keyboard.press(keys.replace('Mod', mod))
    expect((await markdown(page)).trim()).toBe(expected)
  })
}

test('⌘0 与 ⌥⌘0 转回正文', async ({ page }) => {
  const mod = await modKey(page)
  await loadDoc(page, '## 文字\n')
  await page.keyboard.press(`${mod}+0`)
  expect((await markdown(page)).trim()).toBe('文字')
  await loadDoc(page, '- 文字\n')
  await page.keyboard.press(`${mod}+Alt+0`)
  expect((await markdown(page)).trim()).toBe('文字')
})

test('提升 / 降低标题级别', async ({ page }) => {
  const mod = await modKey(page)
  await loadDoc(page, '## 文字\n')
  await page.keyboard.press(mod === 'Meta' ? 'Control+Meta+Equal' : 'Control+Equal')
  expect((await markdown(page)).trim()).toBe('# 文字')
  await page.keyboard.press(mod === 'Meta' ? 'Control+Meta+Minus' : 'Control+Minus')
  expect((await markdown(page)).trim()).toBe('## 文字')
})

test('⌥⌘- 分割线、⌥⌘R 脚注', async ({ page }) => {
  const mod = await modKey(page)
  await loadDoc(page, '文字\n')
  await page.keyboard.press(`${mod}+Alt+Minus`)
  await expect(page.locator('.tz-editor hr')).toHaveCount(1)
  await loadDoc(page, '文字\n')
  await page.keyboard.press(`${mod}+Alt+r`)
  const out = await markdown(page)
  expect(out).toContain('文字[^1]')
  expect(out).toContain('\n[^1]:')
})
