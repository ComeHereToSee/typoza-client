// 媒体块选中时的按键:视频 / 音频按空格播放或暂停(对照表 C-11);PDF 按 ⌘↩ 用系统「预览」打开(PRD 3.5)。
import { keymap } from 'prosemirror-keymap'
import type { Node as PMNode } from 'prosemirror-model'
import { type EditorState, NodeSelection, type Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { type EditorEnv, localPathOf } from '../core/env'
import { schema } from '../core/schema'

function selectedMedia(state: EditorState, kinds: string[]): { node: PMNode; pos: number } | null {
  const sel = state.selection
  if (!(sel instanceof NodeSelection) || sel.node.type !== schema.nodes.media) return null
  return kinds.includes(sel.node.attrs.kind as string) ? { node: sel.node, pos: sel.from } : null
}

/** 媒体块里的播放器元素(没有时为 null,例如文件丢失显示占位时)。 */
export function playerAt(view: EditorView, pos: number): HTMLMediaElement | null {
  const dom = view.nodeDOM(pos)
  return dom instanceof HTMLElement ? dom.querySelector<HTMLMediaElement>('video, audio') : null
}

/** 播放 / 暂停;返回 false 表示没有可用的播放器。 */
export function togglePlayback(view: EditorView, env: EditorEnv, pos: number): boolean {
  const player = playerAt(view, pos)
  if (!player) return false
  if (player.paused) {
    player.play().catch((err: unknown) => env.actions.notify(`无法播放:${err instanceof Error ? err.message : String(err)}`, true))
  } else {
    player.pause()
  }
  return true
}

/** 本机 PDF 用「预览」打开;网络 PDF 交给浏览器(「预览」打不开网址)。 */
export function openPdfExternally(env: EditorEnv, src: string): void {
  const local = localPathOf(env, src)
  const run = local ? env.host.openInPreview(local) : env.host.openExternal(src)
  run.catch((err: unknown) => env.actions.notify(`打开 PDF 失败:${err instanceof Error ? err.message : String(err)}`, true))
}

export function mediaKeysPlugin(env: EditorEnv): Plugin {
  return keymap({
    Space: (state, _dispatch, view) => {
      const m = selectedMedia(state, ['video', 'audio'])
      if (!m || !view) return false
      togglePlayback(view, env, m.pos)
      // 没有播放器也吞掉空格:否则会把选中的媒体块替换成一个空格
      return true
    },
    'Mod-Enter': (state, _dispatch, view) => {
      const m = selectedMedia(state, ['pdf'])
      if (!m || !view) return false
      openPdfExternally(env, m.node.attrs.src as string)
      return true
    },
  })
}
