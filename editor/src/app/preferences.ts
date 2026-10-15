// 偏好设置面板(PRD 3.13):文件、编辑器、图像、Markdown、导出、外观、通用、快捷键,另有其它模块加的页(云同步)。
// 选项与 Typora 对齐(对照表 PF / PE / PI / PM / PX / PA / PG 行),改完立即生效。
import '../styles/preferences.css'
import { DOUBLE_QUOTE_STYLES, SINGLE_QUOTE_STYLES } from '../core/smart-punctuation'
import type { Host } from '../host/types'
import { h } from '../ui/dom'
import { listCustomThemes, openThemesFolder } from './appearance'
import { UPLOAD_SERVICES, verifyUpload } from './assets'
import { EXPORT_TEMPLATES, MARKDOWN_VARIANTS, newExportItem } from './export-flow'
import { modal } from './panels'
import { type AppSettings, BUILTIN_THEMES, type ExportItem, type ExportItemTemplate } from './settings'
import { assignKey, clearCommandKeys, commandRows, displayKey, effectiveKeyTable, keyName, keyOwner } from './shortcuts'

export interface PreferencesContext {
  /** 当前设置(App 持有的同一个对象,update 后即为新值) */
  settings: AppSettings
  host: Host
  update(patch: Partial<AppSettings>): Promise<void>
  toast(message: string, error?: boolean): void
  /** 清除最近打开的文件与文件夹记录(PF-07) */
  clearRecent(): Promise<void>
  /** 其它模块加的页(如云同步) */
  extraSections: { title: string; render: () => HTMLElement }[]
}

type Key = keyof AppSettings
type Option = { value: string; label: string }

type Field =
  | { type: 'bool'; key: Key; label: string; hint?: string; when?: (s: AppSettings) => boolean }
  | { type: 'select'; key: Key; label: string; options: Option[]; hint?: string; numeric?: boolean; when?: (s: AppSettings) => boolean }
  | { type: 'text' | 'number' | 'textarea'; key: Key; label: string; placeholder?: string; hint?: string; when?: (s: AppSettings) => boolean }
  | { type: 'folder' | 'file'; key: Key; label: string; placeholder?: string; hint?: string; when?: (s: AppSettings) => boolean }
  | { type: 'button'; label: string; text: string; run: (ctx: PreferencesContext) => Promise<void>; hint?: string; when?: (s: AppSettings) => boolean }
  | { type: 'heading'; label: string }
  | { type: 'custom'; render: (ctx: PreferencesContext, rerender: () => void) => HTMLElement }

const opts = (pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }))

const THEME_OPTIONS = BUILTIN_THEMES.map((t) => ({ value: t.id, label: t.label }))

// macOS 系统词典常见语言(PE-08,用系统词典,不另下载)
const SPELLING_LANGUAGES = opts([
  ['off', '不使用'],
  ['auto', '自动检测语言'],
  ['en', '英语(美国)'],
  ['en_GB', '英语(英国)'],
  ['fr', '法语'],
  ['de', '德语'],
  ['es', '西班牙语'],
  ['it', '意大利语'],
  ['pt_BR', '葡萄牙语(巴西)'],
  ['nl', '荷兰语'],
  ['sv', '瑞典语'],
  ['da', '丹麦语'],
  ['nb', '挪威语'],
  ['fi', '芬兰语'],
  ['ru', '俄语'],
  ['pl', '波兰语'],
  ['tr', '土耳其语'],
  ['ko', '韩语'],
])

const READING_SPEEDS = [120, 240, 382]

const FILE_PAGE: Field[] = [
  {
    type: 'select',
    key: 'startupAction',
    label: '启动时',
    options: opts([
      ['newFile', '打开新文件'],
      ['lastFolder', '重新打开上次使用的目录'],
      ['lastFilesAndFolder', '重新打开上次使用的文件和目录'],
      ['customFolder', '打开指定目录'],
    ]),
  },
  { type: 'folder', key: 'startupFolder', label: '指定目录', when: (s) => s.startupAction === 'customFolder' },
  { type: 'bool', key: 'outlineCollapsible', label: '允许折叠和展开侧边栏的大纲视图' },
  {
    type: 'select',
    key: 'newFileExtension',
    label: '默认文件扩展名',
    options: opts([
      ['md', '.md'],
      ['markdown', '.markdown'],
      ['text', '.text'],
      ['custom', '自定义'],
    ]),
  },
  { type: 'text', key: 'customExtension', label: '自定义扩展名', placeholder: 'mdx', when: (s) => s.newFileExtension === 'custom' },
  { type: 'bool', key: 'autoSave', label: '自动保存', hint: '停止输入 1 秒后自动保存;关闭后用 ⌘S 手动保存' },
  { type: 'bool', key: 'ensureTrailingNewline', label: '保存时在文末添加空行' },
  {
    type: 'button',
    label: '未保存的草稿',
    text: '恢复未保存的草稿',
    hint: '把没在任何标签里的草稿重新打开;没有草稿时打开草稿文件夹',
    // 与 文件 菜单「恢复未保存的草稿…」同一个原生命令(草稿由外壳管理)
    run: (ctx) => ctx.host.runNativeCommand('native.recoverDrafts'),
  },
  { type: 'bool', key: 'recordRecent', label: '记录历史文件和文件夹' },
  {
    type: 'button',
    label: '历史记录',
    text: '清除历史',
    run: async (ctx) => {
      await ctx.clearRecent()
      ctx.toast('已清除最近打开的文件记录')
    },
  },
  {
    type: 'select',
    key: 'dropFolderAction',
    label: '当拖入文件夹时',
    options: opts([
      ['open', '在 Typoza 中打开'],
      ['link', '插入文件夹链接'],
    ]),
  },
  {
    type: 'select',
    key: 'dropMarkdownAction',
    label: '当拖入 Markdown 文件时',
    options: opts([
      ['open', '打开'],
      ['link', '插入文件链接'],
    ]),
  },
  {
    type: 'select',
    key: 'dropImportableAction',
    label: '当拖入可被导入的文件时',
    options: opts([
      ['import', '导入文件'],
      ['link', '插入文件链接'],
    ]),
    hint: 'docx、epub、LaTeX 等,导入需要 Pandoc',
  },
]

