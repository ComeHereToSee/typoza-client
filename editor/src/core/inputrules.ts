// Notion 式 Markdown 快捷输入:在行首敲标记 + 空格即时转换块类型,敲完成对的行内标记即时变成格式。
// 与 Markdown 冲突处以 Notion 为准:`> ` 是折叠块、`" ` 是引用;`~文字~` 是删除线(下标走菜单)。
import { InputRule, inputRules, wrappingInputRule } from 'prosemirror-inputrules'
import type { Attrs, MarkType, NodeType, Node as PMNode } from 'prosemirror-model'
import { type EditorState, TextSelection, type Transaction } from 'prosemirror-state'
import { canJoin, findWrapping } from 'prosemirror-transform'
import { findAncestor } from './commands'
import { schema } from './schema'

const n = schema.nodes
const m = schema.marks

export interface InputRuleOptions {
  /** 智能标点:`->` → →、`<-` → ←、`--` → — */
  smartPunctuation: boolean
}

/** 段落开头敲标记把段落变成另一种文本块(标题、代码块、公式块)。只在普通段落里生效。 */
function blockTypeRule(re: RegExp, type: NodeType, attrs: (match: RegExpMatchArray) => Attrs | null): InputRule {
  return new InputRule(re, (state, match, start, end) => {
    const $start = state.doc.resolve(start)
    if ($start.parent.type !== n.paragraph) return null
    if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), type)) return null
    return state.tr.delete(start, end).setBlockType(start, start, type, attrs(match))
  })
}

/** 段落开头敲标记把段落包进容器(引用)。只在普通段落里生效。 */
function wrapRule(re: RegExp, type: NodeType): InputRule {
  return new InputRule(re, (state, _match, start, end) => {
    if (state.doc.resolve(start).parent.type !== n.paragraph) return null
    // 自动配对在光标后放了一个收尾引号时一并删掉,否则引用块里会多出一个 "
    const after = end < state.doc.content.size ? state.doc.textBetween(end, end + 1) : ''
    const tr = state.tr.delete(start, after === '"' || after === '”' ? end + 1 : end)
    const range = tr.doc.resolve(start).blockRange()
    const wrapping = range && findWrapping(range, type)
    if (!range || !wrapping) return null
    tr.wrap(range, wrapping)
    const before = tr.doc.resolve(start - 1).nodeBefore
    if (before?.type === type && canJoin(tr.doc, start - 1)) tr.join(start - 1)
    return tr
  })
}

/** 把段落替换成新块,段落里光标后的内容带进新块(若新块能装文字)。 */
function replaceParagraph(
  state: EditorState,
  start: number,
  end: number,
  make: (rest: PMNode['content']) => PMNode,
  cursorOffset: number,
): Transaction | null {
  const $start = state.doc.resolve(start)
  if ($start.parent.type !== n.paragraph) return null
  const para = $start.parent
  const blockStart = $start.before()
  const rest = para.content.cut(end - $start.start())
  const tr = state.tr.replaceWith(blockStart, blockStart + para.nodeSize, make(rest))
  tr.setSelection(TextSelection.create(tr.doc, blockStart + cursorOffset))
  return tr
}

