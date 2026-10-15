// TextBundle 读写(对照表 X-53):包是一个文件夹,正文 text.md,图片放包内 assets/,info.json 记格式版本。
// 打开时把文档路径设成包内 text.md,于是相对路径、插图落盘(./assets)、保存都自然落在包里。
import { TEXTBUNDLE_TEXT } from '../core/filetypes'
import { joinPath } from '../core/paths'
import type { Host } from '../host/types'

/** 包内正文文件的路径 */
export async function textBundleText(host: Host, bundle: string): Promise<string> {
  const entry = (await host.listDir(bundle)).find((e) => !e.isDir && TEXTBUNDLE_TEXT.test(e.name))
  if (!entry) throw new Error(`TextBundle 里没有正文文件 text.md:${bundle}`)
  return entry.path
}

/** 新建(另存为)TextBundle:建 assets 文件夹与 info.json,返回正文路径 */
export async function createTextBundle(host: Host, bundle: string): Promise<string> {
  await host.mkdir(joinPath(bundle, 'assets'))
  const info = { version: 2, type: 'net.daringfireball.markdown', transient: false, creatorIdentifier: 'app.typoza.mac' }
  await host.writeText(joinPath(bundle, 'info.json'), `${JSON.stringify(info, null, 2)}\n`)
  return joinPath(bundle, 'text.md')
}
