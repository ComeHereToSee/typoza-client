// ProseMirror 文档 → Markdown 文本。
// 未编辑的顶层块直接写回原文(见 parse.ts 的 blockSources);只有被编辑过的块才经 mdast 重新生成。
import type {
  BlockContent,
  Break,
  DefinitionContent,
  Blockquote,
  Emphasis,
  Link,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  TableCell,
  TableRow,
} from 'mdast'
import { frontmatterToMarkdown } from 'mdast-util-frontmatter'
import { gfmToMarkdown } from 'mdast-util-gfm'
import { mathToMarkdown } from 'mdast-util-math'
import { defaultHandlers, type Handle, type Options, toMarkdown } from 'mdast-util-to-markdown'
import { normalizeIdentifier } from 'micromark-util-normalize-identifier'
import { DOMSerializer, type Mark, type Node as PMNode } from 'prosemirror-model'
import { schema } from '../schema'
import { escapeAttr, escapeHtml } from './html'
import type { TzCallout, TzHtmlImage, TzInlineMark, TzMedia, TzToggle, TzWikiLink } from './mdast-types'
import { type BlockSource, blockSources, type DocMeta } from './parse'
import { typoraInlineToMarkdown } from './syntax'

export interface SerializeOptions {
  inlineMath: boolean
  /** 文末保证有换行(Typora 偏好「保存时在文末添加空行」) */
  ensureTrailingNewline: boolean
}

export function serializeMarkdown(doc: PMNode, meta: DocMeta, options: SerializeOptions): string {
  const md = markdownOptions(meta, options)
  const parts: string[] = []
  let prev: { node: PMNode; src: BlockSource | undefined } | null = null
  let firstSourcedAtZero = false

  doc.forEach((node, _offset, index) => {
    const src = blockSources.get(node)
    if (index === 0) firstSourcedAtZero = src?.index === 0
    // 文首的分割线写成 ***:写 --- 会被当成 YAML front matter 的开头
    const text = src ? src.text : index === 0 && node.type === schema.nodes.horizontal_rule ? '***' : serializeBlock(node, md)
    if (prev) {
      let gap = '\n\n'
      if (src && prev.src && src.index === prev.src.index + 1) gap = src.gapBefore
      // 两个同类列表相邻会在重新解析时合成一个列表,中间插一个空注释隔开
      else if (sameListKind(prev.node, node)) gap = '\n\n<!-- -->\n\n'
      parts.push(gap)
    }
    parts.push(text)
    prev = { node, src }
  })

  let out = (firstSourcedAtZero ? meta.leading : '') + parts.join('') + meta.trailing
  if (options.ensureTrailingNewline && !out.endsWith('\n')) out += '\n'
  if (meta.lineEnding === '\r\n') out = out.replace(/\n/g, '\r\n')
  return (meta.bom ? '\uFEFF' : '') + out
}

function sameListKind(a: PMNode, b: PMNode): boolean {
  const lists = [schema.nodes.bullet_list, schema.nodes.ordered_list]
  return a.type === b.type && lists.includes(a.type)
}

/** 单个块序列化(不带结尾换行)。也用于「复制为 Markdown」。 */
export function serializeBlock(node: PMNode, md: Options): string {
  const root: Root = { type: 'root', children: [blockToMdast(node)] }
  return toMarkdown(root, md).replace(/\n+$/, '')
}

/** 任意片段(若干块)序列化,用于复制为 Markdown。 */
export function serializeBlocks(nodes: PMNode[], meta: DocMeta, options: SerializeOptions): string {
  const md = markdownOptions(meta, options)
  const root: Root = { type: 'root', children: nodes.map(blockToMdast) }
  return toMarkdown(root, md)
}

export function markdownOptions(meta: DocMeta, options: SerializeOptions): Options {
  return {
    bullet: meta.bullet,
    bulletOther: meta.bullet === '-' ? '*' : '-',
    emphasis: '*',
    strong: '*',
    fence: '`',
    fences: true,
    rule: '-',
    listItemIndent: 'one',
    incrementListMarker: true,
    resourceLink: false,
    handlers: handlers as Options['handlers'],
    extensions: [
      gfmToMarkdown(),
      mathToMarkdown({ singleDollarTextMath: options.inlineMath }),
      frontmatterToMarkdown(['yaml']),
      typoraInlineToMarkdown(),
    ],
  }
}

// ---------- 自定义节点处理器 ----------

