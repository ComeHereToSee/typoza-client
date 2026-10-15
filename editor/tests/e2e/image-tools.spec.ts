import { expect, test } from '@playwright/test'
import { loadDoc, markdown, openApp } from './helpers'
import { hostCalls, runMenuCommand } from './media-helpers'

// PRD 3.4 单击 / 尺寸存储;对照表 M-13 ~ M-28(差距清单 11、42、56)
test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('工具条选比例写 zoom,选 100% 回到 Markdown 写法', async ({ page }) => {
  await loadDoc(page, '![表单](assets/form.svg)\n')
  await page.locator('.tz-editor .tz-image img').click()
  const select = page.locator('.tz-editor .tz-image-zoom')
  await expect(select.locator('option')).toHaveText(['缩放', '25%', '33%', '50%', '67%', '80%', '100%', '150%', '200%'])
  await select.selectOption('50%')
  await expect.poll(() => markdown(page)).toBe('<img src="assets/form.svg" alt="表单" style="zoom:50%;" />\n')
  await select.selectOption('100%')
  await expect.poll(() => markdown(page)).toBe('![表单](assets/form.svg)\n')
})

test('拖右下角手柄写宽度像素', async ({ page }) => {
  await loadDoc(page, '![表单](assets/form.svg)\n')
  const img = page.locator('.tz-editor .tz-image img')
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
  await img.click()
  const before = (await img.boundingBox())!.width
  const handle = (await page.locator('.tz-editor .tz-image-handle-se').boundingBox())!
  const x = handle.x + handle.width / 2
  const y = handle.y + handle.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 150, y, { steps: 6 })
  await page.mouse.up()
  await expect.poll(() => markdown(page)).toMatch(/^<img src="assets\/form\.svg" alt="表单" width="\d+" \/>\n$/)
  const width = Number(/width="(\d+)"/.exec(await markdown(page))?.[1])
  expect(Math.abs(width - (before - 150))).toBeLessThanOrEqual(4)
})

test('左上角手柄向右拖是缩小', async ({ page }) => {
  await loadDoc(page, '<img src="assets/id.svg" alt="标识" width="300" />\n')
  const img = page.locator('.tz-editor .tz-image img')
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
  await img.click()
  const handle = (await page.locator('.tz-editor .tz-image-handle-nw').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + 100, handle.y + handle.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => Number(/width="(\d+)"/.exec(await markdown(page))?.[1])).toBeLessThan(210)
  expect(await markdown(page)).toMatch(/^<img src="assets\/id\.svg" alt="标识" width="(19\d|20\d)" \/>\n$/)
})

test('工具条转换语法、删除', async ({ page }) => {
  await loadDoc(page, '![标识](assets/id.svg)\n')
  await page.locator('.tz-editor .tz-image img').click()
  await page.locator('.tz-editor .tz-image-tool', { hasText: '转为 HTML' }).click()
  await expect.poll(() => markdown(page)).toBe('<img src="assets/id.svg" alt="标识" />\n')
  await page.locator('.tz-editor .tz-image-tool', { hasText: '转为 Markdown' }).click()
  await expect.poll(() => markdown(page)).toBe('![标识](assets/id.svg)\n')
  await page.locator('.tz-editor .tz-image-tool[title="删除图片"]').click()
  await expect(page.locator('.tz-editor .tz-image')).toHaveCount(0)
  expect(await markdown(page)).not.toContain('id.svg')
})

test('有缩放的图片不能转回 Markdown,给出提示', async ({ page }) => {
  await loadDoc(page, '<img src="assets/id.svg" alt="标识" style="zoom:50%;" />\n')
  await page.locator('.tz-editor .tz-image img').click()
  await runMenuCommand(page, 'image.toMarkdown')
  await expect(page.locator('.tz-toast')).toContainText('只能使用 HTML 格式')
  expect(await markdown(page)).toContain('style="zoom:50%;"')
})

test('动图工具条可暂停与播放', async ({ page }) => {
  await loadDoc(page, '<img src="assets/anim.gif" alt="动图" width="120" />\n')
  await page.locator('.tz-editor .tz-image img').click()
  const pause = page.locator('.tz-editor .tz-image-tool', { hasText: '暂停' })
  await expect(pause).toBeVisible()
  await pause.click()
  await expect(page.locator('.tz-editor .tz-image-still')).toHaveCount(1)
  await page.locator('.tz-editor .tz-image-tool', { hasText: '播放' }).click()
  await expect(page.locator('.tz-editor .tz-image-still')).toHaveCount(0)
})

