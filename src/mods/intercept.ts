interface TransformOptions {
  hideShorts?: boolean
  showOriginalVideoTitle?: boolean
  // Ad blocking is a separate choice from background playback: a user can keep
  // the intercept running and still let ads through to support creators.
  blockAds?: boolean
}


const AD_RENDERER_KEYS = [
  'adSlotRenderer',
  'adsEngagementPanelRenderer',
  'bannerPromoRenderer',
  'brandVideoShelfRenderer',
  'brandVideoSingletonRenderer',
  'carouselAdRenderer',
  'compactPromotedItemRenderer',
  'compactPromotedVideoRenderer',
  'displayAdRenderer',
  'inFeedAdLayoutRenderer',
  'mealbarPromoRenderer',
  'primetimePromoRenderer',
  'promotedSparklesTextSearchRenderer',
  'promotedSparklesWebRenderer',
  'promotedVideoRenderer',
  'searchPyvRenderer',
  'statementBannerRenderer',
]

function isAdItem(item: any): boolean {
  if (!item || typeof item !== 'object') {
    return false
  }

  // An ad in the Shorts feed is a regular reel entry flagged as an ad.
  if (item.command?.reelWatchEndpoint?.adClientParams?.isAd) {
    return true
  }

  // Wrappers keep the ad one level down, e.g. richItemRenderer.content.adSlotRenderer.
  const candidates = [
    item,
    item.richItemRenderer?.content,
    item.richSectionRenderer?.content,
    item.itemSectionRenderer?.contents?.length === 1 ? item.itemSectionRenderer.contents[0] : undefined,
  ].filter(Boolean)

  return candidates.some((candidate) => AD_RENDERER_KEYS.some((key) => candidate[key]))
}

export function filterListResponse(data: any, options: TransformOptions = {}) {
  if (!data || typeof data !== 'object') {
    return
  }

  const dropAds = options.blockAds !== false
  for (const key of Object.keys(data)) {
    const value = data[key]
    if (Array.isArray(value)) {
      data[key] = value.filter((item) => !(dropAds && isAdItem(item)))
      data[key].forEach((item: any) => filterListResponse(item, options))
    } else if (value && typeof value === 'object') {
      filterListResponse(value, options)
    }
  }
}

export function intercept() {
  // Intercept initial page data (server-rendered in script tags)
  const settings = window.StreamablesInitialSettings;
  try {
    filterListResponse((window as any).ytInitialData,  {
  blockAds: settings.blockAds !== false,
  showOriginalVideoTitle: Boolean(settings.showOriginalVideoTitle),
});
  } catch (error) {
    console.error("[mods] initialData:", error);
  }

  const winFetch = fetch
  // ts-ignore rather than ts-expect-error: react-native's global fetch typing
  // makes this assignment an error in the app's program but not in the
  // extension's, where an unused expect-error would itself fail the build.
  // @ts-ignore
  window.fetch = async (...args) => {
    const request = args[0]
    const url = request instanceof Request ? request.url : request.toString()
    let res = await winFetch(...args)
    const match = new URL(url).pathname.match(RE_INTERCEPT)
    const settings = window.StreamablesInitialSettings
    const options = {
      showOriginalVideoTitle: Boolean(settings?.showOriginalVideoTitle),
      blockAds: settings?.blockAds !== false,
    }
    if (res.status > 200 || !match) {
      return res
    }

    const text = await res.text()
    const responseInit = {
      status: res.status,
      headers: res.headers,
    }
    try {
      const fn =
        {
          browse: (text: string) => transformBrowseResponse(text, options),
          get_watch: (text: string) => transformGetWatchResponse(text, options),
          next: (text: string) => transformBrowseResponse(text, options),
          reel: (text: string) => transformReelResponse(text, options),
          search: (text: string) => transformSearchResponse(text, options),
        }[match[1]] || ((text: string) => transformPlayerResponse(text, options))
      return new Response(fn(text), responseInit)
    } catch (error) {
      console.error('NouScript:', error)
    }
    return new Response(text, responseInit)
  }

  // https://stackoverflow.com/a/78369686
  const xhrOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url) {
    url = url.toString()
    this.addEventListener('readystatechange', function () {
      if (this.readyState !== 4) {
        return
      }

      const match = new URL(url, location.origin).pathname.match(RE_INTERCEPT)
      if (!match) {
        return
      }

      const settings = window.StreamablesInitialSettings
      const options = {
        showOriginalVideoTitle: Boolean(settings?.showOriginalVideoTitle),
        blockAds: settings?.blockAds !== false,
      }
      try {
        const fn =
          {
            browse: (text: string) => transformBrowseResponse(text, options),
            get_watch: (text: string) => transformGetWatchResponse(text, options),
            next: (text: string) => transformBrowseResponse(text, options),
            reel: (text: string) => transformReelResponse(text, options),
            search: (text: string) => transformSearchResponse(text, options),
          }[match[1]] || ((text: string) => transformPlayerResponse(text, options))
        const text = fn(this.responseText)
        Object.defineProperty(this, 'response', { writable: true })
        Object.defineProperty(this, 'responseText', { writable: true })
        // @ts-expect-error xx
        this.response = this.responseText = text
      } catch (error) {
        console.error('NouScript:', error)
      }
    })
    return xhrOpen.call(this, method, url, true);
  }
}