function quoteLine(line: string, _: number, blank: boolean): string {
  return '>' + (blank ? '' : ' ') + line
}

const handlers: Record<string, Handle> = {
  tzCallout(node: TzCallout, _parent, state, info) {
    const exit = state.enter('blockquote')
    const tracker = state.createTracker(info)
    tracker.move('> ')
    tracker.shift(2)
    const head = `[!${node.kind.toUpperCase()}]${node.title ? ` ${node.title}` : ''}`
    const body = node.children.length ? state.containerFlow(node as unknown as Blockquote, tracker.current()) : ''
    const value = state.indentLines(body ? `${head}\n${body}` : head, quoteLine)
    exit()
    return value
  },

  tzToggle(node: TzToggle, _parent, state, info) {
    const body = node.children.length ? state.containerFlow(node as unknown as Blockquote, info) : ''
    return `<details${node.openInSource ? ' open' : ''}>\n<summary>${node.summaryHtml}</summary>\n\n${body ? `${body}\n\n` : ''}</details>`
  },

  tzMedia(node: TzMedia) {
    return node.html
  },

  tzToc() {
    return '[TOC]'
  },

  tzWikiLink(node: TzWikiLink) {
    return `[[${node.target}${node.alias ? `|${node.alias}` : ''}]]`
  },

  tzInlineMark(node: TzInlineMark, _parent, state, info) {
    let open = `<${node.mark === 'underline' ? 'u' : node.mark}>`
    let close = `</${node.mark === 'underline' ? 'u' : node.mark}>`
    if (node.mark === 'color') {
      const style = [node.color ? `color: ${node.color}` : '', node.background ? `background-color: ${node.background}` : '']
        .filter(Boolean)
        .join('; ')
      open = `<span style="${escapeAttr(style)}">`
      close = '</span>'
    }
    const tracker = state.createTracker(info)
    let value = tracker.move(open)
    value += state.containerPhrasing(node as unknown as Emphasis, { ...tracker.current(), before: value, after: '<' })
    value += tracker.move(close)
    return value
  },

  tzHtmlImage(node: TzHtmlImage) {
    return imageHtml(node)
  },

  tzHtmlBreak() {
    return '<br>'
  },

  break(node: Break, parent, state, info) {
    if (node.data?.tzSpaces) return '  \n'
    return defaultHandlers.break(node, parent, state, info)
  },

  link(node: Link, parent, state, info) {
    // GFM 裸链接(原文就是一个网址)编辑后仍写成裸网址,而不是 <网址>;链接文字被改过就按普通链接写
    const only = node.children.length === 1 ? node.children[0] : null
    if (node.data?.tzAutolink && only?.type === 'text' && only.value === node.url) return node.url
    return defaultHandlers.link(node, parent, state, info)
  },
}

export function imageHtml(img: Omit<TzHtmlImage, 'type'>): string {
  const attrs = [`src="${escapeAttr(img.src)}"`, `alt="${escapeAttr(img.alt)}"`]
  if (img.title) attrs.push(`title="${escapeAttr(img.title)}"`)
  if (img.width) attrs.push(`width="${escapeAttr(img.width)}"`)
  if (img.height) attrs.push(`height="${escapeAttr(img.height)}"`)
  if (img.align) attrs.push(`align="${escapeAttr(img.align)}"`)
  // 与 Typora 缩放图片的写法一致
  if (img.zoom) attrs.push(`style="zoom:${escapeAttr(img.zoom)};"`)
  return `<img ${attrs.join(' ')} />`
}

export function mediaHtml(attrs: { kind: string; src: string; title: string; width: string | null; height: string | null }): string {
  const src = escapeAttr(attrs.src)
  switch (attrs.kind) {
    case 'video':
      return `<video src="${src}" controls></video>`
    case 'audio':
      return `<audio src="${src}" controls></audio>`
    case 'pdf':
      return `<iframe src="${src}" width="${escapeAttr(attrs.width ?? '100%')}" height="${escapeAttr(attrs.height ?? '600')}"></iframe>`
    case 'embed':
      return `<iframe src="${src}" width="${escapeAttr(attrs.width ?? '100%')}" height="${escapeAttr(attrs.height ?? '400')}" frameborder="0" allowfullscreen></iframe>`
    case 'bookmark':
    case 'file':
      return `<a href="${src}" data-tz-type="${attrs.kind}">${escapeHtml(attrs.title || attrs.src)}</a>`
    default:
      throw new Error(`未知媒体类型:${attrs.kind}`)
  }
}

