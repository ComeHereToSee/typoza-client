// 浏览器开发模式与 E2E 用的示例文件夹(内存宿主)。图片用 SVG 与一张最小 GIF,不依赖外部资源。
import type { MemoryHost } from './host/memory'

export const DEMO_ROOT = '/demo'
export const DEMO_DOC = '/demo/欢迎使用 Typoza.md'

/** 生成一张带文字的 SVG 图(作为「表单截图」之类的示例图片)。 */
export function sampleSvg(label: string, w = 640, h = 360, color = '#337EA9'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="50%" font-size="${Math.round(h / 8)}" fill="#fff" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${label}</text></svg>`
}

/** 1×1 GIF(动图测试用) */
export const TINY_GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

export const DEMO_MARKDOWN = `# 步骤 1 · 建「资助项目」

左栏「对象类型」→ 右上「新建对象类型」,填完点右上「保存并生效」。

![基本信息表单](assets/form.svg)

| 配置项 | 填什么 | 截图 |
| --- | --- | --- |
| 唯一标识符 | \`aid_project\` | ![标识符](assets/id.svg) |
| 显示名称 | 资助项目 | ![名称](assets/name.svg) |
| 动图 | 演示 | ![动图](assets/anim.gif) |

> [!TIP]
> 双击任意图片(包括表格里的)即可放大查看,←/→ 切换。

- [ ] 待办一
- [x] 待办二

<details>
<summary>折叠块标题</summary>

折叠块内容

</details>

$$
E = mc^2
$$
`

export function seedDemo(host: MemoryHost): void {
  const enc = new TextEncoder()
  host.files.set(DEMO_ROOT, { kind: 'dir', mtime: Date.now() })
  host.files.set(`${DEMO_ROOT}/assets`, { kind: 'dir', mtime: Date.now() })
  host.files.set(`${DEMO_ROOT}/assets/form.svg`, { kind: 'file', data: enc.encode(sampleSvg('基本信息表单', 1200, 680)), mtime: Date.now() })
  host.files.set(`${DEMO_ROOT}/assets/id.svg`, { kind: 'file', data: enc.encode(sampleSvg('标识符', 400, 240, '#448361')), mtime: Date.now() })
  host.files.set(`${DEMO_ROOT}/assets/name.svg`, { kind: 'file', data: enc.encode(sampleSvg('名称', 400, 240, '#D9730D')), mtime: Date.now() })
  host.files.set(`${DEMO_ROOT}/assets/anim.gif`, { kind: 'file', data: Uint8Array.from(atob(TINY_GIF), (c) => c.charCodeAt(0)), mtime: Date.now() })
  host.files.set(DEMO_DOC, { kind: 'file', data: DEMO_MARKDOWN, mtime: Date.now() })
  host.files.set(`${DEMO_ROOT}/另一篇.md`, { kind: 'file', data: '# 另一篇\n\n用于测试文档链接。\n', mtime: Date.now() })
}