const EDITOR_PAGE: Field[] = [
  {
    type: 'select',
    key: 'listIndent',
    label: '默认缩进',
    options: opts([
      ['one', '与列表标记对齐'],
      ['tab', '4 个空格'],
    ]),
    hint: '菜单或快捷键生成列表时的缩进',
  },
  { type: 'bool', key: 'autoPair', label: '匹配括号和引号' },
  { type: 'bool', key: 'autoPairMarkdown', label: '匹配 Markdown 字符', hint: '敲 * _ ~ 时自动补上另一半' },
  { type: 'bool', key: 'showMarkdownMarkers', label: '编辑时显示 Markdown 标记', hint: '光标进入行内样式与标题时显示对应的 Markdown 符号' },
  { type: 'bool', key: 'copyPlainAsMarkdown', label: '当复制纯文本时复制 Markdown 源码' },
  { type: 'bool', key: 'copyLineWithoutSelection', label: '无选区时复制或剪切整行' },
  {
    type: 'select',
    key: 'defaultLineEnding',
    label: '默认换行符',
    options: opts([
      ['lf', 'LF(macOS / Linux)'],
      ['crlf', 'CRLF(Windows)'],
    ]),
    hint: '新建文件使用;打开的文件保持原换行符',
  },
  { type: 'custom', render: (ctx, rerender) => spellingField(ctx, rerender) },
  { type: 'bool', key: 'typewriterAlways', label: '打字机模式下始终保证光标在屏幕中间', hint: '关闭后只在输入时保持居中' },
  {
    type: 'button',
    label: '打字机 / 专注模式',
    text: '关闭打字机 / 专注模式',
    run: async (ctx) => {
      await ctx.update({ typewriterMode: false, focusMode: false })
      ctx.toast('打字机模式 / 专注模式 已被关闭。')
    },
  },
]

const IMAGE_PAGE: Field[] = [
  {
    type: 'select',
    key: 'imageInsertAction',
    label: '插入图片时',
    options: opts([
      ['none', '无特殊操作'],
      ['copyToCurrent', '复制图片到当前文件夹(./)'],
      ['copyToAssets', '复制到 ./assets 文件夹'],
      ['copyToFilenameAssets', '复制到 ./${filename}.assets 文件夹'],
      ['upload', '上传图片'],
      ['copyToCustom', '复制到指定路径'],
    ]),
  },
  { type: 'text', key: 'imageAssetsFolder', label: '资源文件夹', placeholder: './assets', hint: '可用 ${filename} 代表当前文件名', when: (s) => s.imageInsertAction === 'copyToAssets' },
  { type: 'folder', key: 'imageCustomFolder', label: '指定路径', placeholder: '/Users/…/Pictures', hint: '可用 ${filename} 代表当前文件名', when: (s) => s.imageInsertAction === 'copyToCustom' },
  { type: 'bool', key: 'imageApplyToLocal', label: '对本地位置的图片应用上述规则' },
  { type: 'bool', key: 'imageApplyToNetwork', label: '对网络位置的图片应用上述规则' },
  { type: 'bool', key: 'imageUploadByYaml', label: '允许根据 YAML 设置自动上传图片', hint: '文档 YAML 写 typora-copy-images-to: upload 时上传' },
  { type: 'bool', key: 'imageUseRelative', label: '优先使用相对路径' },
  { type: 'bool', key: 'imageRelativeDotSlash', label: '为相对路径添加 ./', when: (s) => s.imageUseRelative },
  { type: 'bool', key: 'imageEscapeUrl', label: '插入时自动转义图片 URL' },
  { type: 'heading', label: '上传服务' },
  { type: 'select', key: 'imageUploadService', label: '上传服务', options: UPLOAD_SERVICES.map((s) => ({ value: s.id, label: s.label })) },
  {
    type: 'text',
    key: 'imageUploadCommand',
    label: '自定义命令',
    placeholder: 'picgo upload',
    hint: '命令接收图片路径参数,标准输出最后几行是上传后的网址',
    when: (s) => s.imageUploadService === 'custom',
  },
  {
    type: 'button',
    label: '验证',
    text: '验证图片上传选项',
    hint: '上传一张 1×1 的测试图片',
    run: async (ctx) => {
      const url = await verifyUpload({
        host: ctx.host,
        settings: ctx.settings,
        docPath: null,
        copyImagesTo: null,
        dismissWarning: (id) => void ctx.update({ dismissedWarnings: [...ctx.settings.dismissedWarnings, id] }),
      })
      if (url) ctx.toast(`验证成功:${url}`)
    },
  },
]