test('普通图片不显示暂停按钮', async ({ page }) => {
  await loadDoc(page, '![标识](assets/id.svg)\n')
  await page.locator('.tz-editor .tz-image img').click()
  await expect(page.locator('.tz-editor .tz-image-tool', { hasText: '暂停' })).toBeHidden()
})

test('插入图片:剪贴板里是图片网址时直接插入', async ({ page }) => {
  await loadDoc(page, '')
  await page.evaluate(() => {
    window.typozaTest!.host.clipboard.text = 'https://example.com/pic.png'
  })
  await runMenuCommand(page, 'insert.image')
  await expect.poll(() => markdown(page)).toContain('![](https://example.com/pic.png)')
})

test('「缩放图片」菜单命令作用于选中的图片', async ({ page }) => {
  await loadDoc(page, '文字 ![标识](assets/id.svg)\n')
  await page.locator('.tz-editor .tz-image img').click()
  await runMenuCommand(page, 'image.zoom.150')
  await expect.poll(() => markdown(page)).toBe('文字 <img src="assets/id.svg" alt="标识" style="zoom:150%;" />\n')
})

test('删除图片文件:移到废纸篓并删掉引用', async ({ page }) => {
  await loadDoc(page, '![标识](assets/id.svg)\n')
  await page.locator('.tz-editor .tz-image img').click()
  await runMenuCommand(page, 'image.deleteFile')
  await expect.poll(() => hostCalls(page, 'trash')).toEqual([['/demo/assets/id.svg']])
  await expect.poll(() => markdown(page)).not.toContain('id.svg')
})

test('复制所有图片到文件夹:本机图片复制、网络图片下载,路径改为新位置', async ({ page }) => {
  await loadDoc(page, '![a](assets/id.svg)\n\n![b](assets/name.svg)\n\n![c](https://img.example.com/remote.png)\n')
  await page.evaluate(() => window.typozaTest!.host.dialogQueue.push(['/demo/out']))
  await runMenuCommand(page, 'image.copyAllTo')
  await expect(page.locator('.tz-toast')).toContainText('已将图片复制到了 /demo/out。')
  const md = await markdown(page)
  expect(md).toContain('![a](out/id.svg)')
  expect(md).toContain('![b](out/name.svg)')
  expect(md).toContain('![c](out/remote.png)')
  const files = await page.evaluate(() => [...window.typozaTest!.host.files.keys()].filter((p) => p.startsWith('/demo/out/')).sort())
  expect(files).toEqual(['/demo/out/id.svg', '/demo/out/name.svg', '/demo/out/remote.png'])
  // 复制不动原文件
  expect(await page.evaluate(() => window.typozaTest!.host.files.has('/demo/assets/id.svg'))).toBe(true)
})

test('上传所有本地图片:按 Typora 原文提示结果', async ({ page }) => {
  await loadDoc(page, '![a](assets/id.svg)\n\n![c](https://img.example.com/remote.png)\n')
  await page.evaluate(() => window.typozaTest!.app.updateSettings({ imageUploadCommand: 'picgo upload' }))
  await runMenuCommand(page, 'image.uploadAll')
  await expect(page.locator('.tz-toast')).toContainText('成功上传 1 个图片,失败 0 个。')
  expect(await markdown(page)).toContain('![a](https://img.example.com/demo/assets/id.svg)')
})

test('上传所有本地图片:没有本地图片时提示', async ({ page }) => {
  await loadDoc(page, '![c](https://img.example.com/remote.png)\n')
  await runMenuCommand(page, 'image.uploadAll')
  await expect(page.locator('.tz-toast')).toContainText('文档未包含本地图片。')
})

test('设置图片根目录与插入规则写进 YAML', async ({ page }) => {
  await loadDoc(page, '正文\n')
  await page.evaluate(() => window.typozaTest!.host.dialogQueue.push(['/demo/assets']))
  await runMenuCommand(page, 'image.setRootUrl')
  await expect.poll(() => markdown(page)).toContain('typora-root-url: ./assets')
  await runMenuCommand(page, 'image.whenInsert.upload')
  await expect.poll(() => markdown(page)).toContain('typora-copy-images-to: upload')
})

test('重新加载所有图片:图片文件改动后重新显示', async ({ page }) => {
  await loadDoc(page, '![标识](assets/id.svg)\n')
  const img = page.locator('.tz-editor .tz-image img')
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(400)
  await page.evaluate(() =>
    window.typozaTest!.host.writeText('/demo/assets/id.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>'),
  )
  await runMenuCommand(page, 'image.reloadAll')
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(200)
})
