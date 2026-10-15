// 偏好设置:持久化在宿主(macOS 应用支持目录下的 settings.json),这里只定义键与默认值。
import type { Host } from '../host/types'

export interface AppSettings {
  // 外观
  theme: string
  appearance: 'system' | 'light' | 'dark'
  fontFamily: 'default' | 'serif' | 'mono'
  fontSize: number
  pageWidth: 'normal' | 'wide' | 'full'
  zoom: number
  showStatusBar: boolean
  // 文件
  autoSave: boolean
  ensureTrailingNewline: boolean
  // 编辑器
  inlineMath: boolean
  smartPunctuation: boolean
  autoPair: boolean
  spellcheck: boolean
  codeLineNumbers: boolean
  codeLineWrap: boolean
  // 图片
  imageInsertAction: 'copyToAssets' | 'copyToCurrent' | 'copyToCustom' | 'upload' | 'none'
  imageAssetsFolder: string
  imageCustomFolder: string
  imageUploadCommand: string
  imageUseRelative: boolean
  // 侧栏
  sidebarVisible: boolean
  sidebarTab: 'files' | 'list' | 'outline' | 'search'
  sidebarWidth: number
  // 快捷键:键 → 命令 ID
  keybindings: Record<string, string>
  // 导出
  pandocPath: string
  // 视图模式
  focusMode: boolean
  typewriterMode: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'typoza',
  appearance: 'system',
  fontFamily: 'default',
  fontSize: 16,
  pageWidth: 'normal',
  zoom: 1,
  showStatusBar: true,
  autoSave: true,
  ensureTrailingNewline: true,
  inlineMath: true,
  smartPunctuation: true,
  autoPair: true,
  spellcheck: false,
  codeLineNumbers: false,
  codeLineWrap: true,
  imageInsertAction: 'copyToAssets',
  imageAssetsFolder: './assets',
  imageCustomFolder: '',
  imageUploadCommand: '',
  imageUseRelative: true,
  sidebarVisible: true,
  sidebarTab: 'files',
  sidebarWidth: 260,
  keybindings: {},
  pandocPath: '',
  focusMode: false,
  typewriterMode: false,
}

export async function loadSettings(host: Host): Promise<AppSettings> {
  const stored = await host.getSettings()
  const out = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
    if (key in stored && typeof stored[key] === typeof DEFAULT_SETTINGS[key]) {
      ;(out as Record<string, unknown>)[key] = stored[key]
    }
  }
  return out
}

export const BUILTIN_THEMES: { id: string; label: string }[] = [
  { id: 'typoza', label: 'Typoza(Notion 风格)' },
  { id: 'github', label: 'GitHub' },
  { id: 'newsprint', label: 'Newsprint' },
  { id: 'night', label: 'Night' },
  { id: 'whitey', label: 'Whitey' },
]