const MARKDOWN_PAGE: Field[] = [
  { type: 'bool', key: 'strictMode', label: '严格模式', hint: '关闭后 #标题(# 后不带空格)也识别为标题' },
  {
    type: 'select',
    key: 'headingStyle',
    label: '标题样式',
    options: opts([
      ['atx', 'atx(# 标题)'],
      ['atx-closed', 'atx 带后缀(# 标题 #)'],
      ['setext', 'setext(标题 + ===)'],
      ['setext-variable', '可变宽 setext'],
    ]),
    hint: '新建或修改标题时的写法;setext 只用于一、二级标题',
  },
  {
    type: 'select',
    key: 'listBullet',
    label: '无序列表符号',
    options: opts([
      ['-', '-'],
      ['+', '+'],
      ['*', '*'],
    ]),
    hint: '文件里已有无序列表时沿用文件原来的符号',
  },
  {
    type: 'select',
    key: 'orderedListIncrement',
    label: '有序列表',
    options: opts([
      ['true', '1. 2. 3.'],
      ['false', '1. 1. 1.'],
    ]),
  },
  { type: 'bool', key: 'autolink', label: '自动识别链接' },
  { type: 'heading', label: '扩展语法' },
  { type: 'bool', key: 'inlineMath', label: '内联公式 $…$' },
  { type: 'bool', key: 'subscript', label: '下标 ~文字~' },
  { type: 'bool', key: 'superscript', label: '上标 ^文字^' },
  { type: 'bool', key: 'highlight', label: '高亮 ==文字==' },
  { type: 'bool', key: 'alerts', label: 'GitHub 风格警报框' },
  { type: 'bool', key: 'diagrams', label: '图表(Mermaid)' },
  { type: 'heading', label: '智能标点' },
  {
    type: 'select',
    key: 'smartPunctuationMode',
    label: '智能标点',
    options: opts([
      ['off', '关闭'],
      ['input', '输入时转换'],
      ['render', '渲染时转换'],
    ]),
    hint: '渲染时转换只改显示,文件里保留直引号与连字符',
  },
  { type: 'bool', key: 'smartQuotes', label: '智能引号', when: (s) => s.smartPunctuationMode !== 'off' },
  { type: 'select', key: 'doubleQuotes', label: '双引号样式', options: DOUBLE_QUOTE_STYLES.map((q) => ({ value: q, label: `${q[0]}abc${q[1]}` })), when: (s) => s.smartPunctuationMode !== 'off' && s.smartQuotes },
  { type: 'select', key: 'singleQuotes', label: '单引号样式', options: SINGLE_QUOTE_STYLES.map((q) => ({ value: q, label: `${q[0]}abc${q[1]}` })), when: (s) => s.smartPunctuationMode !== 'off' && s.smartQuotes },
  { type: 'bool', key: 'smartDashes', label: '智能破折号', when: (s) => s.smartPunctuationMode !== 'off' },
  {
    type: 'select',
    key: 'dashRule',
    label: '破折号规则',
    options: opts([
      ['en-em', '-- 转 –,--- 转 —'],
      ['em', '-- 与 --- 都转 —'],
    ]),
    hint: '独占一行的 --- 仍是分割线',
    when: (s) => s.smartPunctuationMode !== 'off' && s.smartDashes,
  },
  { type: 'bool', key: 'unicodePunctuation', label: '解析 Markdown 时允许并转化 Unicode 标点', hint: '例如把行首的「》」当作引用标记;只影响解析,不改写原文' },
  { type: 'heading', label: '空格与换行' },
  { type: 'bool', key: 'firstLineIndent', label: '首行缩进' },
  { type: 'bool', key: 'showBrTag', label: '显示 <br/>' },
  { type: 'bool', key: 'preserveSingleNewline', label: '保留单换行符', hint: '关闭后段内单个换行按 Markdown 规则显示为空格;只影响显示' },
  { type: 'heading', label: '代码块' },
  { type: 'bool', key: 'codeLineNumbers', label: '代码块显示行号' },
  { type: 'bool', key: 'codeLineWrap', label: '代码块自动换行' },
  { type: 'heading', label: '数学公式' },
  {
    type: 'select',
    key: 'mathNumbering',
    label: '公式自动编号',
    options: opts([
      ['none', '不启用'],
      ['ams', 'AMS 规则'],
      ['all', '全部编号'],
    ]),
    hint: 'AMS 规则只给 equation、align、gather 等环境编号;\\tag 始终可用',
  },
  { type: 'bool', key: 'mathPhysics', label: '启用 physics 包', hint: '\\abs、\\norm、\\dv、\\pdv、\\bra、\\ket 等常用宏' },
  {
    type: 'select',
    key: 'exportMathOutput',
    label: '复制或导出无样式 HTML 时公式用',
    options: opts([
      ['mathml', 'MathML'],
      ['latex', 'LaTeX 代码'],
    ]),
  },
  {
    type: 'select',
    key: 'exportWhitespace',
    label: '导出与打印时',
    options: opts([
      ['ignore', '忽略连续空格与单个换行'],
      ['preserve', '保留连续空格与单个换行'],
    ]),
  },
]

const exportThemeOptions = [{ value: '', label: '当前主题' }, ...THEME_OPTIONS]

