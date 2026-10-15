// Markdown 文本 → ProseMirror 文档。
// 顶层块记录原文切片(blockSources):ProseMirror 节点不可变,未被编辑的块在事务后仍是同一个对象,
// 保存时直接写回原文,避免「打开再保存」把用户的写法(缩进、标记符号、空行)改掉。
import type { Blockquote, Heading, List, ListItem, Nodes, Paragraph, PhrasingContent, Root, RootContent, Table } from 'mdast'
import { DOMParser as PMDOMParser, type Mark, type Node as PMNode } from 'prosemirror-model'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import { type Processor, unified } from 'unified'
import { schema } from '../schema'
import type { TzToggle } from './mdast-types'
import { type TyporaSyntaxFlags, typoraInlineFromMarkdown, typoraInlineSyntax } from './syntax'
import { transformTree } from './transform'

/** 解析选项,对应 Typora 偏好设置「Markdown」页。可选项不传时取括号里的默认值。 */
export interface ParseOptions {
  /** 是否识别 `$…$` 行内公式(对应 Typora 偏好设置「内联公式」) */
  inlineMath: boolean
  /** 识别 `~下标~`(PM-08,默认关:单波浪线在 GFM 里常被当删除线) */
  subscript?: boolean
  /** 识别 `^上标^`(PM-09,默认关) */
  superscript?: boolean
  /** 识别 `==高亮==`(PM-10,默认开) */
  highlight?: boolean
  /** 识别 GitHub 警报框 `> [!NOTE]`(PM-11,默认开);关闭时按普通引用显示 */
  alerts?: boolean
  /** 自动识别正文里的裸网址(PM-05,默认开);关闭时按普通文字显示 */
  autolink?: boolean
  /** 严格模式(PM-01,默认开);关闭时 `#标题`(# 后没有空格)也算标题 */
  strict?: boolean
}

export interface DocMeta {
  lineEnding: '\n' | '\r\n'
  bom: boolean
  /** 第一个块之前的原文(通常为空) */
  leading: string
  /** 最后一个块之后的原文(通常是一个换行) */
  trailing: string
  /** 原文最常用的无序列表符号,重写列表时沿用;原文没有无序列表时为 null(改用偏好设置的符号) */
  bullet: '-' | '*' | '+' | null
}

export interface BlockSource {
  text: string
  index: number
  gapBefore: string
}

export const blockSources = new WeakMap<PMNode, BlockSource>()

export interface ParsedDoc {
  doc: PMNode
  meta: DocMeta
}

const processors = new Map<string, Processor<Root>>()

function processorFor(inlineMath: boolean, flags: TyporaSyntaxFlags): Processor<Root> {
  const key = [inlineMath, flags.highlight, flags.superscript, flags.subscript].join('|')
  let p = processors.get(key)
  if (!p) {
    const typoraPlugin = function (this: Processor) {
      const data = this.data()
      ;(data.micromarkExtensions ??= []).push(typoraInlineSyntax(flags))
      ;(data.fromMarkdownExtensions ??= []).push(typoraInlineFromMarkdown())
    }
    p = unified()
      .use(remarkParse)
      .use(remarkGfm, { singleTilde: false })
      .use(remarkMath, { singleDollarTextMath: inlineMath })
      .use(remarkFrontmatter, ['yaml'])
      .use(typoraPlugin) as unknown as Processor<Root>
    processors.set(key, p)
  }
  return p
}

