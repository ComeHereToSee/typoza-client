// 一个窗口里正在编辑的文档:路径、原文格式信息(换行符、编码、BOM)、保存状态。
import type { Node as PMNode } from 'prosemirror-model'
import YAML from 'yaml'
import { type DocMeta, parseMarkdown } from '../core/markdown/parse'
import { serializeMarkdown } from '../core/markdown/serialize'
import { dirname, joinPath, normalizePath } from '../core/paths'
import { schema } from '../core/schema'
import type { Host } from '../host/types'
import type { AppSettings } from './settings'

export interface FrontMatterInfo {
  title?: string
  icon?: string
  cover?: string
  rootUrl: string | null
  copyImagesTo: string | null
}

export class DocumentSession {
  path: string | null = null
  meta: DocMeta = { lineEnding: '\n', bom: false, leading: '', trailing: '\n', bullet: '-' }
  encoding = 'utf-8'
  savedMtime = 0
  dirty = false
  /** 最近一次写盘(或读盘)的文本,用于判断外部修改是否只是我们自己的保存 */
  savedText = ''

  constructor(
    private readonly host: Host,
    private readonly settings: () => AppSettings,
  ) {}

  get title(): string {
    if (!this.path) return '未命名'
    return this.path.slice(this.path.lastIndexOf('/') + 1)
  }

  async load(path: string, encoding?: string): Promise<PMNode> {
    const result = await this.host.readText(path, encoding)
    const parsed = parseMarkdown(result.text, { inlineMath: this.settings().inlineMath })
    this.path = path
    this.meta = parsed.meta
    this.encoding = result.encoding
    this.savedMtime = result.mtime
    this.savedText = result.text
    this.dirty = false
    return parsed.doc
  }

  createEmpty(): PMNode {
    this.path = null
    this.meta = { lineEnding: '\n', bom: false, leading: '', trailing: '\n', bullet: '-' }
    this.encoding = 'utf-8'
    this.savedMtime = 0
    this.savedText = ''
    this.dirty = false
    return schema.nodes.doc.create(null, schema.nodes.paragraph.create())
  }

  serialize(doc: PMNode): string {
    const s = this.settings()
    return serializeMarkdown(doc, this.meta, { inlineMath: s.inlineMath, ensureTrailingNewline: s.ensureTrailingNewline })
  }

  async save(doc: PMNode, path = this.path): Promise<void> {
    if (!path) throw new Error('文档还没有保存位置')
    const text = this.serialize(doc)
    const { mtime } = await this.host.writeText(path, text, this.encoding)
    this.path = path
    this.savedMtime = mtime
    this.savedText = text
    this.dirty = false
  }
}

/** 解析 front matter(图标、封面、Typora 的 root-url 与 copy-images-to)。YAML 写错时按没有处理,不打断编辑。 */
export function frontMatterInfo(doc: PMNode, docPath: string | null): FrontMatterInfo {
  const first = doc.firstChild
  const info: FrontMatterInfo = { rootUrl: null, copyImagesTo: null }
  if (!first || first.type !== schema.nodes.frontmatter) return info
  let data: unknown
  try {
    data = YAML.parse(first.textContent)
  } catch {
    return info
  }
  if (!data || typeof data !== 'object') return info
  const d = data as Record<string, unknown>
  if (typeof d.title === 'string') info.title = d.title
  if (typeof d.icon === 'string') info.icon = d.icon
  if (typeof d.cover === 'string') info.cover = d.cover
  const root = d['typora-root-url']
  if (typeof root === 'string' && root) {
    info.rootUrl = root.startsWith('/') ? normalizePath(root) : docPath ? joinPath(dirname(docPath), root) : null
  }
  const copy = d['typora-copy-images-to']
  if (typeof copy === 'string' && copy) info.copyImagesTo = copy
  return info
}

/** 改 front matter 里的一个键(图标、封面),返回新的 YAML 文本;value 为 null 时删除该键。 */
export function updateFrontMatterText(yamlText: string, key: string, value: string | null): string {
  const doc = YAML.parseDocument(yamlText || '')
  if (value === null) doc.delete(key)
  else doc.set(key, value)
  return String(doc).replace(/\n$/, '')
}