const EXPORT_PAGE: Field[] = [
  {
    type: 'select',
    key: 'exportFolder',
    label: '默认导出文件夹',
    options: opts([
      ['auto', '自动'],
      ['same', '与原文件同一目录'],
      ['custom', '自定义'],
    ]),
    hint: '自动:沿用这篇文档上次导出的位置,第一次导出时用文档所在文件夹',
  },
  { type: 'folder', key: 'exportCustomFolder', label: '自定义文件夹', when: (s) => s.exportFolder === 'custom' },
  {
    type: 'select',
    key: 'exportAfter',
    label: '导出后',
    options: opts([
      ['none', '无操作'],
      ['revealFile', '打开导出文件所在目录'],
      ['openFile', '打开导出文件'],
      ['command', '运行自定义命令'],
    ]),
  },
  { type: 'text', key: 'exportAfterCommand', label: '自定义命令', placeholder: 'open "${outputPath}"', hint: '可用 ${outputPath} ${currentPath} ${title} 等变量', when: (s) => s.exportAfter === 'command' },
  { type: 'bool', key: 'exportShowCommandOutput', label: '显示命令行输出', when: (s) => s.exportAfter === 'command' },
  { type: 'bool', key: 'exportYamlOverride', label: '允许 YAML front matter 覆盖当前设置', hint: 'title、author、header、footer、append-head、append-body' },
  { type: 'file', key: 'pandocPath', label: 'Pandoc 路径', placeholder: '留空自动检测', hint: '导出 Word、Epub、LaTeX 等格式需要安装 Pandoc' },
  { type: 'heading', label: 'PDF' },
  {
    type: 'select',
    key: 'exportPdfPaper',
    label: '页面大小',
    options: opts([
      ['A3', 'A3'],
      ['A4', 'A4'],
      ['A5', 'A5'],
      ['Letter', 'US Letter'],
      ['Legal', 'US Legal'],
      ['Tabloid', 'Tabloid'],
      ['custom', '自定义'],
    ]),
  },
  { type: 'number', key: 'exportPdfWidth', label: '宽(毫米)', when: (s) => s.exportPdfPaper === 'custom' },
  { type: 'number', key: 'exportPdfHeight', label: '高(毫米)', when: (s) => s.exportPdfPaper === 'custom' },
  { type: 'number', key: 'exportPdfMargin', label: '页边距(毫米)' },
  { type: 'select', key: 'exportPdfTheme', label: '主题', options: exportThemeOptions },
  { type: 'bool', key: 'exportPdfH1Break', label: '每个一级标题另起一页' },
  { type: 'text', key: 'exportPdfHeader', label: '页首', placeholder: '${title}', hint: '可用 ${title} ${author} ${today} ${pageNo} ${pageCount}' },
  { type: 'text', key: 'exportPdfFooter', label: '页尾', placeholder: '${pageNo} / ${pageCount}' },
  { type: 'text', key: 'exportPdfAuthor', label: '作者' },
  { type: 'textarea', key: 'exportPdfAppendHead', label: '在 <head /> 中添加', placeholder: '<style>…</style>' },
  { type: 'heading', label: 'HTML' },
  { type: 'bool', key: 'exportHtmlOutline', label: '保留大纲侧边栏' },
  { type: 'select', key: 'exportHtmlTheme', label: '主题', options: exportThemeOptions },
  { type: 'textarea', key: 'exportHtmlAppendHead', label: '在 <head /> 中添加' },
  { type: 'textarea', key: 'exportHtmlAppendBody', label: '在 <body /> 中添加' },
  { type: 'heading', label: '图像' },
  { type: 'number', key: 'exportImageWidth', label: '宽度(像素)' },
  {
    type: 'select',
    key: 'exportImageQuality',
    label: '图片质量',
    options: opts([
      ['auto', '自动'],
      ['medium', '中等'],
      ['high', '高'],
      ['veryHigh', '极高'],
    ]),
  },
  { type: 'number', key: 'exportImageFontSize', label: '字体大小(像素)', hint: '0 表示跟随主题' },
  { type: 'select', key: 'exportImageTheme', label: '主题', options: exportThemeOptions },
  { type: 'heading', label: 'Pandoc' },
  { type: 'text', key: 'exportPandocArgs', label: '额外参数', placeholder: '--toc --number-sections' },
  { type: 'file', key: 'exportWordReferenceDoc', label: 'Word 样式参考文件', placeholder: 'reference.docx' },
  { type: 'file', key: 'exportEpubCss', label: 'Epub 样式表', placeholder: 'epub.css' },
  { type: 'number', key: 'exportEpubTocDepth', label: 'Epub 目录层级' },
  { type: 'heading', label: '导出项' },
  { type: 'custom', render: (ctx, rerender) => exportItemsEditor(ctx, rerender) },
]

