// 图片节点操作:单击图片的工具条、右键「图像工具」、菜单「格式 ▸ 图像」共用(PRD 3.4,对照表 M-17 ~ M-28)。
import type { Node as PMNode } from 'prosemirror-model'
import { type EditorState, NodeSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { schema } from './schema'

export interface ImageRef {
  node: PMNode
  pos: number
}

/** 缩放比例菜单(对照表 M-17)。100% 即原始大小。 */
export const ZOOM_PRESETS = ['25%', '33%', '50%', '67%', '80%', '100%', '150%', '200%']

/** 当前要操作的图片:选中的图片,或紧挨光标的图片。 */
export function currentImage(state: EditorState): ImageRef | null {
  const sel = state.selection
  if (sel instanceof NodeSelection) return sel.node.type === schema.nodes.image ? { node: sel.node, pos: sel.from } : null
  if (!sel.empty) return null
  const $p = sel.$from
  if ($p.nodeAfter?.type === schema.nodes.image) return { node: $p.nodeAfter, pos: $p.pos }
  if ($p.nodeBefore?.type === schema.nodes.image) return { node: $p.nodeBefore, pos: $p.pos - $p.nodeBefore.nodeSize }
  return null
}

/** 文档里全部图片(按出现顺序)。 */
export function allImages(doc: PMNode): ImageRef[] {
  const out: ImageRef[] = []
  doc.descendants((node, pos) => {
    if (node.type === schema.nodes.image) out.push({ node, pos })
  })
  return out
}

/** 改图片属性并保持选中(工具条操作后还能接着操作)。 */
export function setImageAttrs(view: EditorView, pos: number, patch: Record<string, unknown>): void {
  const node = view.state.doc.nodeAt(pos)
  if (!node || node.type !== schema.nodes.image) throw new Error(`位置 ${pos} 处不是图片`)
  const tr = view.state.tr.setNodeMarkup(pos, null, { ...node.attrs, ...patch })
  tr.setSelection(NodeSelection.create(tr.doc, pos))
  view.dispatch(tr)
}

/**
 * 选比例(PRD 3.4 尺寸存储):写 style="zoom:N%",清掉拖手柄留下的宽高;100% 回到原始大小。
 * 不改写法标记 html,所以从 ![]() 缩放后再选 100% 会回到 ![]()。
 */
export function zoomAttrs(preset: string): Record<string, unknown> {
  return preset === '100%' ? { zoom: null, width: null, height: null } : { zoom: preset, width: null, height: null }
}

/** 拖手柄:写宽度像素 <img width="480">,清掉比例缩放。 */
export function widthAttrs(width: number): Record<string, unknown> {
  return { width: String(Math.round(width)), height: null, zoom: null }
}

/** 当前写法:带尺寸或原文是 <img> 的是 HTML。 */
export function imageSyntax(node: PMNode): 'markdown' | 'html' {
  const a = node.attrs
  return a.html || a.width || a.height || a.zoom || a.align ? 'html' : 'markdown'
}

/** 转换图片语法(对照表 M-18)。有缩放或宽度时只能用 HTML,返回提示文字;成功返回 null。 */
export function convertImageSyntax(view: EditorView, pos: number, to: 'markdown' | 'html'): string | null {
  const node = view.state.doc.nodeAt(pos)
  if (!node || node.type !== schema.nodes.image) throw new Error(`位置 ${pos} 处不是图片`)
  const a = node.attrs
  if (to === 'markdown') {
    if (a.width || a.height || a.zoom || a.align) return '图片设置了缩放或宽度,只能使用 HTML 格式'
    setImageAttrs(view, pos, { html: false })
  } else {
    // 引用式图片 ![a][id] 转 HTML 时直接写出地址
    setImageAttrs(view, pos, { html: true, ref: null, refType: null })
  }
  return null
}

export function deleteImage(view: EditorView, pos: number): void {
  const node = view.state.doc.nodeAt(pos)
  if (!node || node.type !== schema.nodes.image) throw new Error(`位置 ${pos} 处不是图片`)
  view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize).scrollIntoView())
}

/** 批量改图片地址(复制 / 移动 / 上传全部图片后):原地址 → 新地址。 */
export function replaceImageSources(view: EditorView, map: Map<string, string>): number {
  const tr = view.state.tr
  let count = 0
  view.state.doc.descendants((node, pos) => {
    if (node.type !== schema.nodes.image) return
    const next = map.get(node.attrs.src as string)
    if (next === undefined || next === node.attrs.src) return
    tr.setNodeMarkup(pos, null, { ...node.attrs, src: next })
    count++
  })
  if (count) view.dispatch(tr)
  return count
}

/** 异步操作结束后按节点对象找回位置(期间文档可能被改过)。 */
export function locateNode(doc: PMNode, target: PMNode): number | null {
  let found: number | null = null
  doc.descendants((node, pos) => {
    if (found !== null) return false
    if (node === target) found = pos
    return found === null
  })
  return found
}
