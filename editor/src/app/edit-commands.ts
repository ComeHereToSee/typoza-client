// 「编辑」菜单补齐的命令(对照表 E-07、E-09、E-25 ~ E-30、E-36、E-40,P-38):
// 复制内容并简化格式、粘贴为纯文本 / 粘贴并匹配样式(右键菜单用)、换行符、空格与换行显示选项、
// 解析时转化 Unicode 标点、转换大小写、插入 HTML 块。
import { TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { registerCommand } from '../core/registry'
import type { Host } from '../host/types'
import { insertPlainText } from '../plugins/paste'
import { insertHtmlBlock } from '../views/blocks'
import type { DocumentSession } from './document'
import type { AppSettings } from './settings'

export interface EditCommandContext {
  host: Host
  session: DocumentSession
  settings(): AppSettings
  updateSettings(patch: Partial<AppSettings>): Promise<void>
  /** 文档内容没变但要保存(换行符改了):标记为已修改,按自动保存规则写盘 */
  markDirty(): void
  toast(message: string, error?: boolean): void
}

/** 去掉颜色、字体、字号等内联样式(对照表 E-07),保留结构与粗斜体等语义标签。 */
export function simplifyHtml(root: HTMLElement): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[style], [class], [data-tz-color]'))) {
    el.removeAttribute('style')
    el.removeAttribute('class')
    el.removeAttribute('data-tz-color')
  }
}

export type CaseMode = 'upper' | 'lower' | 'capitalize'

/** 转换大小写(对照表 E-40)。首字母大写:每个词首字母大写、其余小写,与 macOS「首字母大写」一致。 */
export function transformCase(text: string, mode: CaseMode): string {
  if (mode === 'upper') return text.toUpperCase()
  if (mode === 'lower') return text.toLowerCase()
  return text.toLowerCase().replace(/(^|[^\p{L}\p{N}'])(\p{L})/gu, (_m, before: string, ch: string) => before + ch.toUpperCase())
}

/** 对选区里的每段文字转换大小写,格式标记不变。 */
function applyCase(view: EditorView, mode: CaseMode): void {
  const { from, to, empty } = view.state.selection
  if (empty) return
  const doc = view.state.doc
  const ranges: { from: number; to: number; text: string }[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true
    const start = Math.max(from, pos)
    const end = Math.min(to, pos + node.nodeSize)
    if (end > start) ranges.push({ from: start, to: end, text: (node.text ?? '').slice(start - pos, end - pos) })
    return false
  })
  const tr = view.state.tr
  for (const r of ranges.reverse()) {
    // 带上前一个字符一起转换,跨格式的同一个词(如 he**llo**)不会在中间被大写
    const prev = r.from > 0 ? doc.textBetween(r.from - 1, r.from, ' ', ' ') : ''
    const next = transformCase(prev + r.text, mode).slice(prev.length)
    if (next !== r.text) tr.insertText(next, r.from, r.to)
  }
  if (!tr.docChanged) return
  tr.setSelection(TextSelection.create(tr.doc, from, tr.mapping.map(to)))
  view.dispatch(tr)
}

export function registerEditCommands(ctx: EditCommandContext): void {
  const cmd = (id: string, label: string, run: (view: EditorView) => void | Promise<void>) =>
    registerCommand({
      id,
      label,
      run: (view) => {
        Promise.resolve()
          .then(() => run(view))
          .catch((err: unknown) => ctx.toast(`${label}失败:${err instanceof Error ? err.message : String(err)}`, true))
        return true
      },
    })
  const onOff = (on: boolean) => (on ? '已开启' : '已关闭')

  cmd('edit.copySimplified', '复制内容并简化格式', async (view) => {
    if (view.state.selection.empty) return
    const { dom, text } = view.serializeForClipboard(view.state.selection.content())
    simplifyHtml(dom)
    await ctx.host.clipboardWrite({ text, html: dom.innerHTML, rtf: true })
  })
  // 右键菜单里的粘贴为纯文本 / 粘贴并匹配样式:都按字面粘贴、不解析 Markdown(对照表 E-08、E-09)
  cmd('edit.pastePlain', '粘贴为纯文本', async (view) => insertPlainText(view, await ctx.host.clipboardText()))
  cmd('edit.pasteMatchStyle', '粘贴并匹配样式', async (view) => insertPlainText(view, await ctx.host.clipboardText()))

  // E-25 / E-26:改整篇换行符,保存时写回
  for (const [id, ending, label] of [
    ['doc.lineEndingCRLF', '\r\n', 'Windows 换行符(CRLF)'],
    ['doc.lineEndingLF', '\n', 'Unix 换行符(LF)'],
  ] as const) {
    cmd(id, label, () => {
      if (ctx.session.meta.lineEnding === ending) {
        ctx.toast(`当前已是 ${label}`)
        return
      }
      ctx.session.meta = { ...ctx.session.meta, lineEnding: ending }
      ctx.markDirty()
      ctx.toast(`换行符已改为 ${label}`)
    })
  }
  // E-27:与偏好「保存时在文末添加空行」同一开关
  cmd('edit.trailingNewline', '保存时在文末添加空行', async () => {
    const on = !ctx.settings().ensureTrailingNewline
    await ctx.updateSettings({ ensureTrailingNewline: on })
    ctx.toast(`保存时在文末添加空行:${onOff(on)}`)
  })

  // E-28 ~ E-30:只影响显示;与偏好「Markdown」页同一组设置,显示插件由 prefs-apply 统一刷新
  const display = (id: string, label: string, key: 'firstLineIndent' | 'showBrTag' | 'preserveSingleNewline') =>
    cmd(id, label, async () => {
      const on = !ctx.settings()[key]
      await ctx.updateSettings({ [key]: on })
      ctx.toast(`${label}:${onOff(on)}`)
    })
  display('view.firstLineIndent', '首行缩进', 'firstLineIndent')
  display('view.showBrTag', '显示 <br/>', 'showBrTag')
  display('edit.preserveSingleNewline', '保留单换行符', 'preserveSingleNewline')

  // E-36:只影响解析;改设置后 prefs-apply 按新规则重新解析当前文档(文件内容不变)
  cmd('edit.unicodePunctuation', '解析时转化 Unicode 标点', async () => {
    const on = !ctx.settings().unicodePunctuation
    await ctx.updateSettings({ unicodePunctuation: on })
    ctx.toast(`解析时转化 Unicode 标点:${onOff(on)}`)
  })

  cmd('text.uppercase', '转换为大写', (view) => applyCase(view, 'upper'))
  cmd('text.lowercase', '转换为小写', (view) => applyCase(view, 'lower'))
  cmd('text.capitalize', '首字母大写', (view) => applyCase(view, 'capitalize'))

  cmd('insert.htmlBlock', '插入 HTML 内容', (view) => {
    insertHtmlBlock(view)
    view.focus()
  })
}