const APPEARANCE_PAGE: Field[] = [
  { type: 'custom', render: (ctx) => themeField(ctx, 'theme', '主题') },
  { type: 'custom', render: (ctx) => themeField(ctx, 'darkTheme', '深色模式下使用的主题') },
  {
    type: 'select',
    key: 'appearance',
    label: '浅色 / 深色',
    options: opts([
      ['system', '跟随系统'],
      ['light', '浅色'],
      ['dark', '深色'],
    ]),
  },
  {
    type: 'button',
    label: '自定义主题',
    text: '打开主题文件夹',
    hint: '放入 .css 即出现在主题菜单;base.user.css、主题名.user.css 追加样式',
    run: (ctx) => openThemesFolder(ctx.host),
  },
  {
    type: 'select',
    key: 'fontFamily',
    label: '正文字体',
    options: opts([
      ['default', '默认'],
      ['serif', '衬线'],
      ['mono', '等宽'],
    ]),
  },
  {
    type: 'select',
    key: 'fontSizeMode',
    label: '字体大小',
    options: opts([
      ['theme', '使用主题的字体大小'],
      ['custom', '自定义'],
    ]),
  },
  { type: 'number', key: 'fontSize', label: '字号(像素)', when: (s) => s.fontSizeMode === 'custom' },
  {
    type: 'select',
    key: 'zoom',
    label: '缩放比例',
    numeric: true,
    options: [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5].map((z) => ({ value: String(z), label: `${Math.round(z * 100)}%` })),
  },
  { type: 'bool', key: 'zoomWithWheel', label: '按住 ⌘ 时用滚轮缩放' },
  { type: 'bool', key: 'pinchZoom', label: '双指缩放' },
  {
    type: 'select',
    key: 'pageWidth',
    label: '页面宽度',
    options: opts([
      ['normal', '标准'],
      ['wide', '加宽'],
      ['full', '全宽'],
    ]),
  },
  { type: 'bool', key: 'showStatusBar', label: '显示状态栏' },
  { type: 'bool', key: 'alwaysShowWordCount', label: '总是显示字数统计', hint: '关闭后鼠标移到状态栏才显示', when: (s) => s.showStatusBar },
  { type: 'custom', render: (ctx, rerender) => readingSpeedField(ctx, rerender) },
  { type: 'bool', key: 'outlineByDefault', label: '默认显示大纲视图' },
]

const GENERAL_PAGE: Field[] = [
  { type: 'bool', key: 'quitOnLastWindowClosed', label: '所有窗口被关闭后自动退出' },
  { type: 'select', key: 'language', label: '界面语言', options: opts([['zh-Hans', '简体中文']]) },
  { type: 'bool', key: 'autoCheckUpdates', label: '自动检查更新' },
  {
    type: 'select',
    key: 'updateChannel',
    label: '更新通道',
    options: opts([
      ['stable', '正式版'],
      ['beta', '测试版'],
    ]),
  },
  {
    type: 'button',
    label: '警告提示',
    text: '重置全部警告提示对话框',
    run: async (ctx) => {
      await ctx.update({ dismissedWarnings: [] })
      ctx.toast('警告提示对话框已被重置')
    },
  },
]

const PAGES: { title: string; fields: Field[] }[] = [
  { title: '文件', fields: FILE_PAGE },
  { title: '编辑器', fields: EDITOR_PAGE },
  { title: '图像', fields: IMAGE_PAGE },
  { title: 'Markdown', fields: MARKDOWN_PAGE },
  { title: '导出', fields: EXPORT_PAGE },
  { title: '外观', fields: APPEARANCE_PAGE },
  { title: '通用', fields: GENERAL_PAGE },
]

export function showPreferences(ctx: PreferencesContext, initialTitle?: string): void {
  const nav = h('nav', { class: 'tz-settings-nav' })
  const content = h('div', { class: 'tz-settings-content' })
  const sections: { title: string; render: () => HTMLElement }[] = [
    ...PAGES.map((p) => ({ title: p.title, render: () => renderFields(p.fields, ctx, () => show(active)) })),
    { title: '快捷键', render: () => renderShortcuts(ctx) },
    ...ctx.extraSections,
  ]
  let active = 0
  const show = (i: number) => {
    active = i
    for (const [j, el] of Array.from(nav.children).entries()) el.classList.toggle('is-active', j === active)
    const scroll = content.scrollTop
    content.replaceChildren(sections[i].render())
    content.scrollTop = scroll
  }
  sections.forEach((s, i) => {
    const b = h('button', { type: 'button', class: 'tz-settings-tab', 'data-page': s.title }, s.title)
    b.addEventListener('click', () => {
      content.scrollTop = 0
      show(i)
    })
    nav.append(b)
  })
  modal('偏好设置', h('div', { class: 'tz-settings' }, nav, content))
  show(Math.max(0, sections.findIndex((s) => s.title === initialTitle)))
}

function row(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('label', { class: 'tz-field' }, h('span', { class: 'tz-field-label' }, label), control, hint ? h('span', { class: 'tz-field-hint' }, hint) : null)
}

/** 改设置;开关与下拉框改完重画本页(有选项的显示依赖它们)。出错就地提示,不吞。 */
function save(ctx: PreferencesContext, patch: Partial<AppSettings>, rerender?: () => void): void {
  ctx
    .update(patch)
    .then(() => rerender?.())
    .catch((err: unknown) => ctx.toast(`保存设置失败:${err instanceof Error ? err.message : String(err)}`, true))
}

