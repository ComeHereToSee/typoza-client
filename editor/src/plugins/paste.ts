// 粘贴与拖放:纯文本按 Markdown 解析(⇧⌘V 粘贴为纯文本);选中文字时粘贴网址变链接;
// 单独粘贴网址时弹出「保持链接 / 书签卡片 / 嵌入」菜单(Notion);剪贴板图片与拖入文件拷进资源目录。
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model'
import { Plugin, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { detectEmbed } from '../core/embed'
import type { EditorEnv, ImportFile } from '../core/env'
import { parseMarkdown } from '../core/markdown/parse'
import { schema } from '../core/schema'
import { FloatingMenu, type MenuItem } from '../ui/menu'

const n = schema.nodes

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error ?? new Error(`读取文件失败:${file.name}`))
    reader.readAsDataURL(file)
  })
}

async function filesFrom(list: FileList | null): Promise<ImportFile[]> {
  if (!list || list.length === 0) return []
  const files = Array.from(list)
  return Promise.all(
    files.map(async (f, i) => ({
      // 截图粘贴时文件名是 image.png,加时间戳避免重名覆盖
      name: f.name && f.name !== 'image.png' ? f.name : `粘贴图片-${Date.now()}-${i}.${(f.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg')}`,
      base64: await readAsBase64(f),
    })),
  )
}

/** 一段 Markdown 文本 → 可粘贴的切片(两端尽量打开,单段文字直接融进当前段落)。 */
export function markdownToSlice(text: string, inlineMath: boolean): Slice {
  const { doc } = parseMarkdown(text, { inlineMath })
  const blocks: PMNode[] = []
  doc.forEach((b) => {
    if (b.type !== n.frontmatter) blocks.push(b)
  })
  return Slice.maxOpen(Fragment.fromArray(blocks))
}

function isSingleUrl(text: string): boolean {
  return /^https?:\/\/\S+$/.test(text.trim())
}

export function pastePlugin(env: EditorEnv): Plugin {
  let shiftHeld = false
  const menu = new FloatingMenu({ className: 'tz-paste-menu' })

  const offerUrlMenu = (view: EditorView, url: string, from: number, to: number) => {
    const target = detectEmbed(url)
    const replaceWithBlock = (node: PMNode) => {
      const { state } = view
      const $from = state.doc.resolve(from)
      const para = $from.parent
      const tr = state.tr
      if (para.type === n.paragraph && para.textContent.trim() === state.doc.textBetween(from, to).trim()) {
        const start = $from.before()
        tr.replaceWith(start, start + para.nodeSize, node)
      } else {
        tr.delete(from, to)
        tr.insert(tr.mapping.map($from.after()), node)
      }
      view.dispatch(tr.scrollIntoView())
      view.focus()
    }
    const items: MenuItem[] = [{ id: 'paste.link', label: '保持链接', icon: '↗', run: () => view.focus() }]
    if (target?.kind === 'image') {
      items.unshift({ id: 'paste.image', label: '图片', icon: '🖼', run: () => replaceWithBlock(n.paragraph.create(null, n.image.create({ src: url }))) })
    } else if (target && target.kind !== 'embed') {
      const label = target.kind === 'video' ? '视频' : target.kind === 'audio' ? '音频' : 'PDF'
      items.unshift({ id: 'paste.media', label, icon: '▶', run: () => replaceWithBlock(n.media.create({ kind: target.kind, src: url })) })
    }
    items.push({ id: 'paste.bookmark', label: '书签卡片', icon: '🔖', run: () => replaceWithBlock(n.media.create({ kind: 'bookmark', src: url })) })
    items.push({
      id: 'paste.embed',
      label: target?.kind === 'embed' ? `嵌入 ${target.provider ?? ''}`.trim() : '嵌入网页',
      icon: '▣',
      run: () => replaceWithBlock(n.media.create({ kind: 'embed', src: target?.kind === 'embed' ? target.src : url })),
    })
    const c = view.coordsAtPos(to)
    menu.open(items, c)
  }

  return new Plugin({
    props: {
      handleKeyDown(_view, event) {
        shiftHeld = event.shiftKey
        if (menu.isOpen) {
          if (menu.handleKey(event)) {
            event.preventDefault()
            return true
          }
          menu.close('api')
        }
        return false
      },
      clipboardTextParser(text, $context, plain) {
        // ⇧⌘V 或在代码块里:按纯文本处理,每行一段
        if ((plain && shiftHeld) || $context.parent.type.spec.code) {
          const lines = text.replace(/\r\n?/g, '\n').split('\n')
          return Slice.maxOpen(Fragment.fromArray(lines.map((l) => n.paragraph.create(null, l ? schema.text(l) : null))))
        }
        return markdownToSlice(text, env.settings.inlineMath)
      },
      handlePaste(view, event) {
        const data = event.clipboardData
        if (!data) return false
        if (data.files.length > 0 && !data.getData('text/plain')) {
          event.preventDefault()
          const at = view.state.selection.from
          void filesFrom(data.files).then((files) => env.actions.importFiles(view, files, at))
          return true
        }
        const text = data.getData('text/plain')
        if (!isSingleUrl(text) || view.state.selection.$from.parent.type.spec.code) return false
        const url = text.trim()
        const { from, to, empty } = view.state.selection
        if (!empty) {
          // 选中文字时粘贴网址:文字变成链接(Notion)
          view.dispatch(view.state.tr.addMark(from, to, schema.marks.link.create({ href: url })))
          return true
        }
        const tr = view.state.tr.insertText(url, from)
        tr.addMark(from, from + url.length, schema.marks.link.create({ href: url, autolink: true }))
        tr.setSelection(TextSelection.create(tr.doc, from + url.length))
        view.dispatch(tr)
        offerUrlMenu(view, url, from, from + url.length)
        return true
      },
      handleDrop(view, event, _slice, moved) {
        if (moved || !event.dataTransfer || event.dataTransfer.files.length === 0) return false
        event.preventDefault()
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from
        void filesFrom(event.dataTransfer.files).then((files) => env.actions.importFiles(view, files, pos))
        return true
      },
    },
    view: () => ({ destroy: () => menu.close('api') }),
  })
}
