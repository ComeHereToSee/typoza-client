// 内存宿主:浏览器开发与 E2E 测试用。文件全部放在内存里,测试经 window.typozaTest 预置。
import { createFakeSync } from './fake-sync'
import type { FileStat, Host, HostEvents, SearchHit } from './types'

type Entry = { kind: 'dir'; mtime: number } | { kind: 'file'; data: string | Uint8Array; mtime: number }
type Listener = (payload: unknown) => void

export interface MemoryHost extends Host {
  files: Map<string, Entry>
  settings: Record<string, unknown>
  emit<K extends keyof HostEvents>(event: K, payload: HostEvents[K]): void
  /** 记录调用,测试断言用 */
  calls: { method: string; args: unknown[] }[]
  /** 测试预置的「打开」对话框结果,按调用顺序取出;取空时返回 null(相当于取消) */
  dialogQueue: (string[] | null)[]
}

function parentOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i <= 0 ? '/' : path.slice(0, i)
}

function mime(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    pdf: 'application/pdf',
  }
  return map[ext] ?? 'application/octet-stream'
}

export function createMemoryHost(): MemoryHost {
  const files = new Map<string, Entry>([['/', { kind: 'dir', mtime: Date.now() }]])
  const listeners = new Map<string, Set<Listener>>()
  const blobUrls = new Map<string, string>()
  const calls: MemoryHost['calls'] = []
  const settings: Record<string, unknown> = {}

  const ensureDir = (path: string) => {
    const parts = path.split('/').filter(Boolean)
    let cur = ''
    for (const p of parts) {
      cur += `/${p}`
      if (!files.has(cur)) files.set(cur, { kind: 'dir', mtime: Date.now() })
    }
  }
  const put = (path: string, data: string | Uint8Array) => {
    ensureDir(parentOf(path))
    files.set(path, { kind: 'file', data, mtime: Date.now() })
    blobUrls.delete(path)
  }
  const statOf = (path: string, e: Entry): FileStat => ({
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    isDir: e.kind === 'dir',
    size: e.kind === 'file' ? (typeof e.data === 'string' ? e.data.length : e.data.byteLength) : 0,
    mtime: e.mtime,
  })
  const record = (method: string, ...args: unknown[]) => calls.push({ method, args })
  const text = (path: string): string => {
    const e = files.get(path)
    if (!e || e.kind !== 'file') throw new Error(`文件不存在:${path}`)
    return typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data)
  }

  // 模拟的云同步:浏览器预览与 E2E 用,行为与错误码对齐辅助进程(helper/internal/syncsvc)
  const fakeSync = createFakeSync({
    emit: (payload) => host.emit('sync.event', payload),
    readText: (path) => (files.has(path) ? text(path) : null),
  })

  const host: MemoryHost = {
    platform: 'browser',
    isLaunchWindow: false,
    files,
    settings,
    calls,
    dialogQueue: [],
    emit(event, payload) {
      for (const fn of listeners.get(event) ?? []) fn(payload)
    },
    resourceURL(path) {
      const e = files.get(path)
      if (!e || e.kind !== 'file') return `memory-missing:${path}`
      let url = blobUrls.get(path)
      if (!url) {
        const part: BlobPart = typeof e.data === 'string' ? e.data : new Uint8Array(e.data)
        url = URL.createObjectURL(new Blob([part], { type: mime(path) }))
        blobUrls.set(path, url)
      }
      return url
    },
    homeDir: () => '/Users/test',
    async readText(path) {
      return { text: text(path), encoding: 'utf-8', mtime: files.get(path)!.mtime }
    },
    async writeText(path, t) {
      record('writeText', path, t)
      put(path, t)
      return { mtime: files.get(path)!.mtime }
    },
    async writeBase64(path, base64) {
      record('writeBase64', path)
      put(path, Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)))
    },
    async copyFile(from, to) {
      record('copyFile', from, to)
      const e = files.get(from)
      if (!e || e.kind !== 'file') throw new Error(`文件不存在:${from}`)
      put(to, e.data)
    },
    async stat(path) {
      const e = files.get(path)
      return e ? statOf(path, e) : null
    },
    async listDir(path) {
      const prefix = path === '/' ? '/' : `${path}/`
      const out: FileStat[] = []
      for (const [p, e] of files) {
        if (p !== path && p.startsWith(prefix) && !p.slice(prefix.length).includes('/')) out.push(statOf(p, e))
      }
      return out.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
    },
    async mkdir(path) {
      ensureDir(path)
    },
    async rename(from, to) {
      record('rename', from, to)
      for (const [p, e] of [...files]) {
        if (p === from || p.startsWith(`${from}/`)) {
          files.delete(p)
          files.set(to + p.slice(from.length), e)
        }
      }
    },
    async trash(path) {
      record('trash', path)
      for (const p of [...files.keys()]) if (p === path || p.startsWith(`${path}/`)) files.delete(p)
    },
    async watch() {},
    async search(root, query, options) {
      const hits: SearchHit[] = []
      const flags = options.caseSensitive ? 'g' : 'gi'
      const source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(options.wholeWord ? `\\b${source}\\b` : source, flags)
      for (const [p, e] of files) {
        if (e.kind !== 'file' || !p.startsWith(root) || !/\.(md|markdown|txt)$/i.test(p)) continue
        const lines = text(p).split('\n')
        const matches = lines.flatMap((line, i) => (line.match(re) ? [{ line: i + 1, text: line.trim().slice(0, 200) }] : []))
        if (matches.length) hits.push({ path: p, matches })
        if (hits.length >= options.limit) break
      }
      return hits
    },
    async listMarkdown(root) {
      return [...files.keys()].filter((p) => p.startsWith(root) && /\.(md|markdown)$/i.test(p)).sort()
    },
    setWindowState(state) {
      record('setWindowState', state)
      document.title = `${state.edited ? '● ' : ''}${state.title}`
    },
    async openDialog(options) {
      record('openDialog', options)
      return host.dialogQueue.shift() ?? null
    },
    async saveDialog(options) {
      record('saveDialog', options)
      return `${options.directory ?? '/Users/test'}/${options.defaultName}`
    },
    async confirm(options) {
      record('confirm', options)
      return 0
    },
    async revealInFinder(path) {
      record('revealInFinder', path)
    },
    async openExternal(url) {
      record('openExternal', url)
    },
    async openDocument(path, options) {
      record('openDocument', path, options)
    },
    async openWithDefaultApp(path) {
      record('openWithDefaultApp', path)
    },
    async copyImageToClipboard(path) {
      record('copyImageToClipboard', path)
    },
    async fetchLinkPreview(url) {
      return { url, title: `预览:${url}`, description: '内存宿主生成的链接预览', image: null, icon: null }
    },
    closeWindow() {
      record('closeWindow')
    },
    async getSettings() {
      return { ...settings }
    },
    async setSettings(patch) {
      Object.assign(settings, patch)
    },
    async historyList() {
      return []
    },
    async historyRead() {
      throw new Error('内存宿主没有历史版本')
    },
    async exportDocument(options) {
      record('exportDocument', options.format, options.target, options.options ?? {})
      put(options.target, options.format === 'html' || options.format === 'html-plain' ? options.html : `导出的 ${options.format}`)
    },
    async print() {
      record('print', document.documentElement.dataset.theme, document.documentElement.classList.contains('tz-dark'))
    },
    async uploadImages(options, paths) {
      record('uploadImages', options, paths)
      return paths.map((p) => `https://img.example.com${p.startsWith('/') ? p : `/${p}`}`)
    },
    async downloadFile(url, target) {
      record('downloadFile', url, target)
      put(target, `下载自 ${url}`)
    },
    async importDocument(path) {
      record('importDocument', path)
      const target = `${path.replace(/\.[^./]+$/, '')}.md`
      put(target, `# 导入自 ${path.slice(path.lastIndexOf('/') + 1)}\n`)
      return target
    },
    async runCommand(command, cwd) {
      record('runCommand', command, cwd)
      return { status: 0, output: '' }
    },
    async clearRecentDocuments() {
      record('clearRecentDocuments')
    },
    async setSpellingLanguage(language) {
      record('setSpellingLanguage', language)
    },
    async setMenuKeys(overrides) {
      record('setMenuKeys', overrides)
    },
    async setExportItems(items) {
      record('setExportItems', items)
    },
    async runNativeCommand(id) {
      record('runNativeCommand', id)
    },
    syncCall: (method, params) => fakeSync(method, params ?? {}) as Promise<never>,
    on(event, handler) {
      let set = listeners.get(event)
      if (!set) listeners.set(event, (set = new Set()))
      set.add(handler as Listener)
      return () => set.delete(handler as Listener)
    },
  }
  return host
}