function renderFields(fields: Field[], ctx: PreferencesContext, rerender: () => void): HTMLElement {
  const box = h('div', { class: 'tz-settings-fields' })
  const s = ctx.settings
  for (const f of fields) {
    if ('when' in f && f.when && !f.when(s)) continue
    if (f.type === 'heading') {
      box.append(h('h3', { class: 'tz-pref-heading' }, f.label))
      continue
    }
    if (f.type === 'custom') {
      box.append(f.render(ctx, rerender))
      continue
    }
    if (f.type === 'button') {
      const btn = h('button', { type: 'button', class: 'tz-pref-btn' }, f.text)
      btn.addEventListener('click', () => {
        btn.disabled = true
        f.run(ctx)
          .catch((err: unknown) => ctx.toast(err instanceof Error ? err.message : String(err), true))
          .finally(() => {
            btn.disabled = false
          })
      })
      box.append(h('div', { class: 'tz-field' }, h('span', { class: 'tz-field-label' }, f.label), btn, f.hint ? h('span', { class: 'tz-field-hint' }, f.hint) : null))
      continue
    }
    const value = s[f.key]
    if (f.type === 'bool') {
      const input = h('input', { type: 'checkbox', 'data-key': f.key })
      input.checked = Boolean(value)
      input.addEventListener('change', () => save(ctx, { [f.key]: input.checked } as Partial<AppSettings>, rerender))
      box.append(row(f.label, input, f.hint))
    } else if (f.type === 'select') {
      const select = h('select', { 'data-key': f.key }, ...f.options.map((o) => h('option', { value: o.value }, o.label)))
      // 数值型(缩放比例)可能是滚轮缩放出来的非预设值,补一项让它能显示出来
      if (f.numeric && !f.options.some((o) => o.value === String(value))) select.append(h('option', { value: String(value) }, `${Math.round(Number(value) * 100)}%`))
      select.value = String(value)
      select.addEventListener('change', () => {
        const v: unknown = f.numeric ? Number(select.value) : typeof value === 'boolean' ? select.value === 'true' : select.value
        save(ctx, { [f.key]: v } as Partial<AppSettings>, rerender)
      })
      box.append(row(f.label, select, f.hint))
    } else if (f.type === 'textarea') {
      const area = h('textarea', { rows: 3, placeholder: f.placeholder ?? '', 'data-key': f.key, spellcheck: 'false' })
      area.value = String(value ?? '')
      area.addEventListener('change', () => save(ctx, { [f.key]: area.value } as Partial<AppSettings>))
      box.append(row(f.label, area, f.hint))
    } else if (f.type === 'folder' || f.type === 'file') {
      const input = h('input', { type: 'text', placeholder: f.placeholder ?? '', 'data-key': f.key, spellcheck: 'false' })
      input.value = String(value ?? '')
      input.addEventListener('change', () => save(ctx, { [f.key]: input.value.trim() } as Partial<AppSettings>))
      const pick = h('button', { type: 'button', class: 'tz-pref-btn' }, '选择…')
      pick.addEventListener('click', () => {
        void ctx.host.openDialog({ directory: f.type === 'folder' }).then((paths) => {
          if (!paths?.[0]) return
          input.value = paths[0]
          save(ctx, { [f.key]: paths[0] } as Partial<AppSettings>)
        })
      })
      box.append(row(f.label, h('span', { class: 'tz-pref-path' }, input, pick), f.hint))
    } else {
      const input = h('input', { type: f.type, placeholder: f.placeholder ?? '', 'data-key': f.key, spellcheck: 'false' })
      input.value = String(value ?? '')
      input.addEventListener('change', () => {
        if (f.type === 'number') {
          const n = Number(input.value)
          if (!Number.isFinite(n) || input.value.trim() === '') {
            ctx.toast(`「${f.label}」需要填数字`, true)
            input.value = String(value)
            return
          }
          save(ctx, { [f.key]: n } as Partial<AppSettings>)
        } else {
          save(ctx, { [f.key]: input.value } as Partial<AppSettings>)
        }
      })
      box.append(row(f.label, input, f.hint))
    }
  }
  return box
}

/** 拼写检查:不使用 / 自动检测 / 指定语言(PE-08)。「不使用」即关闭拼写检查。 */
function spellingField(ctx: PreferencesContext, rerender: () => void): HTMLElement {
  const s = ctx.settings
  const select = h('select', { 'data-key': 'spellcheckLanguage' }, ...SPELLING_LANGUAGES.map((o) => h('option', { value: o.value }, o.label)))
  select.value = s.spellcheck ? s.spellcheckLanguage : 'off'
  select.addEventListener('change', () => {
    const v = select.value
    save(ctx, v === 'off' ? { spellcheck: false } : { spellcheck: true, spellcheckLanguage: v }, rerender)
  })
  return row('拼写检查', select, '使用 macOS 系统词典')
}

/** 主题下拉框:内置主题 + 主题文件夹里的自定义主题(读完文件夹后补上)。 */
function themeField(ctx: PreferencesContext, key: 'theme' | 'darkTheme', label: string): HTMLElement {
  const select = h('select', { 'data-key': key }, ...THEME_OPTIONS.map((o) => h('option', { value: o.value }, o.label)))
  const current = ctx.settings[key]
  const ensure = (id: string) => {
    if (!Array.from(select.options).some((o) => o.value === id)) select.append(h('option', { value: id }, id))
  }
  ensure(current)
  select.value = current
  void listCustomThemes(ctx.host)
    .then((ids) => {
      for (const id of ids) ensure(id)
      select.value = ctx.settings[key]
    })
    .catch((err: unknown) => ctx.toast(`读取主题文件夹失败:${err instanceof Error ? err.message : String(err)}`, true))
  select.addEventListener('change', () => save(ctx, { [key]: select.value } as Partial<AppSettings>))
  return row(label, select)
}

