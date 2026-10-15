// 智能标点「渲染时转换」(对照表 E-32):文件里保留直引号与连字符,只在显示时换成弯引号与破折号。
// 做法:给要替换的字符加一层行内装饰,原字符透明但保留宽度与光标位置,伪元素画出替换后的字符(样式见 themes.css);
// 导出时 exporter 再把它们换成真字符。只在改动涉及的文本块里重算,大文档里打字不卡。
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { EditorEnv } from '../core/env'
import { findReplacements } from '../core/smart-punctuation'

const key = new PluginKey<DecorationSet>('tz-smart-punctuation')

function decorateBlock(block: PMNode, pos: number, env: EditorEnv): Decoration[] {
  if (block.type.spec.code) return []
  let text = ''
  const codeMask: boolean[] = []
  block.forEach((child) => {
    if (child.isText) {
      const value = child.text ?? ''
      const inCode = child.marks.some((m) => m.type.spec.code)
      text += value
      for (let i = 0; i < value.length; i++) codeMask.push(inCode)
    } else {
      // 图片、公式等行内节点占一个位置,不参与转换
      text += '\u{FFFC}'
      codeMask.push(true)
    }
  })
  const start = pos + 1
  return findReplacements(text, env.settings.smartPunctuation, codeMask).map((r) =>
    Decoration.inline(start + r.from, start + r.to, { class: 'tz-smart', 'data-smart': r.text }),
  )
}

function decorateAll(doc: PMNode, env: EditorEnv): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    decos.push(...decorateBlock(node, pos, env))
    return false
  })
  return DecorationSet.create(doc, decos)
}

export function smartPunctuationRenderPlugin(env: EditorEnv): Plugin<DecorationSet> {
  const enabled = () => env.settings.smartPunctuation.mode === 'render'
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_config, state) => (enabled() ? decorateAll(state.doc, env) : DecorationSet.empty),
      apply(tr, old, _oldState, newState) {
        if (!enabled()) return DecorationSet.empty
        if (!tr.docChanged) return old
        let set = old.map(tr.mapping, tr.doc)
        const touched = new Map<number, PMNode>()
        const size = newState.doc.content.size
        tr.mapping.maps.forEach((map, i) => {
          const rest = tr.mapping.slice(i + 1)
          map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
            const from = Math.max(0, rest.map(newStart, -1) - 1)
            const to = Math.min(size, rest.map(newEnd, 1) + 1)
            newState.doc.nodesBetween(from, to, (node, pos) => {
              if (!node.isTextblock) return true
              touched.set(pos, node)
              return false
            })
          })
        })
        for (const [pos, node] of touched) {
          set = set.remove(set.find(pos, pos + node.nodeSize)).add(newState.doc, decorateBlock(node, pos, env))
        }
        return set
      },
    },
    props: {
      decorations: (state) => key.getState(state),
    },
  })
}
