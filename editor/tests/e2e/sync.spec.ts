import { expect, test, type Page } from '@playwright/test'
import { openApp } from './helpers'

// 云同步界面(浏览器里由模拟同步服务驱动,错误码与辅助进程一致)。

async function command(page: Page, id: string): Promise<void> {
  await page.evaluate((cmd) => window.typozaTest!.host.emit('menu.command', { id: cmd }), id)
}

async function topModalClose(page: Page): Promise<void> {
  await page.locator('.tz-modal').last().locator('.tz-modal-close').click()
}

test.describe('云同步', () => {
  test('注册 → 保存恢复码 → 添加同步文件夹 → 状态栏已同步 → 恢复云端旧版本', async ({ page }) => {
    await openApp(page)
    await command(page, 'app.syncPreferences')
    const sync = page.locator('.tz-sync')
    await expect(sync.locator('.tz-sync-tab.is-active')).toHaveText('注册')

    await sync.locator('input[name=server]').fill('sync.example.com')
    await sync.locator('input[name=email]').fill('me@example.com')
    await sync.locator('input[name=password]').fill('short')
    await sync.locator('input[name=confirm]').fill('short')
    await sync.locator('button[name=submit]').click()
    await expect(sync.locator('.tz-sync-error')).toHaveText('主密码至少 8 位')
    await sync.locator('input[name=password]').fill('correct horse')
    await sync.locator('input[name=confirm]').fill('correct horsf')
    await sync.locator('button[name=submit]').click()
    await expect(sync.locator('.tz-sync-error')).toHaveText('两次输入的主密码不一致')
    await sync.locator('input[name=confirm]').fill('correct horse')
    await sync.locator('input[name=confirm]').press('Enter')

    // 恢复码只显示一次,勾选「已保存」才能关闭
    await expect(page.locator('[data-role=recovery-code]')).toHaveText(/^([A-Z0-9]{4}-){12}[A-Z0-9]{4}$/)
    const done = page.locator('button[name=done]')
    await expect(done).toBeDisabled()
    await page.locator('input[name=saved]').check()
    await done.click()

    await expect(sync.locator('.tz-sync-account strong')).toHaveText('me@example.com')
    await expect(sync).toContainText('https://sync.example.com')
    await expect(sync.locator('[data-role=usage]')).toHaveText('已用 3.3 MB / 10 GB · 两步验证未开启')
    await expect(sync.locator('.tz-side-empty')).toContainText('还没有同步文件夹')

    // 添加同步文件夹:选文件夹 → 新建云端库
    await page.evaluate(() => window.typozaTest!.host.dialogQueue.push(['/demo']))
    await sync.locator('button[name=addVault]').click()
    const dialog = page.locator('.tz-sync-dialog')
    await expect(dialog).toContainText('/demo')
    await expect(dialog.locator('input[name=name]')).toHaveValue('demo')
    await dialog.locator('input[name=name]').fill('我的笔记')
    await dialog.locator('button[name=confirm]').click()
    await expect(dialog).toHaveCount(0)
    const row = sync.locator('.tz-sync-vault')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('我的笔记')
    await expect(row).toContainText('已同步 · 刚刚')
    await expect(page.locator('.tz-sync-indicator')).toHaveText('☁ 已同步')

    // 子文件夹与已同步的重叠:报错且不关闭对话框
    await page.evaluate(() => window.typozaTest!.host.dialogQueue.push(['/demo/assets']))
    await sync.locator('button[name=addVault]').click()
    await page.locator('.tz-sync-dialog button[name=confirm]').click()
    await expect(page.locator('.tz-sync-dialog .tz-sync-error')).toContainText('重叠')
    await topModalClose(page)
    await page.screenshot({ path: 'test-results/screens/sync-settings.png' })
    await topModalClose(page)

    // 云端回收站:恢复后列表变空
    await command(page, 'app.syncPreferences')
    await sync.locator('button[name=trash]').click()
    await expect(page.locator('.tz-sync-list')).toContainText('草稿/旧笔记.md')
    await page.locator('.tz-sync-list button[name=restore]').click()
    await expect(page.locator('.tz-toast')).toHaveText('已恢复「旧笔记.md」')
    await expect(page.locator('.tz-sync-list')).toContainText('回收站是空的')
    await topModalClose(page)
    await topModalClose(page)

    // 历史面板里有云端版本,恢复后内容回到编辑器
    await command(page, 'file.history')
    const cloudItem = page.locator('.tz-history-item', { hasText: '第 1 版 · 其他设备' })
    await expect(cloudItem).toBeVisible()
    await cloudItem.click()
    await expect(page.locator('.tz-history-preview')).toContainText('# 云端旧版本')
    await page.locator('.tz-history-right .tz-btn-primary').click()
    await expect.poll(() => page.evaluate(() => window.typozaTest!.markdown())).toContain('# 云端旧版本')
  })

  test('两步验证:开启后登录要验证码;登录失效时状态栏提示', async ({ page }) => {
    await openApp(page)
    await page.evaluate(async () => {
      await window.typozaTest!.host.syncCall('sync.register', { server: 'sync.example.com', email: 'me@example.com', password: 'correct horse' })
      await window.typozaTest!.host.syncCall('sync.linkVault', { root: '/demo', name: '笔记' })
    })
    await command(page, 'app.syncPreferences')
    const sync = page.locator('.tz-sync')
    await expect(sync.locator('[data-role=usage]')).toContainText('两步验证未开启')

    await sync.locator('button[name=totp]').click()
    const dialog = page.locator('.tz-sync-dialog')
    await expect(dialog.locator('[data-role=qr] svg')).toBeVisible()
    await expect(dialog.locator('[data-role=secret]')).toHaveText('JBSW Y3DP EHPK 3PXP')
    await dialog.locator('input[name=code]').fill('000000')
    await dialog.locator('button[name=confirm]').click()
    await expect(dialog.locator('.tz-sync-error')).toHaveText('两步验证码不对')
    await dialog.locator('input[name=code]').fill('123456')
    await dialog.locator('button[name=confirm]').click()
    await expect(page.locator('.tz-toast')).toContainText('两步验证已开启')
    await expect(sync.locator('[data-role=usage]')).toContainText('两步验证已开启')

    // 退出(本机与云端数据保留)→ 登录页预填邮箱;不填验证码会被要求输入
    await sync.locator('button[name=logout]').click()
    await expect(sync.locator('.tz-sync-tab.is-active')).toHaveText('登录')
    await expect(sync.locator('input[name=email]')).toHaveValue('me@example.com')
    await expect(page.locator('.tz-sync-indicator')).toHaveCount(0)
    await sync.locator('input[name=password]').fill('correct horse')
    await sync.locator('button[name=submit]').click()
    await expect(sync.locator('.tz-sync-error')).toHaveText('请输入两步验证码')
    await expect(sync.locator('input[name=totp]')).toBeFocused()
    await sync.locator('input[name=totp]').fill('123456')
    await sync.locator('button[name=submit]').click()
    await expect(sync.locator('.tz-sync-vault')).toContainText('笔记')
    await expect(page.locator('.tz-sync-indicator')).toHaveText('☁ 已同步')

    // 辅助进程报告登录失效:设置页回到登录表单并显示原因,状态栏提示
    await page.evaluate(() =>
      window.typozaTest!.host.emit('sync.event', {
        method: 'sync.status',
        params: { signedIn: false, server: 'https://sync.example.com', email: 'me@example.com', deviceName: '这台 Mac', authError: '登录已失效,请重新登录', vaults: [] },
      }),
    )
    await expect(sync.locator('.tz-sync-error').first()).toHaveText('登录已失效,请重新登录')
    await expect(page.locator('.tz-sync-indicator')).toHaveText('☁ 需要重新登录')
  })

  test('冲突事件:提示另存的副本', async ({ page }) => {
    await openApp(page)
    await page.evaluate(() =>
      window.typozaTest!.host.emit('sync.event', {
        method: 'sync.event',
        params: { vaultId: 'v1', kind: 'conflict', path: '周报.md', conflictPath: '周报 (冲突 办公室的 Mac 2026-10-16 10.00).md' },
      }),
    )
    await expect(page.locator('.tz-toast')).toHaveText('「周报.md」在两台设备上都改过,另一份已存为「周报 (冲突 办公室的 Mac 2026-10-16 10.00).md」')
  })
})