/** 阅读速度:120 / 240 / 382 + 自定义(PA-05),单位为每分钟字数(中日韩按字,西文按词)。 */
function readingSpeedField(ctx: PreferencesContext, rerender: () => void): HTMLElement {
  const speed = ctx.settings.readingSpeed
  const preset = READING_SPEEDS.includes(speed)
  const select = h('select', { 'data-key': 'readingSpeed' }, ...READING_SPEEDS.map((v) => h('option', { value: String(v) }, `${v} 字每分钟`)), h('option', { value: 'custom' }, '自定义'))
  select.value = preset ? String(speed) : 'custom'
  const custom = h('input', { type: 'number', min: 1, 'data-key': 'readingSpeedCustom', hidden: preset })
  custom.value = String(speed)
  select.addEventListener('change', () => {
    if (select.value === 'custom') {
      custom.hidden = false
      custom.focus()
      return
    }
    save(ctx, { readingSpeed: Number(select.value) }, rerender)
  })
  custom.addEventListener('change', () => {
    const n = Number(custom.value)
    if (!Number.isFinite(n) || n <= 0) {
      ctx.toast('阅读速度需要填大于 0 的数字', true)
      return
    }
    save(ctx, { readingSpeed: Math.round(n) })
  })
  return row('阅读速度', h('span', { class: 'tz-pref-path' }, select, custom), '用于字数统计里的阅读时间')
}

// ---------- 导出项(PX-09) ----------

function exportItemsEditor(ctx: PreferencesContext, rerender: () => void): HTMLElement {
  const items = ctx.settings.exportItems
  const saveItems = (next: ExportItem[]) => save(ctx, { exportItems: next }, rerender)
  const box = h('div', { class: 'tz-export-items' })
  items.forEach((item, i) => box.append(exportItemEditor(ctx, item, i, items, saveItems)))
  if (items.length === 0) box.append(h('p', { class: 'tz-field-hint' }, '还没有导出项。从模板添加后会出现在 文件 ▸ 导出 菜单末尾。'))
  const add = h('select', { 'data-key': 'exportTemplate' }, h('option', { value: '' }, '从模板添加…'), ...EXPORT_TEMPLATES.map((t) => h('option', { value: t.template }, t.label)))
  add.addEventListener('change', () => {
    if (!add.value) return
    saveItems([...items, newExportItem(add.value as ExportItemTemplate)])
  })
  box.append(add)
  return box
}

function exportItemEditor(ctx: PreferencesContext, item: ExportItem, index: number, items: ExportItem[], saveItems: (next: ExportItem[]) => void): HTMLElement {
  const patch = (p: Partial<ExportItem>) => saveItems(items.map((x, j) => (j === index ? { ...x, ...p } : x)))
  const text = (label: string, key: 'name' | 'to' | 'ext' | 'args' | 'pdfEngine' | 'command', placeholder = '') => {
    const input = h('input', { type: 'text', placeholder, spellcheck: 'false' })
    input.value = item[key]
    input.addEventListener('change', () => patch({ [key]: input.value.trim() } as Partial<ExportItem>))
    return row(label, input)
  }
  const template = EXPORT_TEMPLATES.find((t) => t.template === item.template)?.label ?? item.template
  const fields: HTMLElement[] = [text('名称', 'name')]
  if (item.template === 'markdown') {
    const variant = h('select', null, ...MARKDOWN_VARIANTS.map((v) => h('option', { value: v.value }, v.label)))
    variant.value = item.to
    variant.addEventListener('change', () => patch({ to: variant.value }))
    fields.push(row('规范', variant))
    const columns = h('input', { type: 'number', min: 0 })
    columns.value = String(item.columns)
    columns.addEventListener('change', () => patch({ columns: Math.max(0, Math.round(Number(columns.value) || 0)) }))
    fields.push(row('每行字符数', columns, '0 表示不折行'))
    const eol = h('select', null, ...opts([
      ['lf', 'LF'],
      ['crlf', 'CRLF'],
      ['native', '跟随系统'],
    ]).map((o) => h('option', { value: o.value }, o.label)))
    eol.value = item.eol
    eol.addEventListener('change', () => patch({ eol: eol.value as ExportItem['eol'] }))
    fields.push(row('换行符', eol))
    for (const [key, label] of [
      ['referenceLinks', '使用引用式链接'],
      ['ascii', '只使用 ASCII 字符'],
    ] as const) {
      const box = h('input', { type: 'checkbox' })
      box.checked = item[key]
      box.addEventListener('change', () => patch({ [key]: box.checked } as Partial<ExportItem>))
      fields.push(row(label, box))
    }
  }
  if (item.template === 'pandoc') fields.push(text('Pandoc 目标格式', 'to', 'html5'))
  if (item.template === 'pandoc-pdf') fields.push(text('PDF 引擎', 'pdfEngine', 'xelatex'))
  if (item.template === 'command') {
    fields.push(text('命令', 'command', 'pandoc "${currentPath}" -o "${outputPath}"'))
    const dialog = h('select', null, ...opts([
      ['none', '不弹出'],
      ['file', '选择文件'],
      ['folder', '选择文件夹'],
    ]).map((o) => h('option', { value: o.value }, o.label)))
    dialog.value = item.dialog
    dialog.addEventListener('change', () => patch({ dialog: dialog.value as ExportItem['dialog'] }))
    fields.push(row('执行前弹出', dialog))
    const show = h('input', { type: 'checkbox' })
    show.checked = item.showOutput
    show.addEventListener('change', () => patch({ showOutput: show.checked }))
    fields.push(row('显示命令行输出', show))
  }
  fields.push(text('扩展名', 'ext'))
  if (item.template !== 'command') fields.push(text('额外参数', 'args'))
  const move = (delta: number) => {
    const next = items.slice()
    const [moved] = next.splice(index, 1)
    next.splice(index + delta, 0, moved)
    saveItems(next)
  }
  const up = h('button', { type: 'button', class: 'tz-pref-btn', disabled: index === 0 }, '上移')
  up.addEventListener('click', () => move(-1))
  const down = h('button', { type: 'button', class: 'tz-pref-btn', disabled: index === items.length - 1 }, '下移')
  down.addEventListener('click', () => move(1))
  const del = h('button', { type: 'button', class: 'tz-pref-btn is-danger' }, '删除')
  del.addEventListener('click', () => {
    void ctx.host.confirm({ title: '删除该导出选项 ?', message: item.name, buttons: ['删除', '取消'], style: 'warning' }).then((choice) => {
      if (choice === 0) saveItems(items.filter((_x, j) => j !== index))
    })
  })
  return h(
    'div',
    { class: 'tz-export-item', 'data-item': item.id },
    h('div', { class: 'tz-export-item-head' }, h('strong', null, item.name || '未命名'), h('span', { class: 'tz-field-hint' }, template), up, down, del),
    ...fields,
  )
}

