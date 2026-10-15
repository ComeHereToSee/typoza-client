// 构建期修补依赖里的性能问题(只改指定文件的指定片段;片段对不上就构建失败,防止依赖升级后补丁静默失效)。
import type { Plugin } from 'vite'

interface Patch {
  /** 模块路径匹配 */
  file: RegExp
  /** 为什么要改 */
  reason: string
  before: string
  after: string
}

const PATCHES: Patch[] = [
  {
    // micromark-extension-gfm-table 2.1.2:每解析完一张表,EditMap.consume 都把「文档到目前为止的全部分词事件」
    // 复制一遍再塞回去。文档含列表、引用等容器时整篇共用一个分词器,事件随文档增长,
    // 于是总耗时 = 表格数 × 文档长度(5MB 混排文档解析要几十秒)。第一处修改之前的前缀根本没变,不必复制。
    file: /micromark-extension-gfm-table[\\/]lib[\\/]edit-map\.js$/,
    reason: 'EditMap.consume 复制未改动的事件前缀导致平方级耗时',
    before: '    vecs.push(events.slice());\n    events.length = 0;\n    let slice = vecs.pop();',
    after: '    let slice = vecs.pop();',
  },
]

export function patchDeps(): Plugin {
  return {
    name: 'tz-patch-deps',
    enforce: 'pre',
    transform(code, id) {
      const path = id.split('?')[0]
      const patch = PATCHES.find((p) => p.file.test(path))
      if (!patch) return null
      if (!code.includes(patch.before)) {
        throw new Error(`依赖补丁对不上(${patch.reason}):${path} 的内容与预期不符,依赖可能已升级,请复核 build/patch-deps.ts`)
      }
      return { code: code.replace(patch.before, patch.after), map: null }
    },
  }
}
