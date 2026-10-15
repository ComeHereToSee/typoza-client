// /pdf、/video、/audio:选本机文件或填网址(notion-input 4.2;PRD 3.5)。
// 在线视频 / 音频网站的地址换成嵌入播放器存 <iframe>;直链文件存 <video> / <audio>;PDF 网址存 <iframe src="….pdf">。
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { insertBlock } from '../core/commands'
import { detectEmbed } from '../core/embed'
import type { EditorEnv } from '../core/env'
import { schema } from '../core/schema'
import { h } from '../ui/dom'
import { validateUrl } from '../ui/prompt'

export type MediaSourceKind = 'pdf' | 'video' | 'audio'

const TITLES: Record<MediaSourceKind, string> = { pdf: '插入 PDF', video: '插入视频', audio: '插入音频' }
const PLACEHOLDERS: Record<MediaSourceKind, string> = {
  pdf: 'PDF 网址,如 https://example.com/a.pdf',
  video: '视频网址(YouTube、哔哩哔哩或 .mp4 直链)',
  audio: '音频网址(.mp3 直链等)',
}

/** 网址 → 媒体块。 */
export function mediaNodeForUrl(kind: MediaSourceKind, url: string): PMNode {
  const n = schema.nodes
  if (kind === 'pdf') return n.media.create({ kind: 'pdf', src: url })
  const target = detectEmbed(url)
  if (target?.kind === 'embed') return n.media.create({ kind: 'embed', src: target.src })
  return n.media.create({ kind, src: url })
}

/** 插入网址对应的媒体块:当前是空段落就替换,否则插在当前块下方。 */
export function insertMediaUrl(view: EditorView, kind: MediaSourceKind, url: string): void {
  insertBlock(mediaNodeForUrl(kind, url), false)(view.state, view.dispatch)
}

/**
 * 弹出小浮层:输入网址回车插入;留空回车或点【选择本机文件…】打开文件选择框。
 * 斜杠菜单的 PDF / 视频 / 音频条目调用它。
 */
export function chooseMediaSource(view: EditorView, env: EditorEnv, kind: MediaSourceKind): void {
  const c = view.coordsAtPos(view.state.selection.from)
  const input = h('input', { class: 'tz-prompt-input', placeholder: PLACEHOLDERS[kind], spellcheck: 'false' })
  const error = h('div', { class: 'tz-prompt-error', hidden: true })
  const local = h('button', { type: 'button', class: 'tz-prompt-secondary' }, '选择本机文件…')
  const ok = h('button', { type: 'button', class: 'tz-prompt-ok' }, '插入')
  const box = h(
    'div',
    { class: 'tz-popover tz-prompt tz-media-source' },
    h('div', { class: 'tz-prompt-title' }, TITLES[kind]),
    input,
    error,
    h('div', { class: 'tz-prompt-buttons' }, local, ok),
  )
  document.body.append(box)
  box.style.left = `${Math.min(Math.max(8, c.left), window.innerWidth - 360)}px`
  box.style.top = `${c.bottom + 8}px`

  let done = false
  const finish = () => {
    if (done) return
    done = true
    document.removeEventListener('mousedown', outside, true)
    box.remove()
    view.focus()
  }
  const pickLocal = () => {
    finish()
    void env.actions.insertLocalMedia(view, kind)
  }
  const submit = () => {
    const url = input.value.trim()
    if (!url) {
      pickLocal()
      return
    }
    const msg = validateUrl(url)
    if (msg) {
      error.textContent = msg
      error.hidden = false
      return
    }
    finish()
    insertMediaUrl(view, kind, url)
  }
  const outside = (e: MouseEvent) => {
    if (!box.contains(e.target as Node)) finish()
  }
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      finish()
    }
  })
  local.addEventListener('click', pickLocal)
  ok.addEventListener('click', submit)
  document.addEventListener('mousedown', outside, true)
  requestAnimationFrame(() => input.focus())
}
