import { expect, test } from '@playwright/test'
import { loadDoc, openApp } from './helpers'

// 行内 HTML 里的图片(如带链接的图片 <a><img></a>)同样双击放大,并参与灯箱的前后切换。
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('双击行内 HTML 里的图片打开灯箱,与普通图片一起计数', async ({ page }) => {
  await loadDoc(page, `![普通](${PNG})\n\n前文 <a href="https://example.com"><img src="${PNG}" alt="行内" width="40" height="40"></a> 后文\n`)
  const inline = page.locator('.tz-editor .tz-html-inline img')
  await expect(inline).toHaveCount(1)
  await inline.dblclick()
  await expect(page.locator('.tz-lightbox')).toBeVisible()
  await expect(page.locator('.tz-lb-counter')).toHaveText('2 / 2')
})
