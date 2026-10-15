// 一个窗口里正在编辑的文档:路径、原文格式信息(换行符、编码、BOM)、保存状态。
import type { Node as PMNode } from 'prosemirror-model'
import YAML from 'yaml'
import { bundleOf } from '../core/filetypes'
import { type DocMeta, parseMarkdown } from '../core/markdown/parse'
import { serializeMarkdown } from '../core/markdown/serialize'
import { dirname, joinPath, normalizePath } from '../core/paths'
import { schema } from '../core/schema'
import type { Host, ReadResult } from '../host/types'
import { parseOptionsFrom, serializeOptionsFrom } from './markdown-prefs'
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
  meta: DocMeta = { lineEnding: '\n', bom: false, leading: '', trailing: '\n', bullet: null }
  encoding = 'utf-8'
  savedMtime = 0
  dirty = false
  /** 最近一次写盘(或读盘)的文本,用于判断外部修改是否只是我们自己的保存 */
  savedText = ''
  /** 只读原因(PRD 3.1 异常):permission = 没有写权限,large = 超过大文件阈值、以只读源码打开;null 为可写 */
  readOnly: 'permission' | 'large' | null = null

  constructor(
    private readonly host: Host,
    private readonly settings: () => AppSettings,
  ) {}

  get title(): string {
    if (!this.path) return '未命名'
    // TextBundle 包里的正文以包名作标题
    const shown = bundleOf(this.path) ?? this.path
    return shown.slice(shown.lastIndexOf('/') + 1)
  }

  async load(path: string, encoding?: string): Promise<PMNode> {
    const result = await this.host.readText(path, encoding)
    // 先解析再改状态:解析失败时会话仍指向原文档,不会把旧内容存到新路径
    const parsed = parseMarkdown(result.text, parseOptionsFrom(this.settings()))
    this.adopt(path, result)
    this.meta = parsed.meta
    return parsed.doc
  }

  /** 只读进原文、不解析(超大文件以只读源码打开) */
  async loadText(path: string, encoding?: string): Promise<string> {
    const result = await this.host.readText(path, encoding)
    this.adopt(path, result)
    this.meta = { lineEnding: result.text.includes('\r\n') ? '\r\n' : '\n', bom: false, leading: '', trailing: '\n', bullet: '-' }
    return result.text
  }

  private adopt(path: string, result: ReadResult): void {
    this.path = path
    this.encoding = result.encoding
    this.savedMtime = result.mtime
    this.savedText = result.text
    this.dirty = false
    this.readOnly = null
  }

  createEmpty(): PMNode {
    this.path = null
    // 新文件换行符按偏好(PE-07);无序列表符号跟偏好走(bullet 为 null)
    this.meta = { lineEnding: this.settings().defaultLineEnding === 'crlf' ? '\r\n' : '\n', bom: false, leading: '', trailing: '\n', bullet: null }
    this.encoding = 'utf-8'
    this.savedMtime = 0
    this.savedText = ''
    this.dirty = false
    this.readOnly = null
    return schema.nodes.doc.create(null, schema.nodes.paragraph.create())
  }

  serialize(doc: PMNode): string {
    const s = this.settings()
    return serializeMarkdown(doc, this.meta, serializeOptionsFrom(s))
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
