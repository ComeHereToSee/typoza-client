// 大文档:屏幕外的顶层块跳过排版与绘制(CSS content-visibility),打开、输入不再随全文长度变慢。
// 只在大文档上启用:content-visibility 自带布局 / 绘制包含,会改变块内外边距折叠、裁掉溢出块的浮层,
// 小文档没必要承担;光标所在的顶层块始终正常渲染,图片工具条、公式编辑框等浮层不会被裁掉。
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

/** 顶层块超过这个数算大文档(约 150KB 的混排文档) */
export const LARGE_DOC_BLOCKS = 1500

export function isLargeDoc(doc: PMNode): boolean {
  return doc.childCount > LARGE_DOC_BLOCKS
}

export function largeDocPlugin(): Plugin {
  return new Plugin({
    props: {
      attributes: (state): Record<string, string> => (isLargeDoc(state.doc) ? { class: 'is-large' } : {}),
      decorations(state) {
        if (!isLargeDoc(state.doc)) return null
        const { $from } = state.selection
        const pos = $from.depth >= 1 ? $from.before(1) : $from.pos
        const node = state.doc.nodeAt(pos)
        if (!node) return null
        return DecorationSet.create(state.doc, [Decoration.node(pos, pos + node.nodeSize, { class: 'tz-active-block' })])
      },
    },
  })
}