// ---------- ProseMirror → mdast ----------

function identifier(label: string): string {
  return normalizeIdentifier(label).toLowerCase()
}

function blockToMdast(node: PMNode): RootContent {
  const n = schema.nodes
  const t = node.type
  if (t === n.paragraph) return { type: 'paragraph', children: inlineToMdast(node, false) }
  if (t === n.heading) return { type: 'heading', depth: node.attrs.level, children: inlineToMdast(node, false) }
  if (t === n.blockquote) return { type: 'blockquote', children: childBlocks(node) }
  if (t === n.callout) return { type: 'tzCallout', kind: node.attrs.kind, title: node.attrs.title, children: childBlocks(node) }
  if (t === n.toggle) {
    const summary = node.firstChild!
    const rest: PMNode[] = []
    node.forEach((child, _o, i) => {
      if (i > 0) rest.push(child)
    })
    const inner = inlineHtml(summary)
    const level = summary.attrs.level as number
    return {
      type: 'tzToggle',
      openInSource: node.attrs.openInSource,
      summaryHtml: level ? `<h${level}>${inner}</h${level}>` : inner,
      children: rest.map(blockToMdast) as BlockContent[],
    }
  }
  if (t === n.bullet_list || t === n.ordered_list) {
    const spread = !node.attrs.tight
    const items: ListItem[] = []
    node.forEach((item) => {
      items.push({ type: 'listItem', spread, checked: item.attrs.checked, children: childBlocks(item) })
    })
    return t === n.ordered_list
      ? { type: 'list', ordered: true, start: node.attrs.start, spread, children: items }
      : { type: 'list', ordered: false, spread, children: items }
  }
  if (t === n.code_block) return { type: 'code', lang: node.attrs.language || null, meta: node.attrs.meta, value: node.textContent }
  if (t === n.math_block) return { type: 'math', value: node.textContent }
  if (t === n.table) return tableToMdast(node)
  if (t === n.horizontal_rule) return { type: 'thematicBreak' }
  if (t === n.html_block) return { type: 'html', value: node.textContent }
  if (t === n.media) {
    const a = node.attrs
    return {
      type: 'tzMedia',
      kind: a.kind,
      src: a.src,
      title: a.title,
      width: a.width,
      height: a.height,
      html: a.html ?? mediaHtml(a as Parameters<typeof mediaHtml>[0]),
    }
  }
  if (t === n.toc) return { type: 'tzToc' }
  if (t === n.footnote_def) {
    return { type: 'footnoteDefinition', identifier: identifier(node.attrs.label), label: node.attrs.label, children: childBlocks(node) as (BlockContent | DefinitionContent)[] }
  }
  if (t === n.definition) {
    return { type: 'definition', identifier: identifier(node.attrs.label), label: node.attrs.label, url: node.attrs.url, title: node.attrs.title }
  }
  if (t === n.frontmatter) return { type: 'yaml', value: node.textContent }
  throw new Error(`无法序列化的块类型:${t.name}`)
}

function childBlocks(node: PMNode): BlockContent[] {
  const out: BlockContent[] = []
  node.forEach((child) => out.push(blockToMdast(child) as BlockContent))
  return out
}

function tableToMdast(node: PMNode): RootContent {
  const rows: TableRow[] = []
  const align: ('left' | 'right' | 'center' | null)[] = []
  node.forEach((row, _o, r) => {
    const cells: TableCell[] = []
    row.forEach((cell) => {
      if (r === 0) align.push(cell.attrs.align ?? null)
      cells.push({ type: 'tableCell', children: inlineToMdast(cell, true) })
    })
    rows.push({ type: 'tableRow', children: cells })
  })
  return { type: 'table', align, children: rows }
}

/** 折叠块标题渲染成 HTML(<summary> 里不解析 Markdown)。 */
function inlineHtml(node: PMNode): string {
  const div = document.createElement('div')
  div.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(node.content))
  return div.innerHTML
}

type Container = { mark: Mark; children: PhrasingContent[] }

/**
 * 扁平的「文本 + 标记」序列转成 mdast 的嵌套结构。
 * 新开标记时按「往后连续覆盖的长度」从长到短嵌套,让跨度长的标记在外层,减少同一标记被拆成多段。
 */