const keys = ['adBreakHeartbeatParams', 'adPlacements', 'adSlots', 'playerAds']

export const RE_INTERCEPT = new RegExp('^/youtubei/v1/(browse|get_watch|next|player|reel|search)')

const blocksAds = (options: TransformOptions) => options.blockAds !== false

export function transformGetWatchResponse(text: string, options: TransformOptions = {}) {
  const data = JSON.parse(text)
  if (blocksAds(options)) {
    stripAdKeys(data[0].playerResponse)
  }
  applyPlayerResponseOriginalTitle(data[0].playerResponse, options)
  rewriteOriginalTitles(data, options)
  return JSON.stringify(data)
}

function stripAdKeys(data: any) {
  keys.forEach((key) => delete data[key])
  return data
}

export function transformPlayerResponse(text: string, options: TransformOptions = {}) {
  const data = JSON.parse(text)
  if (blocksAds(options)) {
    stripAdKeys(data)
  }
  applyPlayerResponseOriginalTitle(data, options)
  rewriteOriginalTitles(data, options)
  return JSON.stringify(data)
}

export function transformSearchResponse(text: string, options: TransformOptions = {}) {
  const data = JSON.parse(text) as SearchResponse
  const hideShorts = options.hideShorts !== false
  rewriteOriginalTitles(data, options)
  const sectionListRenderer =
    // mobile
    data.contents?.sectionListRenderer ||
    // desktop
    data.contents?.twoColumnSearchResultsRenderer?.primaryContents.sectionListRenderer
  const itemSectionRenderer =
    sectionListRenderer?.contents[0].itemSectionRenderer ||
    data.onResponseReceivedCommands?.[0].appendContinuationItemsAction?.continuationItems?.[0].itemSectionRenderer

  if (itemSectionRenderer) {
    itemSectionRenderer.contents = itemSectionRenderer.contents
      .map((x) => transformSectionListItem(x, hideShorts))
      .filter(Boolean) as any
  }
  filterListResponse(data, options)
  return JSON.stringify(data)
}

export function transformBrowseResponse(
  text: string,
  options: TransformOptions = {},
) {
  const data = JSON.parse(text)
  rewriteOriginalTitles(data, options)
  filterListResponse(data, options)
  return JSON.stringify(data)
}

// The Shorts feed: reel/reel_watch_sequence lists the upcoming shorts (ads are
// entries of their own), reel/reel_item_watch describes a single one.
export function transformReelResponse(text: string, options: TransformOptions = {}) {
  const data = JSON.parse(text)
  if (blocksAds(options) && data?.playerResponse && typeof data.playerResponse === 'object') {
    stripAdKeys(data.playerResponse)
  }
  rewriteOriginalTitles(data, options)
  filterListResponse(data, options)
  return JSON.stringify(data)
}

function transformSectionListItem(item: SectionListItem, hideShorts: boolean) {
  const { videoWithContextRenderer, gridShelfViewModel } = item
  if (
    hideShorts &&
    (gridShelfViewModel ||
      videoWithContextRenderer?.navigationEndpoint.commandMetadata.webCommandMetadata.url.startsWith('/shorts'))
  ) {
    return undefined
  }
  return item
}

