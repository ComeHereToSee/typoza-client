// 「编辑 ▸ 空格与换行」的显示选项(对照表 E-28 ~ E-30):首行缩进、显示 <br/>、保留单换行符。只影响显示,不改文件。
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import { schema } from '../core/schema'

export interface DisplayOptions {
  /** 段落首行缩进 */
  firstLineIndent: boolean
  /** 把 <br> 换行显示为可见的「<br/>」标记 */
  showBrTag: boolean
  /** 段内单个换行显示为换行(关闭时按 Markdown 渲染规则显示为空格) */
  preserveSingleNewline: boolean
}

export const DEFAULT_DISPLAY_OPTIONS: DisplayOptions = { firstLineIndent: false, showBrTag: false, preserveSingleNewline: true }

interface DisplayState {
  options: DisplayOptions
  decorations: DecorationSet
}

const displayKey = new PluginKey<DisplayState>('tz-display')

// 新建编辑器状态(切换文档、源码模式回来)时沿用当前选项
let currentOptions: DisplayOptions = { ...DEFAULT_DISPLAY_OPTIONS }

function brTag(): HTMLElement {
  const el = document.createElement('span')
  el.className = 'tz-br-tag'
  el.contentEditable = 'false'
  el.textContent = '<br/>'
  return el
}

function buildDecorations(doc: PMNode, options: DisplayOptions): DecorationSet {
  if (!options.showBrTag && options.preserveSingleNewline) return DecorationSet.empty
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.spec.code) return false
    if (options.showBrTag && node.type === schema.nodes.hard_break && node.attrs.syntax === 'html') {
      decos.push(Decoration.widget(pos, brTag, { side: -1, key: 'br' }))
    }
    if (!options.preserveSingleNewline && node.isText) {
      const text = node.text ?? ''
      for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
        decos.push(Decoration.inline(pos + i, pos + i + 1, { class: 'tz-soft-break' }))
      }
    }
    return true
  })
  return DecorationSet.create(doc, decos)
}

export function displayPlugin(): Plugin<DisplayState> {
  return new Plugin<DisplayState>({
    key: displayKey,
    state: {
      init: (_config, state) => ({ options: currentOptions, decorations: buildDecorations(state.doc, currentOptions) }),
      apply(tr, prev, _old, state) {
        const options = tr.getMeta(displayKey) as DisplayOptions | undefined
        if (options) return { options, decorations: buildDecorations(state.doc, options) }
        if (!tr.docChanged) return prev
        return { options: prev.options, decorations: buildDecorations(state.doc, prev.options) }
      },
    },
    props: {
      decorations: (state) => displayKey.getState(state)?.decorations ?? null,
    },
  })
}

export function currentDisplayOptions(): DisplayOptions {
  return { ...currentOptions }
}

/** 应用显示选项:首行缩进靠根节点样式类,<br/> 与单换行靠装饰。不传 view 时只记下,之后新建的编辑器状态生效。 */
export function setDisplayOptions(options: DisplayOptions, view?: EditorView): void {
  currentOptions = { ...options }
  document.documentElement.classList.toggle('tz-first-line-indent', options.firstLineIndent)
  view?.dispatch(view.state.tr.setMeta(displayKey, currentOptions))
}