// ---------- 快捷键(PRD 3.13 快捷键页) ----------

function renderShortcuts(ctx: PreferencesContext): HTMLElement {
  const search = h('input', { type: 'search', class: 'tz-keys-search', placeholder: '搜索命令或键位', spellcheck: 'false' })
  const reset = h('button', { type: 'button', class: 'tz-pref-btn' }, '恢复默认')
  const list = h('div', { class: 'tz-keys-list' })

  const render = () => {
    const q = search.value.trim().toLowerCase()
    const rows = commandRows(ctx.settings.keybindings).filter(
      (r) => !q || r.label.toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || r.keys.some((k) => displayKey(k).toLowerCase().includes(q)),
    )
    list.replaceChildren(...rows.map(renderRow))
    if (rows.length === 0) list.append(h('div', { class: 'tz-side-empty' }, '没有找到对应的命令'))
  }

  const setKeys = (next: Record<string, string>) => save(ctx, { keybindings: next }, render)

  const renderRow = (r: { id: string; label: string; keys: string[] }): HTMLElement => {
    const btn = h('button', { type: 'button', class: 'tz-key-btn', 'data-command': r.id, title: '点击录制新键位;⌫ 清除,Esc 取消' }, r.keys.length ? r.keys.map(displayKey).join(' / ') : '无')
    const note = h('div', { class: 'tz-key-note', hidden: true })
    btn.addEventListener('click', () => record(btn, note, r.id))
    return h('div', { class: 'tz-key-row' }, h('span', { class: 'tz-key-label' }, r.label), btn, note)
  }

  const record = (btn: HTMLButtonElement, note: HTMLElement, id: string) => {
    btn.textContent = '请按下新键位…'
    btn.classList.add('is-recording')
    // 录制期间 Esc 不关偏好设置面板(见 panels.ts modal)
    btn.setAttribute('data-tz-capture-keys', '')
    btn.focus()
    const stop = () => {
      btn.removeEventListener('keydown', onKey)
      btn.removeEventListener('blur', onBlur)
      btn.removeAttribute('data-tz-capture-keys')
      btn.classList.remove('is-recording')
    }
    const onBlur = () => {
      stop()
      render()
    }
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
      if (plain && e.key === 'Escape') {
        stop()
        render()
        return
      }
      if (plain && (e.key === 'Backspace' || e.key === 'Delete')) {
        stop()
        setKeys(clearCommandKeys(ctx.settings.keybindings, id))
        return
      }
      const key = keyName(e)
      const owner = keyOwner(effectiveKeyTable(ctx.settings.keybindings), key, id)
      if (!owner) {
        stop()
        setKeys(assignKey(ctx.settings.keybindings, id, key))
        return
      }
      note.replaceChildren(`该键位已被『${owner.label}』使用`)
      note.hidden = false
      if (owner.reserved) {
        // 系统保留键不能占用,继续等下一个键
        btn.textContent = `${displayKey(key)} 不可用,请换一个键…`
        return
      }
      stop()
      btn.textContent = displayKey(key)
      const confirm = h('button', { type: 'button', class: 'tz-pref-btn' }, '仍然使用')
      const cancel = h('button', { type: 'button', class: 'tz-pref-btn' }, '取消')
      confirm.addEventListener('click', () => setKeys(assignKey(ctx.settings.keybindings, id, key)))
      cancel.addEventListener('click', render)
      note.append(confirm, cancel)
    }
    btn.addEventListener('keydown', onKey)
    btn.addEventListener('blur', onBlur)
  }

  search.addEventListener('input', render)
  reset.addEventListener('click', () => setKeys({}))
  render()
  return h('div', { class: 'tz-keys' }, h('div', { class: 'tz-keys-bar' }, search, reset), list)
}
