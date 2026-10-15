import { expect, test } from '@playwright/test'

test('编辑器在 WebKit 中加载并可输入', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.ProseMirror')
  await expect(editor).toHaveText('Typoza')
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' 你好')
  await expect(editor).toHaveText('Typoza 你好')
  await page.screenshot({ path: 'test-results/screens/smoke.png' })
})
