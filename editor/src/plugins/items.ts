// 菜单条目:块类型、颜色、媒体插入。斜杠菜单、块菜单、「转换为」菜单共用同一份定义。
import { TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { type BlockKind, currentBlockKind, setColor, turnInto } from '../core/commands'
import type { EditorEnv } from '../core/env'
import { rememberColor } from '../core/selection-commands'
import { runCommand } from '../core/registry'
import { NOTION_COLORS } from '../core/schema'
import type { MenuItem } from '../ui/menu'

export interface BlockKindDef {
  kind: BlockKind
  label: string
  icon: string
  hint: string
  keywords: string[]
}

export const BLOCK_KINDS: BlockKindDef[] = [
  { kind: 'paragraph', label: '正文', icon: 'T', hint: '⌘⌥0', keywords: ['text', 'paragraph', 'zhengwen', 'zw', 'wenben'] },
  { kind: 'h1', label: '一级标题', icon: 'H1', hint: '#', keywords: ['h1', 'heading1', 'title', 'biaoti', 'bt1'] },
  { kind: 'h2', label: '二级标题', icon: 'H2', hint: '##', keywords: ['h2', 'heading2', 'biaoti', 'bt2'] },
  { kind: 'h3', label: '三级标题', icon: 'H3', hint: '###', keywords: ['h3', 'heading3', 'biaoti', 'bt3'] },
  { kind: 'h4', label: '四级标题', icon: 'H4', hint: '####', keywords: ['h4', 'heading4', 'bt4'] },
  { kind: 'h5', label: '五级标题', icon: 'H5', hint: '#####', keywords: ['h5', 'heading5', 'bt5'] },
  { kind: 'h6', label: '六级标题', icon: 'H6', hint: '######', keywords: ['h6', 'heading6', 'bt6'] },
  { kind: 'todo', label: '待办列表', icon: '☑', hint: '[]', keywords: ['todo', 'task', 'checkbox', 'daiban', 'db', 'renwu'] },
  { kind: 'bullet', label: '无序列表', icon: '•', hint: '-', keywords: ['bullet', 'list', 'ul', 'wuxu', 'liebiao'] },
  { kind: 'numbered', label: '有序列表', icon: '1.', hint: '1.', keywords: ['numbered', 'ordered', 'ol', 'youxu', 'liebiao'] },
  { kind: 'toggle', label: '折叠列表', icon: '▸', hint: '>', keywords: ['toggle', 'details', 'collapse', 'zhedie', 'zd'] },
  { kind: 'quote', label: '引用', icon: '❝', hint: '"', keywords: ['quote', 'blockquote', 'yinyong', 'yy'] },
  { kind: 'callout', label: '标注', icon: '💡', hint: '', keywords: ['callout', 'note', 'tip', 'alert', 'biaozhu', 'tishi'] },
  { kind: 'code', label: '代码块', icon: '</>', hint: '```', keywords: ['code', 'codeblock', 'daima', 'dm'] },
  { kind: 'math', label: '公式块', icon: '∑', hint: '$$', keywords: ['math', 'equation', 'latex', 'katex', 'gongshi', 'gs'] },
]

export function turnIntoItems(view: EditorView, onlyTextual = false): MenuItem[] {
  const current = currentBlockKind(view.state)
  return BLOCK_KINDS.filter((k) => !onlyTextual || k.kind !== 'callout').map((k) => ({
    id: `turn.${k.kind}`,
    label: k.label,
    icon: k.icon,
    hint: k.hint,
    keywords: k.keywords,
    active: current === k.kind,
    run: () => {
      turnInto(view, k.kind)
      view.focus()
    },
  }))
}

export function colorItems(view: EditorView, applyToBlock: boolean): MenuItem[] {
  const apply = (color: string | null, background: string | null) => {
    if (applyToBlock) selectBlockText(view)
    rememberColor(color, background)
    setColor(color, background)(view.state, view.dispatch)
    view.focus()
  }
  const text: MenuItem[] = [
    { id: 'color.default', label: '默认颜色', group: '文字颜色', icon: 'A', keywords: ['default', 'moren'], run: () => apply(null, null) },
    ...NOTION_COLORS.map((c) => ({
      id: `color.${c.name}`,
      label: c.label,
      group: '文字颜色',
      icon: colorSwatch(c.color, null),
      keywords: [c.name, 'color'],
      run: () => apply(c.color, null),
    })),
  ]
  const bg: MenuItem[] = NOTION_COLORS.map((c) => ({
    id: `bg.${c.name}`,
    label: `${c.label}背景`,
    group: '背景色',
    icon: colorSwatch(null, c.background),
    keywords: [`${c.name}background`, 'background', 'bg', 'beijing'],
    run: () => apply(null, c.background),
  }))
  return [...text, ...bg]
}

function colorSwatch(color: string | null, background: string | null): HTMLElement {
  const el = document.createElement('span')
  el.className = 'tz-swatch'
  el.textContent = 'A'
  if (color) el.style.color = color
  if (background) el.style.background = background
  return el
}

/** 把选区扩展为当前文本块的全部文字(斜杠菜单里选颜色时作用于整块,Notion 行为)。 */
function selectBlockText(view: EditorView): void {
  const { $from } = view.state.selection
  if (!$from.parent.isTextblock) return
  const start = $from.start()
  const end = $from.end()
  if (end > start) {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start, end)))
  }
}

