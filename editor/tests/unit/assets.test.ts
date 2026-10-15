// 插入图片与文件的落盘规则(PRD 3.4 插入与失败;对照表 PI-01 ~ PI-07、X-18),用内存宿主跑。
import { describe, expect, it } from 'vitest'
import { type ImportContext, importFile, importNetworkImage, shouldUpload, targetFolder, verifyUpload } from '../../src/app/assets'
import { type AppSettings, DEFAULT_SETTINGS } from '../../src/app/settings'
import { createMemoryHost, type MemoryHost } from '../../src/host/memory'

const DOC = '/n/笔记.md'

function setup(patch: Partial<AppSettings> = {}, ctxPatch: Partial<ImportContext> = {}) {
  const host = createMemoryHost()
  host.files.set('/src/图 1.png', { kind: 'file', data: new Uint8Array([1, 2, 3]), mtime: 1 })
  host.files.set('/n', { kind: 'dir', mtime: 1 })
  const dismissed: string[] = []
  const ctx: ImportContext = {
    host,
    settings: { ...DEFAULT_SETTINGS, ...patch },
    docPath: DOC,
    copyImagesTo: null,
    dismissWarning: (id) => dismissed.push(id),
    ...ctxPatch,
  }
  return { host, ctx, dismissed }
}

const confirms = (host: MemoryHost) => host.calls.filter((c) => c.method === 'confirm').map((c) => (c.args[0] as { title: string }).title)

describe('目标文件夹', () => {
  it('按「插入图片时」选项', () => {
    const folder = (patch: Partial<AppSettings>, docPath: string | null = DOC) => targetFolder(setup(patch, { docPath }).ctx)
    expect(folder({})).toBe('/n/assets')
    expect(folder({ imageAssetsFolder: './${filename}.assets' })).toBe('/n/笔记.assets')
    expect(folder({ imageInsertAction: 'copyToFilenameAssets' })).toBe('/n/笔记.assets')
    expect(folder({ imageInsertAction: 'copyToCurrent' })).toBe('/n')
    expect(folder({ imageInsertAction: 'copyToCustom', imageCustomFolder: '/pics/${filename}' })).toBe('/pics/笔记')
    expect(folder({ imageInsertAction: 'none' })).toBeNull()
    expect(folder({ imageInsertAction: 'upload' })).toBeNull()
    // 未保存的新文档先放应用数据目录
    expect(folder({}, null)).toBe('/Users/test/Library/Application Support/Typoza/assets')
  })

  it('YAML 的 typora-copy-images-to 优先;值为 upload 时表示上传,不是文件夹名', () => {
    expect(targetFolder(setup({}, { copyImagesTo: './img' }).ctx)).toBe('/n/img')
    expect(shouldUpload(setup({}, { copyImagesTo: 'upload' }).ctx)).toBe(true)
    // 关掉「允许根据 YAML 设置自动上传图片」:按偏好的插入规则处理,也不会建名为 upload 的文件夹
    expect(shouldUpload(setup({ imageUploadByYaml: false }, { copyImagesTo: 'upload' }).ctx)).toBe(false)
    expect(targetFolder(setup({ imageUploadByYaml: false }, { copyImagesTo: 'upload' }).ctx)).toBe('/n/assets')
    expect(shouldUpload(setup({ imageInsertAction: 'upload' }).ctx)).toBe(true)
  })
})

