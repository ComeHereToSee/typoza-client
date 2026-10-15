import { expect, test } from '@playwright/test'
import { openApp } from './helpers'

// 用户点名场景:文档里有标题、段落、表单截图、配置表格混排,双击任意图片(包括表格里的)放大查看。
test.describe('图片灯箱', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await expect(page.locator('.tz-editor table .tz-image img').first()).toBeVisible()
  })

  test('双击表格里的图片打开灯箱,可切换、缩放、关闭', async ({ page }) => {
    const tableImage = page.locator('.tz-editor table .tz-image').first()
    await tableImage.dblclick()
    const box = page.locator('.tz-lightbox')
    await expect(box).toBeVisible()
    await expect(page.locator('.tz-lb-counter')).toHaveText('2 / 4')
    const img = page.locator('.tz-lb-img')
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
    await page.screenshot({ path: 'test-results/screens/lightbox-open.png' })

    // ← / → 切换本文档的全部图片
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.tz-lb-counter')).toHaveText('3 / 4')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.tz-lb-counter')).toHaveText('1 / 4')

    // 缩放:+ 放大,0 适配,1 原始大小
    const zoom = page.locator('.tz-lb-zoom')
    const fitted = await zoom.textContent()
    await page.keyboard.press('+')
    await expect(zoom).not.toHaveText(fitted ?? '')
    await page.keyboard.press('1')
    await expect(zoom).toHaveText('100%')
    await page.keyboard.press('0')
    await expect(zoom).toHaveText(fitted ?? '')

    // 双击灯箱里的图片:适配 ↔ 放大
    await img.dblclick()
    await expect(box).toHaveClass(/is-zoomed/)
    await page.screenshot({ path: 'test-results/screens/lightbox-zoomed.png' })

    await page.keyboard.press('Escape')
    await expect(box).toHaveCount(0)
  })

  test('双击正文大图打开,点空白处关闭', async ({ page }) => {
    await page.locator('.tz-editor > p .tz-image').first().dblclick()
    await expect(page.locator('.tz-lb-counter')).toHaveText('1 / 4')
    // 左上角空白处(避开左右切换按钮与右上工具条)
    await page.mouse.click(60, 60)
    await expect(page.locator('.tz-lightbox')).toHaveCount(0)
  })

  test('动图在表格里正常显示并可放大', async ({ page }) => {
    const gif = page.locator('.tz-editor table img[data-tz-src="assets/anim.gif"]')
    await expect.poll(() => gif.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
    await gif.dblclick()
    await expect(page.locator('.tz-lb-counter')).toHaveText('4 / 4')
  })

  test('选中图片按空格也能打开(Notion)', async ({ page }) => {
    await page.locator('.tz-editor > p .tz-image img').first().click()
    await page.keyboard.press(' ')
    await expect(page.locator('.tz-lightbox')).toBeVisible()
  })
})
