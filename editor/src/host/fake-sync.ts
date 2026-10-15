// 模拟的云同步服务:浏览器预览与 E2E 用。方法名、参数、返回结构和错误码对齐辅助进程
// helper/internal/syncsvc;不做加密与网络,只在内存里维护账号、库与版本,让同步界面可以完整走一遍。
import type { CloudTrashItem, CloudVersion, RemoteVault, SyncDevice, SyncStatus, VaultStatus } from './sync-types'
import { SyncError } from './types'

interface Account {
  password: string
  recoveryCode: string
  totpEnabled: boolean
}

export interface FakeSyncDeps {
  emit(payload: { method: string; params: unknown }): void
  readText(path: string): string | null
}

/** 两步验证在模拟服务里固定接受的验证码 */
export const FAKE_TOTP_CODE = '123456'

export function createFakeSync(deps: FakeSyncDeps): (method: string, params: Record<string, unknown>) => Promise<unknown> {
  const accounts = new Map<string, Account>()
  const remote: RemoteVault[] = []
  const trash = new Map<string, CloudTrashItem[]>()
  const devices: SyncDevice[] = [
    { id: 'device-this', name: '这台 Mac', platform: 'macos', createdAt: '2026-01-01T00:00:00Z', lastSeenAt: new Date().toISOString(), current: true },
    { id: 'device-other', name: '办公室的 Mac', platform: 'macos', createdAt: '2026-02-01T00:00:00Z', lastSeenAt: '2026-10-01T09:00:00Z', current: false },
  ]
  let status: SyncStatus = { signedIn: false, server: '', email: '', deviceName: '这台 Mac', vaults: [] }
  let seq = 0

  const snapshot = (): SyncStatus => structuredClone(status)
  const pushStatus = () => deps.emit({ method: 'sync.status', params: snapshot() })
  const fail = (code: string, message: string): never => {
    throw new SyncError(code, message)
  }
  const str = (p: Record<string, unknown>, key: string) => (typeof p[key] === 'string' ? (p[key] as string) : '')
  const server = (raw: string) => {
    let s = raw.trim().replace(/\/+$/, '')
    if (!s) fail('invalid_server', '请填写服务器地址')
    if (!s.includes('://')) s = `https://${s}`
    return s.replace(/\/v1$/, '')
  }
  const email = (raw: string) => raw.trim().toLowerCase()
  const requireSignedIn = () => {
    if (!status.signedIn) fail('signed_out', '尚未登录云同步')
  }
  const requireSignedOut = () => {
    if (status.signedIn) fail('signed_in', '已经登录,请先退出当前账号')
  }
  const strong = (password: string) => {
    if ([...password].length < 8) fail('weak_password', '主密码至少 8 位')
  }
  const signIn = (srv: string, mail: string) => {
    // 换了账号:原来的关联不属于新账号
    const vaults = status.email === mail && status.server === srv ? status.vaults : []
    status = { ...status, signedIn: true, server: srv, email: mail, authError: undefined, vaults: vaults.map((v) => ({ ...v, active: true })) }
    pushStatus()
  }
  const vaultFor = (path: string): VaultStatus | undefined => status.vaults.find((v) => path.startsWith(`${v.root.replace(/\/$/, '')}/`))
  const recoveryCode = () =>
    Array.from({ length: 13 }, () =>
      Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join(''),
    ).join('-')

  const methods: Record<string, (p: Record<string, unknown>) => unknown> = {
    'sync.status': () => snapshot(),

    'sync.register': (p) => {
      requireSignedOut()
      strong(str(p, 'password'))
      const srv = server(str(p, 'server'))
      const mail = email(str(p, 'email'))
      if (!mail) fail('invalid_request', '请填写邮箱')
      if (accounts.has(mail)) fail('email_taken', '这个邮箱已经注册过,请直接登录')
      const code = recoveryCode()
      accounts.set(mail, { password: str(p, 'password'), recoveryCode: code, totpEnabled: false })
      signIn(srv, mail)
      return { recoveryCode: code, status: snapshot() }
    },

    'sync.login': (p) => {
      requireSignedOut()
      const srv = server(str(p, 'server'))
      const mail = email(str(p, 'email'))
      const acc = accounts.get(mail)
      if (!acc || acc.password !== str(p, 'password')) fail('unauthorized', '邮箱或主密码不对')
      if (acc!.totpEnabled) {
        if (!str(p, 'totp')) fail('totp_required', '请输入两步验证码')
        if (str(p, 'totp') !== FAKE_TOTP_CODE) fail('totp_invalid', '两步验证码不对')
      }
      signIn(srv, mail)
      return snapshot()
    },

    'sync.recover': (p) => {
      requireSignedOut()
      strong(str(p, 'newPassword'))
      const srv = server(str(p, 'server'))
      const mail = email(str(p, 'email'))
      const acc = accounts.get(mail)
      if (!acc || acc.recoveryCode !== str(p, 'recoveryCode').trim().toUpperCase()) fail('unauthorized', '邮箱或恢复码不对')
      acc!.password = str(p, 'newPassword')
      signIn(srv, mail)
      return snapshot()
    },

    'sync.logout': () => {
      status = { ...status, signedIn: false, authError: undefined, vaults: status.vaults.map((v) => ({ ...v, active: false, syncing: false })) }
      pushStatus()
      return snapshot()
    },

    'sync.changePassword': (p) => {
      requireSignedIn()
      strong(str(p, 'newPassword'))
      const acc = accounts.get(status.email)!
      if (acc.password !== str(p, 'oldPassword')) fail('unauthorized', '当前主密码不对')
      acc.password = str(p, 'newPassword')
      return {}
    },

    'sync.account': () => {
      requireSignedIn()
      return { userId: 'user-1', email: status.email, totpEnabled: accounts.get(status.email)!.totpEnabled, createdAt: '2026-01-01T00:00:00Z', usage: { usedBytes: 3_456_789, quotaBytes: 10 * 1024 ** 3 } }
    },
    'sync.totpSetup': () => {
      requireSignedIn()
      return { secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: `otpauth://totp/Typoza:${encodeURIComponent(status.email)}?secret=JBSWY3DPEHPK3PXP&issuer=Typoza` }
    },
    'sync.totpEnable': (p) => {
      requireSignedIn()
      if (str(p, 'code') !== FAKE_TOTP_CODE) fail('totp_invalid', '两步验证码不对')
      accounts.get(status.email)!.totpEnabled = true
      return {}
    },
    'sync.totpDisable': (p) => {
      requireSignedIn()
      if (str(p, 'code') !== FAKE_TOTP_CODE) fail('totp_invalid', '两步验证码不对')
      accounts.get(status.email)!.totpEnabled = false
      return {}
    },
    'sync.devices': () => {
      requireSignedIn()
      return structuredClone(devices)
    },
    'sync.revokeDevice': (p) => {
      requireSignedIn()
      const i = devices.findIndex((d) => d.id === str(p, 'id'))
      if (i < 0) fail('not_found', '设备不存在')
      if (devices[i].current) fail('self_device', '不能移除本机,请用「退出登录」')
      devices.splice(i, 1)
      return {}
    },

    'sync.remoteVaults': () => {
      requireSignedIn()
      return remote.map((r) => ({ ...r, root: status.vaults.find((v) => v.id === r.id)?.root }))
    },
    'sync.linkVault': (p) => {
      requireSignedIn()
      const root = str(p, 'root').replace(/\/+$/, '')
      if (!root.startsWith('/')) fail('invalid_root', '请选择本机文件夹')
      for (const v of status.vaults) {
        if (v.root === root || root.startsWith(`${v.root}/`) || v.root.startsWith(`${root}/`)) fail('overlap', `${root} 与已同步的文件夹 ${v.root} 重叠`)
        if (v.id === str(p, 'vaultId')) fail('already_linked', `这个云端库已关联到 ${v.root}`)
      }
      let vault = remote.find((r) => r.id === str(p, 'vaultId'))
      if (str(p, 'vaultId') && !vault) fail('not_found', '云端没有这个库')
      if (!vault) {
        vault = { id: `vault-${++seq}`, name: str(p, 'name') || root.slice(root.lastIndexOf('/') + 1), createdAt: new Date().toISOString() }
        remote.push(vault)
      }
      const now = new Date().toISOString()
      status.vaults.push({ id: vault.id, name: vault.name, root, active: true, syncing: false, lastSyncAt: now, lastSuccessAt: now })
      pushStatus()
      return snapshot()
    },
    'sync.unlinkVault': (p) => {
      const before = status.vaults.length
      status.vaults = status.vaults.filter((v) => v.id !== str(p, 'vaultId'))
      if (status.vaults.length === before) fail('not_linked', '这个库没有在本机同步')
      pushStatus()
      return snapshot()
    },
    'sync.now': (p) => {
      requireSignedIn()
      const now = new Date().toISOString()
      for (const v of status.vaults) {
        if (!str(p, 'vaultId') || v.id === str(p, 'vaultId')) Object.assign(v, { lastSyncAt: now, lastSuccessAt: now, lastError: undefined })
      }
      pushStatus()
      return snapshot()
    },

    'sync.versions': (p) => {
      requireSignedIn()
      const path = str(p, 'path')
      const vault = vaultFor(path)
      const current = deps.readText(path)
      if (!vault || current === null) return { tracked: false, versions: [] }
      const versions: CloudVersion[] = [
        { version: 2, size: current.length, mtime: '2026-10-15T08:00:00Z', createdAt: '2026-10-15T08:00:01Z', deleted: false, thisDevice: true },
        { version: 1, size: 20, mtime: '2026-10-14T08:00:00Z', createdAt: '2026-10-14T08:00:01Z', deleted: false, thisDevice: false },
      ]
      return { tracked: true, vaultId: vault.id, versions }
    },
    'sync.readVersion': (p) => {
      requireSignedIn()
      const path = str(p, 'path')
      if (!vaultFor(path)) fail('not_linked', '这个文件不在同步文件夹里')
      if (p.version === 2) return { text: deps.readText(path) ?? '' }
      if (p.version === 1) return { text: '# 云端旧版本\n\n办公室的 Mac 上保存的内容。\n' }
      return fail('error', `没有版本 ${String(p.version)}`)
    },
    'sync.trash': (p) => {
      requireSignedIn()
      const id = str(p, 'vaultId')
      if (!status.vaults.some((v) => v.id === id)) fail('not_linked', '这个库没有在本机同步')
      if (!trash.has(id)) trash.set(id, [{ fileId: 'file-deleted-1', path: '草稿/旧笔记.md', version: 3, deletedAt: '2026-10-10T10:00:00Z' }])
      return structuredClone(trash.get(id))
    },
    'sync.restoreTrash': (p) => {
      requireSignedIn()
      const list = trash.get(str(p, 'vaultId')) ?? []
      trash.set(
        str(p, 'vaultId'),
        list.filter((t) => t.fileId !== str(p, 'fileId')),
      )
      return {}
    },
    'sync.purge': (p) => methods['sync.restoreTrash'](p),
  }

  return async (method, params) => {
    const fn = methods[method]
    if (!fn) throw new SyncError('method_not_found', `未知方法: ${method}`)
    return fn(params)
  }
}