export function parseMarkdown(markdown: string, options: ParseOptions): ParsedDoc {
  const bom = markdown.startsWith('\uFEFF')
  let text = bom ? markdown.slice(1) : markdown
  const lineEnding: DocMeta['lineEnding'] = text.includes('\r\n') ? '\r\n' : '\n'
  text = text.replace(/\r\n?/g, '\n')

  const flags: TyporaSyntaxFlags = {
    highlight: options.highlight ?? true,
    superscript: options.superscript ?? false,
    subscript: options.subscript ?? false,
  }
  const tree = processorFor(options.inlineMath, flags).parse(text) as Root
  const hiddenAlerts: Blockquote[] = []
  if (options.alerts === false) hideAlerts(tree, hiddenAlerts)
  transformTree(tree, text)
  for (const bq of hiddenAlerts) {
    // 还原成普通引用,并补做被跳过的内部处理(媒体、折叠块、行内 HTML 配对……)
    ;(bq as { type: string }).type = 'blockquote'
    transformTree({ type: 'root', children: bq.children } as unknown as Root, text)
  }
  if (options.strict === false) relaxHeadings(tree, text)

  const conv = new ToProseMirror(text, options.autolink ?? true)
  conv.collectDefinitions(tree)

  const blocks: PMNode[] = []
  let prevEnd = 0
  let leading = ''
  tree.children.forEach((child, index) => {
    const start = child.position?.start.offset
    const end = child.position?.end.offset
    const gap = start !== undefined ? text.slice(prevEnd, start) : '\n\n'
    if (index === 0) leading = gap
    const nodes = conv.block(child)
    if (nodes.length === 1 && start !== undefined && end !== undefined) {
      blockSources.set(nodes[0], { text: text.slice(start, end), index, gapBefore: index === 0 ? '' : gap })
    }
    if (end !== undefined) prevEnd = end
    blocks.push(...nodes)
  })
  const trailing = text.slice(prevEnd)

  if (blocks.length === 0 || blocks[blocks.length - 1].type === schema.nodes.frontmatter) {
    blocks.push(schema.nodes.paragraph.create())
  }
  const doc = schema.nodes.doc.createAndFill(null, blocks)
  if (!doc) throw new Error('Markdown 解析结果不符合文档结构(frontmatter 只能位于文首)')

  return { doc, meta: { lineEnding, bom, leading, trailing, bullet: detectBullet(text) } }
}

function detectBullet(text: string): DocMeta['bullet'] {
  const counts = { '-': 0, '*': 0, '+': 0 }
  for (const m of text.matchAll(/^[ \t]*([-*+])[ \t]+\S/gm)) counts[m[1] as keyof typeof counts]++
  if (counts['-'] + counts['*'] + counts['+'] === 0) return null
  if (counts['*'] > counts['-'] && counts['*'] >= counts['+']) return '*'
  if (counts['+'] > counts['-'] && counts['+'] > counts['*']) return '+'
  return '-'
}

const ALERT_START = /^\[![A-Za-z]+\]/

/**
 * 关闭「GitHub 风格警报框」时:先把形如 `> [!NOTE]` 的引用改个类型藏起来,transform 就不会把它们变成提示块;
 * 处理完由调用方还原成普通引用。按先父后子的顺序收集,还原时父级先处理。
 */
function hideAlerts(node: Nodes, hidden: Blockquote[]): void {
  if (!('children' in node)) return
  for (const child of node.children as Nodes[]) {
    if (child.type === 'blockquote') {
      const first = child.children[0]
      const text = first?.type === 'paragraph' ? first.children[0] : undefined
      if (text?.type === 'text' && ALERT_START.test(text.value)) {
        hidden.push(child)
        ;(child as { type: string }).type = 'tzHiddenAlert'
      }
    }
    hideAlerts(child, hidden)
  }
}

