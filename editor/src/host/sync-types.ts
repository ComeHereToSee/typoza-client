// 云同步数据结构:与辅助进程 helper/internal/syncsvc 的 JSON 一一对应。

export interface VaultStatus {
  id: string
  name: string
  root: string
  /** 引擎在运行(没运行时 lastError 说明原因,如文件夹不存在) */
  active: boolean
  syncing: boolean
  /** ISO 时间 */
  lastSyncAt?: string
  lastSuccessAt?: string
  lastError?: string
}

export interface SyncStatus {
  signedIn: boolean
  server: string
  email: string
  deviceName: string
  /** 登录失效的原因(会话已被结束) */
  authError?: string
  vaults: VaultStatus[]
}

export interface SyncEvent {
  vaultId: string
  kind: 'sync_started' | 'sync_finished' | 'progress' | 'synced' | 'conflict' | 'error'
  path?: string
  absPath?: string
  conflictPath?: string
  conflictAbsPath?: string
  direction?: 'up' | 'down'
  bytes?: number
  total?: number
  reason?: string
  error?: string
}

export interface RemoteVault {
  id: string
  name: string
  createdAt: string
  /** 已关联到本机的文件夹 */
  root?: string
}

export interface CloudVersion {
  version: number
  size: number
  mtime: string
  createdAt: string
  deleted: boolean
  thisDevice: boolean
}

export interface CloudTrashItem {
  fileId: string
  path: string
  version: number
  deletedAt: string
}

export interface SyncDevice {
  id: string
  name: string
  platform: string
  createdAt: string
  lastSeenAt: string
  current: boolean
}

export interface SyncAccount {
  userId: string
  email: string
  totpEnabled: boolean
  createdAt: string
  usage: { usedBytes: number; quotaBytes: number }
}