/** 斜杠菜单全部条目。 */
export function slashItems(view: EditorView, env: EditorEnv): MenuItem[] {
  const cmd = (id: string) => () => {
    runCommand(view, id)
    view.focus()
  }
  const basic: MenuItem[] = BLOCK_KINDS.map((k) => ({
    id: `slash.${k.kind}`,
    label: k.label,
    icon: k.icon,
    hint: k.hint,
    keywords: k.keywords,
    group: '基础块',
    run: () => {
      turnInto(view, k.kind)
      view.focus()
    },
  }))
  const inserts: MenuItem[] = [
    { id: 'slash.table', label: '表格', icon: '▦', group: '基础块', keywords: ['table', 'biaoge', 'bg'], run: cmd('insert.table') },
    { id: 'slash.divider', label: '分割线', icon: '—', hint: '---', group: '基础块', keywords: ['divider', 'hr', 'line', 'fenge', 'fgx'], run: cmd('insert.divider') },
    { id: 'slash.toc', label: '目录', icon: '☰', group: '基础块', keywords: ['toc', 'contents', 'mulu', 'ml'], run: cmd('insert.toc') },
    { id: 'slash.footnote', label: '脚注', icon: '¹', group: '基础块', keywords: ['footnote', 'jiaozhu'], run: cmd('insert.footnote') },
    { id: 'slash.yaml', label: 'YAML Front Matter', icon: '⚙', group: '基础块', keywords: ['yaml', 'frontmatter', 'meta'], run: cmd('insert.frontMatter') },
    { id: 'slash.inlineMath', label: '行内公式', icon: '√', hint: '⌘⇧E', group: '行内', keywords: ['inline', 'math', 'equation', 'gongshi'], run: cmd('format.inlineMath') },
    { id: 'slash.link', label: '链接到文档', icon: '↗', hint: '[[', group: '行内', keywords: ['link', 'page', 'mention', 'lianjie', 'wendang'], run: () => env.actions.insertDocLink(view) },
  ]
  const media: MenuItem[] = [
    { id: 'slash.image', label: '图片', icon: '🖼', group: '媒体', keywords: ['image', 'picture', 'img', 'tupian', 'tp'], run: () => void env.actions.insertLocalMedia(view, 'image') },
    { id: 'slash.imageUrl', label: '网络图片', icon: '🌐', group: '媒体', keywords: ['image', 'url', 'tupian'], run: () => env.actions.insertFromUrl(view, 'image') },
    { id: 'slash.video', label: '视频', icon: '🎬', group: '媒体', keywords: ['video', 'movie', 'mp4', 'shipin', 'sp'], run: () => void env.actions.insertLocalMedia(view, 'video') },
    { id: 'slash.audio', label: '音频', icon: '🎵', group: '媒体', keywords: ['audio', 'music', 'mp3', 'yinpin'], run: () => void env.actions.insertLocalMedia(view, 'audio') },
    { id: 'slash.embed', label: '嵌入网页 / 视频', icon: '▶', group: '媒体', keywords: ['embed', 'youtube', 'bilibili', 'iframe', 'qianru'], run: () => env.actions.insertFromUrl(view, 'embed') },
    { id: 'slash.bookmark', label: '网页书签', icon: '🔖', group: '媒体', keywords: ['bookmark', 'web', 'shuqian'], run: () => env.actions.insertFromUrl(view, 'bookmark') },
    { id: 'slash.pdf', label: 'PDF', icon: '📄', group: '媒体', keywords: ['pdf'], run: () => void env.actions.insertLocalMedia(view, 'pdf') },
    { id: 'slash.file', label: '附件', icon: '📎', group: '媒体', keywords: ['file', 'attachment', 'fujian'], run: () => void env.actions.insertLocalMedia(view, 'file') },
  ]
  const colors = colorItems(view, true).map((it) => ({ ...it, group: it.group === '背景色' ? '背景色' : '文字颜色' }))
  return [...basic, ...inserts, ...media, ...colors]
}