const RELAXED_HEADING = /^(#{1,6})(?=[^#\s])/

/** 非严格模式(Typora PM-01 关闭):单行段落以 `#标题`(# 后不带空格)开头时当作标题。 */
function relaxHeadings(node: Nodes, source: string): void {
  if (!('children' in node)) return
  const children = node.children as Nodes[]
  children.forEach((child, i) => {
    if (child.type === 'paragraph') {
      const heading = relaxedHeading(child, source)
      if (heading) children[i] = heading
      return
    }
    relaxHeadings(child, source)
  })
}

function relaxedHeading(p: Paragraph, source: string): Heading | null {
  const first = p.children[0]
  if (first?.type !== 'text') return null
  const start = p.position?.start.offset
  const end = p.position?.end.offset
  if (start === undefined || end === undefined || source.slice(start, end).includes('\n')) return null
  const m = RELAXED_HEADING.exec(first.value)
  if (!m) return null
  const rest = first.value.slice(m[1].length)
  return { type: 'heading', depth: m[1].length as Heading['depth'], children: [{ ...first, value: rest }, ...p.children.slice(1)], position: p.position }
}

interface Definition {
  url: string
  title: string | null
}

class ToProseMirror {
  private readonly defs = new Map<string, Definition>()

  constructor(
    private readonly source: string,
    /** 识别裸网址(PM-05);关闭时 GFM 识别出的裸网址按原文文字处理 */
    private readonly autolink: boolean,
  ) {}

  collectDefinitions(root: Root): void {
    const walk = (node: Nodes) => {
      if (node.type === 'definition') this.defs.set(node.identifier, { url: node.url, title: node.title ?? null })
      if ('children' in node) for (const c of node.children) walk(c as Nodes)
    }
    walk(root)
  }

  private slice(node: Nodes): string {
    const s = node.position?.start.offset
    const e = node.position?.end.offset
    return s === undefined || e === undefined ? '' : this.source.slice(s, e)
  }

  private text(value: string, marks: readonly Mark[] = []): PMNode[] {
    return value ? [schema.text(value, marks)] : []
  }

  private blocksNonEmpty(nodes: RootContent[]): PMNode[] {
    const out = this.blocks(nodes)
    return out.length ? out : [schema.nodes.paragraph.create()]
  }

  blocks(nodes: RootContent[]): PMNode[] {
    return nodes.flatMap((n) => this.block(n))
  }

  block(node: RootContent): PMNode[] {
    const n = schema.nodes
    switch (node.type) {
      case 'paragraph':
        return [n.paragraph.create(null, this.inlines(node.children, []))]
      case 'heading':
        return [n.heading.create({ level: node.depth }, this.inlines(node.children, []))]
      case 'thematicBreak':
        return [n.horizontal_rule.create()]
      case 'blockquote':
        return [n.blockquote.create(null, this.blocksNonEmpty(node.children))]
      case 'tzCallout':
        return [n.callout.create({ kind: node.kind, title: node.title }, this.blocksNonEmpty(node.children))]
      case 'tzToggle':
        return [this.toggle(node)]
      case 'list':
        return [this.list(node)]
      case 'code':
        return [n.code_block.create({ language: node.lang ?? '', meta: node.meta ?? null }, this.text(node.value))]
      case 'math':
        return [n.math_block.create(null, this.text(node.value))]
      case 'html':
        return [n.html_block.create(null, this.text(node.value))]
      case 'table':
        return [this.table(node)]
      case 'yaml':
        return [n.frontmatter.create(null, this.text(node.value))]
      case 'definition':
        return [n.definition.create({ label: node.label ?? node.identifier, url: node.url, title: node.title ?? null })]
      case 'footnoteDefinition':
        return [n.footnote_def.create({ label: node.label ?? node.identifier }, this.blocksNonEmpty(node.children))]
      case 'tzMedia':
        return [
          n.media.create({ kind: node.kind, src: node.src, title: node.title, width: node.width, height: node.height, html: node.html }),
        ]
      case 'tzToc':
        return [n.toc.create()]
      default: {
        // 不认识的结构:原文保留为 HTML 块,保证不丢
        const raw = this.slice(node)
        return raw ? [n.html_block.create(null, this.text(raw))] : []
      }
    }
  }

  private toggle(node: TzToggle): PMNode {
    const n = schema.nodes
    // <summary><h2>标题</h2></summary> 是折叠标题
    const heading = /^<h([1-6])>([\s\S]*)<\/h\1>$/i.exec(node.summaryHtml.trim())
    const container = document.createElement('div')
    container.innerHTML = heading ? heading[2] : node.summaryHtml
    const level = heading ? Number(heading[1]) : 0
    const summary = PMDOMParser.fromSchema(schema).parse(container, { topNode: n.toggle_summary.create({ level }) })
    return n.toggle.create({ open: true, openInSource: node.openInSource }, [summary, ...this.blocks(node.children)])
  }

  private list(node: List): PMNode {
    const n = schema.nodes
    const tight = !node.spread && !node.children.some((item) => item.spread)
    const items = node.children.map((item) => this.listItem(item))
    return node.ordered
      ? n.ordered_list.create({ start: node.start ?? 1, tight }, items)
      : n.bullet_list.create({ tight }, items)
  }

  private listItem(item: ListItem): PMNode {
    const n = schema.nodes
    const content = this.blocks(item.children)
    if (content.length === 0) content.push(n.paragraph.create())
    return n.list_item.create({ checked: item.checked ?? null }, content)
  }

  private table(node: Table): PMNode {
    const n = schema.nodes
    const align = node.align ?? []
    const width = Math.max(1, ...node.children.map((r) => r.children.length))
    const rows = node.children.map((row, r) => {
      const cellType = r === 0 ? n.table_header : n.table_cell
      const cells = []
      for (let c = 0; c < width; c++) {
        const cell = row.children[c]
        cells.push(cellType.create({ align: align[c] ?? null }, cell ? this.inlines(cell.children, []) : []))
      }
      return n.table_row.create(null, cells)
    })
    return n.table.create(null, rows)
  }

  inlines(nodes: PhrasingContent[], marks: readonly Mark[]): PMNode[] {
    const s = schema
    const out: PMNode[] = []
    const add = (mark: Mark) => mark.addToSet(marks)
    for (const node of nodes) {
      switch (node.type) {
        case 'text':
          out.push(...this.text(node.value, marks))
          break
        case 'strong':
          out.push(...this.inlines(node.children, add(s.marks.strong.create())))
          break
        case 'emphasis':
          out.push(...this.inlines(node.children, add(s.marks.em.create())))
          break
        case 'delete':
          out.push(...this.inlines(node.children, add(s.marks.strike.create())))
          break
        case 'mark':
          out.push(...this.inlines(node.children, add(s.marks.highlight.create())))
          break
        case 'superscript':
          out.push(...this.inlines(node.children, add(s.marks.sup.create({ syntax: 'typora' }))))
          break
        case 'subscript':
          out.push(...this.inlines(node.children, add(s.marks.sub.create({ syntax: 'typora' }))))
          break
        case 'tzInlineMark': {
          const mark =
            node.mark === 'underline'
              ? s.marks.underline.create()
              : node.mark === 'sup'
                ? s.marks.sup.create({ syntax: 'html' })
                : node.mark === 'sub'
                  ? s.marks.sub.create({ syntax: 'html' })
                  : s.marks.color.create({ color: node.color, background: node.background })
          out.push(...this.inlines(node.children, add(mark)))
          break
        }
        case 'inlineCode':
          out.push(...this.text(node.value, add(s.marks.code.create())))
          break
        case 'link': {
          const raw = this.slice(node)
          const autolink = raw !== '' && !raw.startsWith('[') && !raw.startsWith('<')
          if (autolink && !this.autolink) {
            out.push(...this.text(raw, marks))
            break
          }
          const mark = s.marks.link.create({ href: node.url, title: node.title ?? null, autolink })
          out.push(...this.inlines(node.children, add(mark)))
          break
        }
        case 'linkReference': {
          const def = this.defs.get(node.identifier)
          const mark = s.marks.link.create({
            href: def?.url ?? '',
            title: def?.title ?? null,
            ref: node.label ?? node.identifier,
            refType: node.referenceType,
          })
          out.push(...this.inlines(node.children, add(mark)))
          break
        }
        case 'image':
          out.push(s.nodes.image.create({ src: node.url, alt: node.alt ?? '', title: node.title ?? null }, null, marks))
          break
        case 'imageReference': {
          const def = this.defs.get(node.identifier)
          out.push(
            s.nodes.image.create(
              { src: def?.url ?? '', alt: node.alt ?? '', title: def?.title ?? null, ref: node.label ?? node.identifier, refType: node.referenceType },
              null,
              marks,
            ),
          )
          break
        }
        case 'tzHtmlImage':
          out.push(
            s.nodes.image.create(
              {
                src: node.src,
                alt: node.alt,
                title: node.title,
                width: node.width,
                height: node.height,
                zoom: node.zoom,
                align: node.align,
                html: true,
              },
              null,
              marks,
            ),
          )
          break
        case 'break':
          out.push(s.nodes.hard_break.create({ syntax: this.slice(node).startsWith('\\') ? 'backslash' : 'spaces' }, null, marks))
          break
        case 'tzHtmlBreak':
          out.push(s.nodes.hard_break.create({ syntax: 'html' }, null, marks))
          break
        case 'html':
          out.push(s.nodes.html_inline.create({ html: node.value }, null, marks))
          break
        case 'inlineMath':
          out.push(s.nodes.math_inline.create({ tex: node.value }, null, marks))
          break
        case 'footnoteReference':
          out.push(s.nodes.footnote_ref.create({ label: node.label ?? node.identifier }, null, marks))
          break
        case 'tzWikiLink':
          out.push(s.nodes.wikilink.create({ target: node.target, alias: node.alias }, null, marks))
          break
        default: {
          const other = node as Nodes
          if ('children' in other) out.push(...this.inlines(other.children as PhrasingContent[], marks))
          else if ('value' in other && typeof other.value === 'string') out.push(...this.text(other.value, marks))
        }
      }
    }
    return out
  }
}
