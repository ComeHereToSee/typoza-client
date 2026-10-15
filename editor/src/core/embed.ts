// 粘贴网址时判断能否嵌入:视频网站的分享地址转成官方嵌入播放器地址;直链媒体按扩展名归类。
import type { MediaKind } from './schema'

export interface EmbedTarget {
  kind: MediaKind | 'image'
  /** 写进文档的地址(嵌入播放器地址或原地址) */
  src: string
  provider: string | null
}

const VIDEO_EXT = /\.(mp4|m4v|webm|mov|ogv)(?:$|[?#])/i
const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|oga|flac|aac)(?:$|[?#])/i
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|apng|avif|svg|bmp)(?:$|[?#])/i
const PDF_EXT = /\.pdf(?:$|[?#])/i

/** 能识别成媒体或已知嵌入的网址返回目标;普通网页返回 null(由调用方提供「嵌入 / 书签 / 链接」选择)。 */
export function detectEmbed(raw: string): EmbedTarget | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (!/^https?:$/.test(url.protocol)) return null
  const href = url.href
  if (IMAGE_EXT.test(url.pathname)) return { kind: 'image', src: href, provider: null }
  if (VIDEO_EXT.test(url.pathname)) return { kind: 'video', src: href, provider: null }
  if (AUDIO_EXT.test(url.pathname)) return { kind: 'audio', src: href, provider: null }
  if (PDF_EXT.test(url.pathname)) return { kind: 'pdf', src: href, provider: null }
  const provider = providerEmbed(url)
  return provider ? { kind: 'embed', src: provider.src, provider: provider.name } : null
}

function providerEmbed(url: URL): { name: string; src: string } | null {
  const host = url.hostname.replace(/^www\.|^m\./, '')
  const path = url.pathname
  let m: RegExpExecArray | null
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    const v = url.searchParams.get('v')
    if (v) return { name: 'YouTube', src: `https://www.youtube.com/embed/${v}` }
    if ((m = /^\/(?:shorts|embed|live)\/([\w-]+)/.exec(path))) return { name: 'YouTube', src: `https://www.youtube.com/embed/${m[1]}` }
  }
  if (host === 'youtu.be' && (m = /^\/([\w-]+)/.exec(path))) return { name: 'YouTube', src: `https://www.youtube.com/embed/${m[1]}` }
  if (host === 'bilibili.com' || host === 'b23.tv') {
    if ((m = /\/video\/(BV[\w]+)/i.exec(path))) {
      const p = url.searchParams.get('p')
      return { name: '哔哩哔哩', src: `https://player.bilibili.com/player.html?bvid=${m[1]}${p ? `&p=${p}` : ''}&autoplay=0` }
    }
    if ((m = /\/video\/av(\d+)/i.exec(path))) return { name: '哔哩哔哩', src: `https://player.bilibili.com/player.html?aid=${m[1]}&autoplay=0` }
  }
  if (host === 'vimeo.com' && (m = /^\/(\d+)/.exec(path))) return { name: 'Vimeo', src: `https://player.vimeo.com/video/${m[1]}` }
  if (host === 'loom.com' && (m = /^\/(?:share|embed)\/([\w-]+)/.exec(path))) return { name: 'Loom', src: `https://www.loom.com/embed/${m[1]}` }
  if (host === 'figma.com' && /^\/(file|design|proto|board)\//.test(path)) {
    return { name: 'Figma', src: `https://www.figma.com/embed?embed_host=typoza&url=${encodeURIComponent(url.href)}` }
  }
  if (host === 'codepen.io' && (m = /^\/([\w-]+)\/(?:pen|full|details)\/([\w-]+)/.exec(path))) {
    return { name: 'CodePen', src: `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result` }
  }
  if (host === 'open.spotify.com' && (m = /^\/(track|album|playlist|episode|show)\/(\w+)/.exec(path))) {
    return { name: 'Spotify', src: `https://open.spotify.com/embed/${m[1]}/${m[2]}` }
  }
  if (host === 'v.youku.com' && (m = /id_([\w=]+)\.html/.exec(path))) return { name: '优酷', src: `https://player.youku.com/embed/${m[1]}` }
  if (host === 'v.qq.com' && (m = /\/([a-z0-9]{11})\.html$/i.exec(path))) {
    return { name: '腾讯视频', src: `https://v.qq.com/txp/iframe/player.html?vid=${m[1]}` }
  }
  if (host === 'player.bilibili.com' || host === 'player.vimeo.com' || /youtube\.com\/embed\//.test(url.href)) {
    return { name: host, src: url.href }
  }
  return null
}

/** 嵌入地址对应的提供方名称(显示在嵌入块角标)。 */
export function providerName(src: string): string {
  try {
    const host = new URL(src).hostname
    if (host.includes('youtube')) return 'YouTube'
    if (host.includes('bilibili')) return '哔哩哔哩'
    if (host.includes('vimeo')) return 'Vimeo'
    if (host.includes('loom')) return 'Loom'
    if (host.includes('figma')) return 'Figma'
    if (host.includes('codepen')) return 'CodePen'
    if (host.includes('spotify')) return 'Spotify'
    if (host.includes('youku')) return '优酷'
    if (host.includes('qq.com')) return '腾讯视频'
    return host
  } catch {
    return '嵌入'
  }
}

/** 视频类嵌入按 16:9 显示,其余用固定高度。 */
export function isVideoEmbed(src: string): boolean {
  return /youtube|bilibili|vimeo|loom|youku|v\.qq\.com/.test(src)
}