describe('importFile', () => {
  it('复制到 ./assets:目录不存在先询问「该目录不存在,是否立即创建?」,同名自动加序号', async () => {
    const { host, ctx } = setup()
    const first = await importFile(ctx, { name: '图 1.png', path: '/src/图 1.png' })
    expect(first).toEqual({ src: 'assets/图 1.png', kind: 'image', name: '图 1.png' })
    expect(confirms(host)).toEqual(['该目录不存在,是否立即创建?'])
    expect(host.files.has('/n/assets/图 1.png')).toBe(true)
    const second = await importFile(ctx, { name: '图 1.png', path: '/src/图 1.png' })
    expect(second?.src).toBe('assets/图 1-1.png')
    // 目录已存在,不再问
    expect(confirms(host)).toHaveLength(1)
  })

  it('在询问里取消:不复制,返回 null', async () => {
    const { host, ctx } = setup()
    host.confirm = async () => 1
    expect(await importFile(ctx, { name: '图 1.png', path: '/src/图 1.png' })).toBeNull()
    expect(host.files.has('/n/assets')).toBe(false)
  })

  it('相对路径加 ./ 与转义网址', async () => {
    expect((await importFile(setup({ imageRelativeDotSlash: true }).ctx, { name: '图 1.png', path: '/src/图 1.png' }))?.src).toBe('./assets/图 1.png')
    expect((await importFile(setup({ imageEscapeUrl: true }).ctx, { name: '图 1.png', path: '/src/图 1.png' }))?.src).toBe('assets/%E5%9B%BE%201.png')
    expect((await importFile(setup({ imageUseRelative: false }).ctx, { name: '图 1.png', path: '/src/图 1.png' }))?.src).toBe('/n/assets/图 1.png')
  })

  it('关掉「对本地位置的图片应用上述规则」:本机图片直接引用原路径;剪贴板图片照规则落盘', async () => {
    const { host, ctx } = setup({ imageApplyToLocal: false })
    expect((await importFile(ctx, { name: '图 1.png', path: '/src/图 1.png' }))?.src).toBe('../src/图 1.png')
    expect(host.calls.some((c) => c.method === 'copyFile')).toBe(false)
    expect((await importFile(ctx, { name: '粘贴.png', base64: 'AQID' }))?.src).toBe('assets/粘贴.png')
  })

  it('上传:首次上传先确认会调用第三方服务,确认后记下不再问', async () => {
    const { host, ctx, dismissed } = setup({ imageInsertAction: 'upload', imageUploadService: 'custom', imageUploadCommand: 'up' })
    const r = await importFile(ctx, { name: '图 1.png', path: '/src/图 1.png' })
    expect(r?.src).toBe('https://img.example.com/src/图 1.png')
    expect(confirms(host)).toEqual(['上传图片'])
    expect(dismissed).toEqual(['imageUpload'])
    const upload = host.calls.find((c) => c.method === 'uploadImages')
    expect(upload?.args).toEqual([{ service: 'custom', command: 'up' }, ['/src/图 1.png']])

    const again = setup({ imageInsertAction: 'upload', imageUploadCommand: 'up', dismissedWarnings: ['imageUpload'] })
    await importFile(again.ctx, { name: '图 1.png', path: '/src/图 1.png' })
    expect(confirms(again.host)).toEqual([])
  })

  it('上传:自定义命令没填时报错;取消确认时不上传', async () => {
    await expect(importFile(setup({ imageInsertAction: 'upload' }).ctx, { name: '图 1.png', path: '/src/图 1.png' })).rejects.toThrow('还没有设置上传命令')
    const { host, ctx } = setup({ imageInsertAction: 'upload', imageUploadService: 'picgo-app' })
    host.confirm = async () => 1
    expect(await importFile(ctx, { name: '图 1.png', path: '/src/图 1.png' })).toBeNull()
    expect(host.calls.some((c) => c.method === 'uploadImages')).toBe(false)
  })

  it('非图片文件(附件)也按规则复制', async () => {
    const { host, ctx } = setup()
    host.files.set('/src/报告.docx', { kind: 'file', data: 'x', mtime: 1 })
    expect(await importFile(ctx, { name: '报告.docx', path: '/src/报告.docx' })).toEqual({ src: 'assets/报告.docx', kind: 'file', name: '报告.docx' })
  })
})

describe('网络图片与上传验证', () => {
  it('默认保持网址;开了「对网络位置的图片应用上述规则」时下载到资源文件夹', async () => {
    expect(await importNetworkImage(setup().ctx, 'https://e.com/p/a.png')).toBe('https://e.com/p/a.png')
    const { host, ctx } = setup({ imageApplyToNetwork: true })
    expect(await importNetworkImage(ctx, 'https://e.com/p/%E5%9B%BE.png?x=1')).toBe('assets/图.png')
    expect(host.calls.find((c) => c.method === 'downloadFile')?.args).toEqual(['https://e.com/p/%E5%9B%BE.png?x=1', '/n/assets/图.png'])
  })

  it('验证上传选项:上传一张测试图片并返回网址', async () => {
    const { host, ctx } = setup({ imageUploadService: 'upic', dismissedWarnings: ['imageUpload'] })
    const url = await verifyUpload(ctx)
    expect(url).toBe('https://img.example.com/Users/test/Library/Caches/Typoza/upload/typoza-upload-test.png')
    expect(host.files.has('/Users/test/Library/Caches/Typoza/upload/typoza-upload-test.png')).toBe(true)
  })
})