function getDirectRenderers(item: any): any[] {
  if (!item || typeof item !== 'object') {
    return []
  }

  const renderers = [
    item.videoRenderer,
    item.compactVideoRenderer,
    item.gridVideoRenderer,
    item.videoWithContextRenderer,
    item.reelItemRenderer,
    item.lockupViewModel,
    item.richItemRenderer?.content?.videoRenderer,
    item.richItemRenderer?.content?.lockupViewModel,
  ].filter(Boolean)

  return renderers.length ? renderers : []
}

function textFromNode(node: any): string {
  if (!node) {
    return ''
  }
  if (typeof node === 'string') {
    return node
  }
  if (typeof node.simpleText === 'string') {
    return node.simpleText
  }
  if (typeof node.content === 'string') {
    return node.content
  }
  if (Array.isArray(node.runs)) {
    return node.runs.map((run: any) => run?.text || '').join('')
  }
  return ''
}

function applyPlayerResponseOriginalTitle(data: any, options: TransformOptions) {
  if (!options.showOriginalVideoTitle) {
    return
  }

  const originalTitle = textFromNode(data?.videoDetails?.title)
  if (!originalTitle) {
    return
  }

  setTextNode(data?.microformat?.playerMicroformatRenderer?.title, originalTitle)
  setTextNode(data?.videoDetails?.title, originalTitle)
}

function rewriteOriginalTitles(data: any, options: TransformOptions) {
  if (!options.showOriginalVideoTitle || !data || typeof data !== 'object') {
    return
  }

  walk(data, (node) => {
    for (const renderer of getDirectRenderers(node)) {
      rewriteRendererTitle(renderer)
    }
    rewriteRendererTitle(node)
  })
}

function walk(node: any, visit: (node: any) => void) {
  if (!node || typeof node !== 'object') {
    return
  }

  visit(node)
  if (Array.isArray(node)) {
    node.forEach((item) => walk(item, visit))
    return
  }

  for (const key of Object.keys(node)) {
    walk(node[key], visit)
  }
}

function rewriteRendererTitle(renderer: any) {
  if (!renderer || typeof renderer !== 'object') {
    return
  }

  const originalTitle = getOriginalTitle(renderer)
  if (!originalTitle) {
    return
  }

  setTextNode(renderer.title, originalTitle)
  setTextNode(renderer.headline, originalTitle)
  setTextNode(renderer.metadata?.lockupMetadataViewModel?.title, originalTitle)
}

function getOriginalTitle(renderer: any): string {
  return [
    renderer.originalTitle,
    renderer.untranslatedTitle,
    renderer.untranslatedVideoTitle,
    renderer.title?.originalTitle,
    renderer.title?.untranslatedTitle,
    renderer.headline?.originalTitle,
    renderer.metadata?.lockupMetadataViewModel?.originalTitle,
    renderer.metadata?.lockupMetadataViewModel?.title?.originalTitle,
  ]
    .map(textFromNode)
    .find(Boolean) || ''
}

function setTextNode(node: any, text: string) {
  if (!node || typeof node !== 'object') {
    return
  }

  if (typeof node.simpleText === 'string') {
    node.simpleText = text
  }
  if (typeof node.content === 'string') {
    node.content = text
  }
  if (Array.isArray(node.runs) && node.runs.length) {
    node.runs.forEach((run: any, index: number) => {
      if (run && typeof run === 'object' && typeof run.text === 'string') {
        run.text = index === 0 ? text : ''
      }
    })
  }
}

interface SearchResponse {
  // 1st page
  contents?: {
    twoColumnSearchResultsRenderer?: {
      primaryContents: {
        sectionListRenderer?: {
          contents: SectionList[]
        }
      }
    }
    sectionListRenderer?: {
      contents: SectionList[]
    }
  }
  // 2nd page
  onResponseReceivedCommands?: {
    appendContinuationItemsAction?: {
      continuationItems?: SectionList[]
    }
  }[]
}

interface SectionList {
  itemSectionRenderer?: {
    contents: SectionListItem[]
  }
}

interface SectionListItem {
  videoWithContextRenderer?: {
    navigationEndpoint: {
      commandMetadata: {
        webCommandMetadata: {
          url: string
        }
      }
    }
  }
  gridShelfViewModel?: any
}
