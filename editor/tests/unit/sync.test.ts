import { describe, expect, it } from 'vitest'
import { formatBytes, formatTime, summarize, vaultStateText } from '../../src/app/sync'
import { FAKE_TOTP_CODE, createFakeSync } from '../../src/host/fake-sync'
import type { SyncStatus, VaultStatus } from '../../src/host/sync-types'
import { SyncError } from '../../src/host/types'

const vault = (patch: Partial<VaultStatus> = {}): VaultStatus => ({ id: 'v1', name: '笔记', root: '/n', active: true, syncing: false, ...patch })
const status = (patch: Partial<SyncStatus> = {}): SyncStatus => ({ signedIn: true, server: 'https://s', email: 'a@b.c', deviceName: 'Mac', vaults: [vault()], ...patch })

describe('同步状态文字', () => {
  it('状态栏摘要:未用同步不显示;同步中、出错、登录失效优先级', () => {
    expect(summarize(null)).toBeNull()
    expect(summarize(status({ signedIn: false, vaults: [] }))).toBeNull()
    expect(summarize(status({ vaults: [] }))).toBeNull()
    expect(summarize(status())).toEqual({ text: '已同步', level: 'ok' })
    expect(summarize(status({ vaults: [vault(), vault({ syncing: true })] }))?.level).toBe('busy')
    expect(summarize(status({ vaults: [vault({ lastError: '网络断了' })] }))).toEqual({ text: '同步出错', level: 'error' })
    expect(summarize(status({ vaults: [vault({ active: false })] }))?.level).toBe('error')
    expect(summarize(status({ signedIn: false, authError: '登录已失效', vaults: [] }))).toEqual({ text: '需要重新登录', level: 'error' })
  })

  it('单个库的状态文字', () => {
    expect(vaultStateText(vault({ syncing: true }))).toBe('正在同步…')
    expect(vaultStateText(vault({ lastError: '配额已满' }))).toBe('同步出错:配额已满')
    expect(vaultStateText(vault({ active: false, lastError: '文件夹不存在' }))).toBe('未在同步:文件夹不存在')
    expect(vaultStateText(vault({ lastSuccessAt: new Date().toISOString() }))).toBe('已同步 · 刚刚')
  })

  it('字节与时间格式', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(3_456_789)).toBe('3.3 MB')
    expect(formatBytes(10 * 1024 ** 3)).toBe('10 GB')
    const now = Date.parse('2026-10-16T10:00:00Z')
    expect(formatTime(undefined, now)).toBe('从未')
    expect(formatTime('2026-10-16T09:59:30Z', now)).toBe('刚刚')
    expect(formatTime('2026-10-16T09:35:00Z', now)).toBe('25 分钟前')
  })
})

describe('模拟同步服务与辅助进程的契约一致', () => {
  const setup = () => {
    const events: { method: string; params: unknown }[] = []
    const call = createFakeSync({ emit: (e) => events.push(e), readText: (p) => (p === '/n/a.md' ? '# 现在\n' : null) })
    return { call, events }
  }
  const code = async (p: Promise<unknown>) => {
    try {
      await p
    } catch (err) {
      expect(err).toBeInstanceOf(SyncError)
      return (err as SyncError).code
    }
    throw new Error('应当失败')
  }

  it('注册、重复注册、错误密码、两步验证', async () => {
    const { call, events } = setup()
    expect(await code(call('sync.register', { server: 's', email: 'a@b.c', password: 'short' }))).toBe('weak_password')
    expect(await code(call('sync.register', { server: '', email: 'a@b.c', password: 'long enough' }))).toBe('invalid_server')
    const reg = (await call('sync.register', { server: 's/', email: ' A@B.c', password: 'long enough' })) as { recoveryCode: string; status: SyncStatus }
    expect(reg.recoveryCode).toMatch(/^([A-Z0-9]{4}-){12}[A-Z0-9]{4}$/)
    expect(reg.status).toMatchObject({ signedIn: true, server: 'https://s', email: 'a@b.c' })
    expect(events.at(-1)?.method).toBe('sync.status')
    expect(await code(call('sync.login', { server: 's', email: 'a@b.c', password: 'long enough' }))).toBe('signed_in')
    await call('sync.totpEnable', { code: FAKE_TOTP_CODE })
    await call('sync.logout', {})
    expect(await code(call('sync.register', { server: 's', email: 'a@b.c', password: 'long enough' }))).toBe('email_taken')
    expect(await code(call('sync.login', { server: 's', email: 'a@b.c', password: 'wrong one' }))).toBe('unauthorized')
    expect(await code(call('sync.login', { server: 's', email: 'a@b.c', password: 'long enough' }))).toBe('totp_required')
    expect(await code(call('sync.login', { server: 's', email: 'a@b.c', password: 'long enough', totp: '000000' }))).toBe('totp_invalid')
    await call('sync.login', { server: 's', email: 'a@b.c', password: 'long enough', totp: FAKE_TOTP_CODE })
    await call('sync.logout', {})
    await call('sync.recover', { server: 's', email: 'a@b.c', recoveryCode: reg.recoveryCode.toLowerCase(), newPassword: 'brand new pass' })
    expect(((await call('sync.status', {})) as SyncStatus).signedIn).toBe(true)
  })

  it('关联文件夹:重叠报错、历史版本只对库内文件', async () => {
    const { call } = setup()
    await call('sync.register', { server: 's', email: 'a@b.c', password: 'long enough' })
    const st = (await call('sync.linkVault', { root: '/n', name: '笔记' })) as SyncStatus
    expect(st.vaults).toHaveLength(1)
    expect(await code(call('sync.linkVault', { root: '/n/sub' }))).toBe('overlap')
    expect(await code(call('sync.linkVault', { root: '/' + 'n' }))).toBe('overlap')
    expect(((await call('sync.versions', { path: '/n/a.md' })) as { tracked: boolean }).tracked).toBe(true)
    expect(((await call('sync.versions', { path: '/other/a.md' })) as { tracked: boolean }).tracked).toBe(false)
    expect(((await call('sync.readVersion', { path: '/n/a.md', version: 2 })) as { text: string }).text).toBe('# 现在\n')
    expect(await code(call('sync.revokeDevice', { id: 'device-this' }))).toBe('self_device')
  })
})
