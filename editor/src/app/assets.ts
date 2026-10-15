// 插入本机文件(图片、视频、附件……)时的落盘规则,与 Typora「插入图片时」一致:
// 拷到 ./assets(默认,可用 ${filename} 占位)/ 当前文件夹 / 自定义文件夹 / 拷贝后上传 / 不处理(用原路径)。
// front matter 的 typora-copy-images-to 优先于偏好设置。
import { basename, dirname, extname, joinPath, normalizePath, relativePath } from '../core/paths'
import type { ImportFile } from '../core/env'
import type { Host } from '../host/types'
import type { AppSettings } from './settings'

export type ImportKind = 'image' | 'video' | 'audio' | 'pdf' | 'file'

const KIND_BY_EXT: Record<string, ImportKind> = {}
for (const e of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'apng', 'avif', 'svg', 'bmp', 'heic', 'tiff', 'ico']) KIND_BY_EXT[e] = 'image'
for (const e of ['mp4', 'm4v', 'mov', 'webm', 'ogv']) KIND_BY_EXT[e] = 'video'
for (const e of ['mp3', 'm4a', 'wav', 'ogg', 'oga', 'flac', 'aac']) KIND_BY_EXT[e] = 'audio'
KIND_BY_EXT.pdf = 'pdf'

export function kindOf(name: string): ImportKind {
  return KIND_BY_EXT[extname(name)] ?? 'file'
}

export interface ImportContext {
  host: Host
  settings: AppSettings
  /** 当前文档路径;未保存的新文档为 null */
  docPath: string | null
  /** front matter 里的 typora-copy-images-to(原文) */
  copyImagesTo: string | null
}

function stem(path: string): string {
  const name = basename(path)
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

/** 目标文件夹(绝对路径)。 */
export function targetFolder(ctx: ImportContext): string | null {
  const { settings, docPath } = ctx
  const draftDir = `${ctx.host.homeDir()}/Library/Application Support/Typoza/assets`
  const docDir = docPath ? dirname(docPath) : null
  const expand = (p: string) => p.replace(/\$\{filename\}/g, docPath ? stem(docPath) : 'untitled')
  if (ctx.copyImagesTo) {
    const p = expand(ctx.copyImagesTo)
    if (p.startsWith('/')) return normalizePath(p)
    return docDir ? joinPath(docDir, p) : draftDir
  }
  switch (settings.imageInsertAction) {
    case 'none':
      return null
    case 'copyToCurrent':
      return docDir ?? draftDir
    case 'copyToCustom':
      return settings.imageCustomFolder ? normalizePath(expand(settings.imageCustomFolder)) : docDir ?? draftDir
    default:
      return docDir ? joinPath(docDir, expand(settings.imageAssetsFolder || './assets')) : draftDir
  }
}

async function uniquePath(host: Host, folder: string, name: string): Promise<string> {
  const safe = name.replace(/[/:]/g, '-')
  const dot = safe.lastIndexOf('.')
  const base = dot > 0 ? safe.slice(0, dot) : safe
  const ext = dot > 0 ? safe.slice(dot) : ''
  let candidate = joinPath(folder, safe)
  for (let i = 1; await host.stat(candidate); i++) candidate = joinPath(folder, `${base}-${i}${ext}`)
  return candidate
}

/** 把文件落盘并返回要写进文档的地址。 */
export async function importFile(ctx: ImportContext, file: ImportFile): Promise<{ src: string; kind: ImportKind; name: string }> {
  const kind = kindOf(file.name)
  const folder = targetFolder(ctx)
  let absolute: string
  if (!folder) {
    if (!file.path) throw new Error('「不处理」模式下无法插入剪贴板里的图片:请在偏好设置里改为拷贝到文件夹')
    absolute = file.path
  } else {
    await ctx.host.mkdir(folder)
    absolute = await uniquePath(ctx.host, folder, file.name)
    if (file.base64 !== undefined) await ctx.host.writeBase64(absolute, file.base64)
    else if (file.path) await ctx.host.copyFile(file.path, absolute)
    else throw new Error(`没有可导入的内容:${file.name}`)
  }
  if (kind === 'image' && ctx.settings.imageInsertAction === 'upload' && ctx.settings.imageUploadCommand) {
    const [url] = await ctx.host.uploadImages(ctx.settings.imageUploadCommand, [absolute])
    return { src: url, kind, name: file.name }
  }
  const docDir = ctx.docPath ? dirname(ctx.docPath) : null
  const src = docDir && ctx.settings.imageUseRelative ? relativePath(docDir, absolute) : absolute
  return { src, kind, name: file.name }
}