function blockRules(): InputRule[] {
  return [
    blockTypeRule(/^(#{1,6})\s$/, n.heading, (match) => ({ level: match[1].length })),
    wrappingInputRule(/^\s*([-+*])\s$/, n.bullet_list),
    wrappingInputRule(
      /^(\d+|[a-z]|[ivx]+)\.\s$/,
      n.ordered_list,
      (match) => ({ start: /^\d+$/.test(match[1]) ? Number(match[1]) : 1 }),
      (match, node) => /^\d+$/.test(match[1]) && node.childCount + node.attrs.start === Number(match[1]),
    ),
    // 待办:列表项开头敲 `[ ] ` 把它变成待办;普通段落里敲则新建待办列表
    new InputRule(/^(?:\[( |x|X)?\]|【】)\s$/, (state, match, start, end) => {
      const checked = match[1] === 'x' || match[1] === 'X'
      const $start = state.doc.resolve(start)
      const item = findAncestor($start, n.list_item)
      if (item && $start.parent === item.node.firstChild && $start.parentOffset === 0) {
        return state.tr.delete(start, end).setNodeMarkup(item.pos, null, { checked })
      }
      if ($start.parent.type !== n.paragraph) return null
      return replaceParagraph(
        state,
        start,
        end,
        (rest) => n.bullet_list.create(null, n.list_item.create({ checked }, n.paragraph.create(null, rest))),
        3,
      )
    }),
    // Notion:`> ` 生成折叠块(全角 》 同效);在空标题里敲 > 生成同级折叠标题
    new InputRule(/^[>》]\s?$/, (state, match, start, end) => {
      const $start = state.doc.resolve(start)
      const parent = $start.parent
      if (parent.type === n.heading && parent.content.size === end - start - (match[0].length - 1) && parent.attrs.level <= 3) {
        const blockStart = $start.before()
        const toggle = n.toggle.create(null, n.toggle_summary.create({ level: parent.attrs.level }))
        const tr = state.tr.replaceWith(blockStart, blockStart + parent.nodeSize, toggle)
        tr.setSelection(TextSelection.create(tr.doc, blockStart + 2))
        return tr
      }
      if (!/\s$/.test(match[0])) return null
      return replaceParagraph(state, start, end, (rest) => n.toggle.create(null, n.toggle_summary.create(null, rest)), 2)
    }),
    // 空折叠块标题里敲 #/##/### + 空格:变成折叠标题
    new InputRule(/^(#{1,3})\s$/, (state, match, start, end) => {
      const $start = state.doc.resolve(start)
      if ($start.parent.type !== n.toggle_summary) return null
      return state.tr.delete(start, end).setNodeMarkup($start.before(), null, { level: match[1].length })
    }),
    // Notion:`" ` 生成引用(开了智能引号或中文输入时敲出来的是 “ ”)
    wrapRule(/^["“”]\s$/, n.blockquote),
    // 分割线:整段只有 --- / *** / ___ 时立即转换
    new InputRule(/^(?:---|\*\*\*|___)$/, (state, _match, start, end) => {
      const $start = state.doc.resolve(start)
      if ($start.parent.type !== n.paragraph || end - start !== $start.parent.content.size) return null
      const blockStart = $start.before()
      const tr = state.tr.replaceWith(blockStart, blockStart + $start.parent.nodeSize, [
        n.horizontal_rule.create(),
        n.paragraph.create(),
      ])
      tr.setSelection(TextSelection.create(tr.doc, blockStart + 2))
      return tr
    }),
    blockTypeRule(/^(?:```|~~~)([\w+#.-]*)\s$/, n.code_block, (match) => ({ language: match[1] ?? '' })),
    blockTypeRule(/^\$\$\s$/, n.math_block, () => null),
  ]
}

/**
 * 成对行内标记:敲下收尾定界符时,把中间文字加上格式并删掉定界符。
 * `before` 排除前一个字符,避免 `**粗体*` 的中间状态被当成斜体。
 */
function markRule(open: string, close: string, type: MarkType, notBefore: string): InputRule {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const c = esc(close.charAt(0))
  const inner = `[^${c}\\s](?:[^${c}]*[^${c}\\s])?`
  const re = new RegExp(`(?:^|[^${notBefore}])(${esc(open)}(${inner})${esc(close)})$`)
  return new InputRule(re, (state, match, _start, end) => {
    const whole = match[1]
    const text = match[2]
    const from = end - whole.length + 1 // end 指向收尾定界符最后一个字符之前,收尾字符尚未插入
    const textStart = from + open.length
    const textEnd = textStart + text.length
    const $from = state.doc.resolve(from)
    if ($from.parent.type.spec.code) return null
    const tr = state.tr
    tr.delete(textEnd, end) // 已输入的收尾定界符(不含正在输入的最后一个字符)
    tr.delete(from, textStart)
    tr.addMark(from, from + text.length, type.create())
    tr.removeStoredMark(type)
    return tr
  })
}

/** 自动配对已在光标后放了一个 ),敲收尾 ) 完成链接时把它一起替换掉。 */
function pairedCloser(state: EditorState, pos: number): number {
  return pos < state.doc.content.size && state.doc.textBetween(pos, pos + 1) === ')' ? 1 : 0
}

function inlineRules(options: InputRuleOptions): InputRule[] {
  const rules: InputRule[] = [
    // 图片要排在链接之前,否则 `[alt](src)` 先被当成链接
    new InputRule(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/, (state, match, start, end) => {
      const [, alt, src, title] = match
      return state.tr.replaceWith(start, end + pairedCloser(state, end), n.image.create({ src, alt, title: title ?? null }))
    }),
    new InputRule(/(?:^|[^!])\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/, (state, match, start, end) => {
      const [whole, text, href, title] = match
      const from = start + (whole.startsWith('[') ? 0 : 1)
      return state.tr.replaceWith(from, end + pairedCloser(state, end), schema.text(text, [m.link.create({ href, title: title ?? null })]))
    }),
    markRule('**', '**', m.strong, '*'),
    // 下划线不在单词内部生效(snake_case_name 不该变斜体),与 CommonMark 一致
    markRule('__', '__', m.strong, '\\w_'),
    markRule('*', '*', m.em, '*'),
    markRule('_', '_', m.em, '\\w_'),
    markRule('~~', '~~', m.strike, '~'),
    markRule('~', '~', m.strike, '~'), // Notion:单波浪线是删除线
    markRule('==', '==', m.highlight, '='),
    markRule('`', '`', m.code, '`'),
    // Notion 行内公式 $$x$$(同一行内闭合),存成 $x$;只敲单个 $ 不转换,避免「5 $ 和 10 $」误转
    new InputRule(/(?:^|[^$])\$\$([^$\s](?:[^$]*[^$\s])?)\$\$$/, (state, match, _start, end) => {
      const tex = match[1]
      const from = end - tex.length - 3
      return state.tr.replaceWith(from, end, n.math_inline.create({ tex }))
    }),
    // 敲完 <网址> 的 > 即成链接,保存仍写 <网址>(notion-input.md 2.2 第 10 行)
    new InputRule(/<(https?:\/\/[^\s<>]+)>$/, (state, match, start, end) => {
      const url = match[1]
      if (state.doc.resolve(start).parent.type.spec.code) return null
      return state.tr.replaceWith(start, end, schema.text(url, [m.link.create({ href: url })]))
    }),
    // 敲完网址再敲空格,自动变成链接(Notion)
    new InputRule(/(?:^|\s)(https?:\/\/[^\s]+[^\s.,;:!?'")\]])\s$/, (state, match, _start, end) => {
      const url = match[1]
      const from = end - url.length
      if (state.doc.rangeHasMark(from, end, m.link)) return null
      return state.tr.addMark(from, end, m.link.create({ href: url, autolink: true })).insertText(' ', end)
    }),
    // 敲完邮箱再敲空格:变成邮箱链接。GFM 里裸邮箱本来就是链接,不转的话存盘时只能写成 me\@example.com
    new InputRule(/(?:^|\s)([\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,})\s$/, (state, match, _start, end) => {
      const email = match[1]
      const from = end - email.length
      if (state.doc.rangeHasMark(from, end, m.link)) return null
      return state.tr.addMark(from, end, m.link.create({ href: `mailto:${email}`, autolink: true })).insertText(' ', end)
    }),
  ]
  if (options.smartPunctuation) {
    // `--` 要等空格再转换,否则敲 `---` 分割线时会先变成破折号
    rules.push(new InputRule(/->$/, '→'), new InputRule(/<-$/, '←'), new InputRule(/--\s$/, '— '))
  }
  return rules
}

export function buildInputRules(options: InputRuleOptions) {
  return inputRules({ rules: [...blockRules(), ...inlineRules(options)] })
}