function inlineToMdast(parent: PMNode, inTable: boolean): PhrasingContent[] {
  const children: PMNode[] = []
  parent.forEach((c) => children.push(c))
  const code = schema.marks.code
  const containerMarks = (c: PMNode) => c.marks.filter((m) => m.type !== code)

  const root: PhrasingContent[] = []
  const stack: Container[] = []
  const top = () => (stack.length ? stack[stack.length - 1].children : root)

  children.forEach((child, i) => {
    const marks = containerMarks(child)
    let keep = 0
    while (keep < stack.length && marks.some((m) => m.eq(stack[keep].mark))) keep++
    stack.length = keep
    const opening = marks.filter((m) => !stack.some((s) => s.mark.eq(m)))
    const runLength = (m: Mark) => {
      let k = i
      while (k < children.length && containerMarks(children[k]).some((x) => x.eq(m))) k++
      return k - i
    }
    opening.sort((a, b) => runLength(b) - runLength(a))
    for (const mark of opening) {
      const container = markToMdast(mark)
      top().push(container)
      stack.push({ mark, children: (container as { children: PhrasingContent[] }).children })
    }
    top().push(...leafToMdast(child, inTable))
  })
  return root
}

function markToMdast(mark: Mark): PhrasingContent {
  const m = schema.marks
  const t = mark.type
  if (t === m.link) {
    if (mark.attrs.ref) {
      return {
        type: 'linkReference',
        identifier: identifier(mark.attrs.ref),
        label: mark.attrs.ref,
        referenceType: mark.attrs.refType ?? 'full',
        children: [],
      }
    }
    const link: Link = { type: 'link', url: mark.attrs.href, title: mark.attrs.title, children: [] }
    if (mark.attrs.autolink) link.data = { tzAutolink: true }
    return link
  }
  if (t === m.strong) return { type: 'strong', children: [] }
  if (t === m.em) return { type: 'emphasis', children: [] }
  if (t === m.strike) return { type: 'delete', children: [] }
  if (t === m.highlight) return { type: 'mark', children: [] }
  if (t === m.sup) {
    return mark.attrs.syntax === 'typora'
      ? { type: 'superscript', children: [] }
      : { type: 'tzInlineMark', mark: 'sup', color: null, background: null, children: [] }
  }
  if (t === m.sub) {
    return mark.attrs.syntax === 'typora'
      ? { type: 'subscript', children: [] }
      : { type: 'tzInlineMark', mark: 'sub', color: null, background: null, children: [] }
  }
  if (t === m.underline) return { type: 'tzInlineMark', mark: 'underline', color: null, background: null, children: [] }
  if (t === m.color) {
    return { type: 'tzInlineMark', mark: 'color', color: mark.attrs.color, background: mark.attrs.background, children: [] }
  }
  throw new Error(`无法序列化的行内标记:${t.name}`)
}

function leafToMdast(node: PMNode, inTable: boolean): PhrasingContent[] {
  const n = schema.nodes
  const t = node.type
  if (node.isText) {
    const value = node.text ?? ''
    return [node.marks.some((m) => m.type === schema.marks.code) ? { type: 'inlineCode', value } : { type: 'text', value }]
  }
  if (t === n.hard_break) {
    if (inTable || node.attrs.syntax === 'html') return [{ type: 'tzHtmlBreak' }]
    if (node.attrs.syntax === 'spaces') return [{ type: 'break', data: { tzSpaces: true } }]
    return [{ type: 'break' }]
  }
  if (t === n.image) {
    const a = node.attrs
    if (a.html || a.width || a.height || a.zoom || a.align) {
      return [{ type: 'tzHtmlImage', src: a.src, alt: a.alt, title: a.title, width: a.width, height: a.height, zoom: a.zoom, align: a.align }]
    }
    if (a.ref) {
      return [{ type: 'imageReference', identifier: identifier(a.ref), label: a.ref, referenceType: a.refType ?? 'full', alt: a.alt }]
    }
    return [{ type: 'image', url: a.src, alt: a.alt, title: a.title }]
  }
  if (t === n.math_inline) return [{ type: 'inlineMath', value: node.attrs.tex }]
  if (t === n.footnote_ref) return [{ type: 'footnoteReference', identifier: identifier(node.attrs.label), label: node.attrs.label }]
  if (t === n.html_inline) return [{ type: 'html', value: node.attrs.html }]
  if (t === n.wikilink) return [{ type: 'tzWikiLink', target: node.attrs.target, alias: node.attrs.alias }]
  throw new Error(`无法序列化的行内节点:${t.name}`)
}

