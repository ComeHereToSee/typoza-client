// 宿主接口:编辑内核(网页)与 macOS 外壳(Swift)之间的桥接契约。
// 原生实现见 native.ts(经 WKScriptMessageHandlerWithReply 调 Swift);浏览器开发与 E2E 用 memory.ts。
// 方法名同时是桥接消息的 method(如 fs.readText),Swift 侧 BridgeRouter 按同名分发。

export interface FileStat {
  path: string
  name: string
  isDir: boolean
  size: number
  /** 修改时间,毫秒时间戳 */
  mtime: number
}

export interface ReadResult {
  text: string
  /** 实际使用的编码名(utf-8 / gb18030 / big5 / shift_jis / utf-16le …) */
  encoding: string
  mtime: number
}

export interface SearchOptions {
  regex: boolean
  caseSensitive: boolean
  wholeWord: boolean
  /** 最多返回多少个文件 */
  limit: number
}

export interface SearchHit {
  path: string
  /** 命中行(去掉首尾空白,最长 200 字符) */
  matches: { line: number; text: string }[]
}

export interface LinkPreview {
  url: string
  title: string
  description: string
  image: string | null
  icon: string | null
}

export interface HistoryEntry {
  id: string
  /** 毫秒时间戳 */
  time: number
  size: number
  source: 'local' | 'cloud'
}

export type ExportFormat =
  | 'pdf'
  | 'html'
  | 'html-plain'
  | 'image'
  | 'docx'
  | 'odt'
  | 'rtf'
  | 'epub'
  | 'latex'
  | 'mediawiki'
  | 'rst'
  | 'textile'
  | 'opml'

export interface ConfirmOptions {
  title: string
  message: string
  buttons: string[]
  style?: 'info' | 'warning' | 'critical'
}

export interface WindowState {
  /** 当前文档路径;未保存的新文档为 null */
  path: string | null
  title: string
  edited: boolean
}

export interface HostEvents {
  /** 菜单栏或系统发来的命令 ID(与编辑器命令注册表同名) */
  'menu.command': { id: string }
  /** 监听的文件或目录有变化 */
  'fs.changed': { paths: string[] }
  /** 原生要求打开某个文件 / 文件夹(Finder 双击、拖到 Dock 图标、最近文件) */
  'app.open': { path: string; isDir: boolean }
  /** 窗口将要关闭:网页侧保存或询问后调用 window.close 回执 */
  'window.willClose': Record<string, never>
  /** 系统外观切换 */
  'app.appearance': { dark: boolean }
  /** 云同步状态与事件(辅助进程转发) */
  'sync.event': { type: string; [key: string]: unknown }
}

export interface Host {
  readonly platform: 'macos' | 'browser'

  /** 本机文件在网页里可加载的地址(typoza://local/…) */
  resourceURL(absPath: string): string
  /** 展开 ~ 开头的路径 */
  homeDir(): string

  // 文件
  readText(path: string, encoding?: string): Promise<ReadResult>
  writeText(path: string, text: string, encoding?: string): Promise<{ mtime: number }>
  writeBase64(path: string, base64: string): Promise<void>
  copyFile(from: string, to: string): Promise<void>
  stat(path: string): Promise<FileStat | null>
  listDir(path: string): Promise<FileStat[]>
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  trash(path: string): Promise<void>
  watch(paths: string[]): Promise<void>
  search(root: string, query: string, options: SearchOptions): Promise<SearchHit[]>
  /** 列出目录下全部 Markdown 文件(递归,用于快速打开与 [[ 链接) */
  listMarkdown(root: string): Promise<string[]>

  // 窗口与系统
  setWindowState(state: WindowState): void
  openDialog(options: { directory?: boolean; multiple?: boolean; extensions?: string[] }): Promise<string[] | null>
  saveDialog(options: { defaultName: string; extensions?: string[] }): Promise<string | null>
  confirm(options: ConfirmOptions): Promise<number>
  revealInFinder(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  /** 在 Typoza 里打开另一个文档(newWindow 时开新标签页) */
  openDocument(path: string, options?: { newWindow?: boolean }): Promise<void>
  /** 用系统默认应用打开本机文件(附件块) */
  openWithDefaultApp(path: string): Promise<void>
  copyImageToClipboard(path: string): Promise<void>
  fetchLinkPreview(url: string): Promise<LinkPreview | null>
  /** 关闭窗口的回执(响应 window.willClose) */
  closeWindow(): void

  // 设置(持久化在应用支持目录)
  getSettings(): Promise<Record<string, unknown>>
  setSettings(patch: Record<string, unknown>): Promise<void>

  // 本地历史版本
  historyList(path: string): Promise<HistoryEntry[]>
  historyRead(path: string, id: string): Promise<string>

  // 导出与打印
  exportDocument(options: { format: ExportFormat; html: string; markdown: string; sourcePath: string | null; target: string }): Promise<void>
  print(): Promise<void>
  /** 执行用户配置的图片上传命令,返回上传后的网址 */
  uploadImages(command: string, paths: string[]): Promise<string[]>

  on<K extends keyof HostEvents>(event: K, handler: (payload: HostEvents[K]) => void): () => void
}
