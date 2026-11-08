(() => {
  // src/mods/intercept.ts
  var AD_RENDERER_KEYS = [
    "adSlotRenderer",
    "adsEngagementPanelRenderer",
    "bannerPromoRenderer",
    "brandVideoShelfRenderer",
    "brandVideoSingletonRenderer",
    "carouselAdRenderer",
    "compactPromotedItemRenderer",
    "compactPromotedVideoRenderer",
    "displayAdRenderer",
    "inFeedAdLayoutRenderer",
    "mealbarPromoRenderer",
    "primetimePromoRenderer",
    "promotedSparklesTextSearchRenderer",
    "promotedSparklesWebRenderer",
    "promotedVideoRenderer",
    "searchPyvRenderer",
    "statementBannerRenderer"
  ];
  function isAdItem(item) {
    if (!item || typeof item !== "object") {
      return false;
    }
    if (item.command?.reelWatchEndpoint?.adClientParams?.isAd) {
      return true;
    }
    const candidates = [
      item,
      item.richItemRenderer?.content,
      item.richSectionRenderer?.content,
      item.itemSectionRenderer?.contents?.length === 1 ? item.itemSectionRenderer.contents[0] : undefined
    ].filter(Boolean);
    return candidates.some((candidate) => AD_RENDERER_KEYS.some((key) => candidate[key]));
  }
  function filterListResponse(data, options = {}) {
    if (!data || typeof data !== "object") {
      return;
    }
    const dropAds = options.blockAds !== false;
    for (const key of Object.keys(data)) {
      const value = data[key];
      if (Array.isArray(value)) {
        data[key] = value.filter((item) => !(dropAds && isAdItem(item)));
        data[key].forEach((item) => filterListResponse(item, options));
      } else if (value && typeof value === "object") {
        filterListResponse(value, options);
      }
    }
  }
  function intercept() {
    const settings = window.StreamablesInitialSettings;
    try {
      filterListResponse(window.ytInitialData, {
        blockAds: settings.blockAds !== false,
        showOriginalVideoTitle: Boolean(settings.showOriginalVideoTitle)
      });
    } catch (error) {
      console.error("[mods] initialData:", error);
    }
    const winFetch = fetch;
    window.fetch = async (...args) => {
      const request = args[0];
      const url = request instanceof Request ? request.url : request.toString();
      let res = await winFetch(...args);
      const match = new URL(url).pathname.match(RE_INTERCEPT);
      const settings = window.StreamablesInitialSettings;
      const options = {
        showOriginalVideoTitle: Boolean(settings?.showOriginalVideoTitle),
        blockAds: settings?.blockAds !== false
      };
      if (res.status > 200 || !match) {
        return res;
      }
      const text = await res.text();
      const responseInit = {
        status: res.status,
        headers: res.headers
      };
      try {
        const fn = {
          browse: (text) => transformBrowseResponse(text, options),
          get_watch: (text) => transformGetWatchResponse(text, options),
          next: (text) => transformBrowseResponse(text, options),
          reel: (text) => transformReelResponse(text, options),
          search: (text) => transformSearchResponse(text, options)
        }[match[1]] || ((text) => transformPlayerResponse(text, options));
        return new Response(fn(text), responseInit);
      } catch (error) {
        console.error("NouScript:", error);
      }
      return new Response(text, responseInit);
    };
    const xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      url = url.toString();
      this.addEventListener("readystatechange", function() {
        if (this.readyState !== 4) {
          return;
        }
        const match = new URL(url, location.origin).pathname.match(RE_INTERCEPT);
        if (!match) {
          return;
        }
        const settings = window.StreamablesInitialSettings;
        const options = {
          showOriginalVideoTitle: Boolean(settings?.showOriginalVideoTitle),
          blockAds: settings?.blockAds !== false
        };
        try {
          const fn = {
            browse: (text) => transformBrowseResponse(text, options),
            get_watch: (text) => transformGetWatchResponse(text, options),
            next: (text) => transformBrowseResponse(text, options),
            reel: (text) => transformReelResponse(text, options),
            search: (text) => transformSearchResponse(text, options)
          }[match[1]] || ((text) => transformPlayerResponse(text, options));
          const text = fn(this.responseText);
          Object.defineProperty(this, "response", { writable: true });
          Object.defineProperty(this, "responseText", { writable: true });
          this.response = this.responseText = text;
        } catch (error) {
          console.error("NouScript:", error);
        }
      });
      return xhrOpen.call(this, method, url, true);
    };
  }
  var keys = ["adBreakHeartbeatParams", "adPlacements", "adSlots", "playerAds"];
  var RE_INTERCEPT = new RegExp("^/youtubei/v1/(browse|get_watch|next|player|reel|search)");
  var blocksAds = (options) => options.blockAds !== false;
  function transformGetWatchResponse(text, options = {}) {
    const data = JSON.parse(text);
    if (blocksAds(options)) {
      stripAdKeys(data[0].playerResponse);
    }
    applyPlayerResponseOriginalTitle(data[0].playerResponse, options);
    rewriteOriginalTitles(data, options);
    return JSON.stringify(data);
  }
  function stripAdKeys(data) {
    keys.forEach((key) => delete data[key]);
    return data;
  }
  function transformPlayerResponse(text, options = {}) {
    const data = JSON.parse(text);
    if (blocksAds(options)) {
      stripAdKeys(data);
    }
    applyPlayerResponseOriginalTitle(data, options);
    rewriteOriginalTitles(data, options);
    return JSON.stringify(data);
  }
  function transformSearchResponse(text, options = {}) {
    const data = JSON.parse(text);
    const hideShorts = options.hideShorts !== false;
    rewriteOriginalTitles(data, options);
    const sectionListRenderer = data.contents?.sectionListRenderer || data.contents?.twoColumnSearchResultsRenderer?.primaryContents.sectionListRenderer;
    const itemSectionRenderer = sectionListRenderer?.contents[0].itemSectionRenderer || data.onResponseReceivedCommands?.[0].appendContinuationItemsAction?.continuationItems?.[0].itemSectionRenderer;
    if (itemSectionRenderer) {
      itemSectionRenderer.contents = itemSectionRenderer.contents.map((x) => transformSectionListItem(x, hideShorts)).filter(Boolean);
    }
    filterListResponse(data, options);
    return JSON.stringify(data);
  }
  function transformBrowseResponse(text, options = {}) {
    const data = JSON.parse(text);
    rewriteOriginalTitles(data, options);
    filterListResponse(data, options);
    return JSON.stringify(data);
  }
  function transformReelResponse(text, options = {}) {
    const data = JSON.parse(text);
    if (blocksAds(options) && data?.playerResponse && typeof data.playerResponse === "object") {
      stripAdKeys(data.playerResponse);
    }
    rewriteOriginalTitles(data, options);
    filterListResponse(data, options);
    return JSON.stringify(data);
  }
  function transformSectionListItem(item, hideShorts) {
    const { videoWithContextRenderer, gridShelfViewModel } = item;
    if (hideShorts && (gridShelfViewModel || videoWithContextRenderer?.navigationEndpoint.commandMetadata.webCommandMetadata.url.startsWith("/shorts"))) {
      return;
    }
    return item;
  }
  function getDirectRenderers(item) {
    if (!item || typeof item !== "object") {
      return [];
    }
    const renderers = [
      item.videoRenderer,
      item.compactVideoRenderer,
      item.gridVideoRenderer,
      item.videoWithContextRenderer,
      item.reelItemRenderer,
      item.lockupViewModel,
      item.richItemRenderer?.content?.videoRenderer,
      item.richItemRenderer?.content?.lockupViewModel
    ].filter(Boolean);
    return renderers.length ? renderers : [];
  }
  function textFromNode(node) {
    if (!node) {
      return "";
    }
    if (typeof node === "string") {
      return node;
    }
    if (typeof node.simpleText === "string") {
      return node.simpleText;
    }
    if (typeof node.content === "string") {
      return node.content;
    }
    if (Array.isArray(node.runs)) {
      return node.runs.map((run) => run?.text || "").join("");
    }
    return "";
  }
  function applyPlayerResponseOriginalTitle(data, options) {
    if (!options.showOriginalVideoTitle) {
      return;
    }
    const originalTitle = textFromNode(data?.videoDetails?.title);
    if (!originalTitle) {
      return;
    }
    setTextNode(data?.microformat?.playerMicroformatRenderer?.title, originalTitle);
    setTextNode(data?.videoDetails?.title, originalTitle);
  }
  function rewriteOriginalTitles(data, options) {
    if (!options.showOriginalVideoTitle || !data || typeof data !== "object") {
      return;
    }
    walk(data, (node) => {
      for (const renderer of getDirectRenderers(node)) {
        rewriteRendererTitle(renderer);
      }
      rewriteRendererTitle(node);
    });
  }
  function walk(node, visit) {
    if (!node || typeof node !== "object") {
      return;
    }
    visit(node);
    if (Array.isArray(node)) {
      node.forEach((item) => walk(item, visit));
      return;
    }
    for (const key of Object.keys(node)) {
      walk(node[key], visit);
    }
  }
  function rewriteRendererTitle(renderer) {
    if (!renderer || typeof renderer !== "object") {
      return;
    }
    const originalTitle = getOriginalTitle(renderer);
    if (!originalTitle) {
      return;
    }
    setTextNode(renderer.title, originalTitle);
    setTextNode(renderer.headline, originalTitle);
    setTextNode(renderer.metadata?.lockupMetadataViewModel?.title, originalTitle);
  }
  function getOriginalTitle(renderer) {
    return [
      renderer.originalTitle,
      renderer.untranslatedTitle,
      renderer.untranslatedVideoTitle,
      renderer.title?.originalTitle,
      renderer.title?.untranslatedTitle,
      renderer.headline?.originalTitle,
      renderer.metadata?.lockupMetadataViewModel?.originalTitle,
      renderer.metadata?.lockupMetadataViewModel?.title?.originalTitle
    ].map(textFromNode).find(Boolean) || "";
  }
  function setTextNode(node, text) {
    if (!node || typeof node !== "object") {
      return;
    }
    if (typeof node.simpleText === "string") {
      node.simpleText = text;
    }
    if (typeof node.content === "string") {
      node.content = text;
    }
    if (Array.isArray(node.runs) && node.runs.length) {
      node.runs.forEach((run, index) => {
        if (run && typeof run === "object" && typeof run.text === "string") {
          run.text = index === 0 ? text : "";
        }
      });
    }
  }

  // src/mods/main.ts
  try {
    let injectAdCSS = function() {
      const id = "streamables-ad-css";
      const style = document.querySelector(`#${id}`) ?? document.createElement("style");
      style.id = id;
      style.textContent = `
    ytd-page-top-ad-layout-renderer,
    ytd-in-feed-ad-layout-renderer,
    ad-slot-renderer,
    yt-mealbar-promo-renderer,
    ytm-promoted-sparkles-web-renderer,
    .ytd-player-legacy-desktop-watch-ads-renderer,
    ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
    ytd-rich-item-renderer:has(ytd-in-feed-ad-layout-renderer),
    ytd-rich-section-renderer:has(ytd-ad-slot-renderer),
    ytd-rich-section-renderer:has(ytd-statement-banner-renderer),
    ytd-item-section-renderer:has(ytd-ad-slot-renderer),
    ytm-rich-item-renderer:has(ad-slot-renderer),
    ytm-item-section-renderer:has(ad-slot-renderer),
    ytd-rich-item-renderer:has(ad-slot-renderer),
    ytd-rich-item-renderer:has(.ytwFeedAdMetadataViewModelHostMetadata) {
      display: none !important;
    }
  `;
      (document.head ?? document.documentElement).appendChild(style);
    }, makeChecker = function(orig) {
      return function(type) {
        if (type === undefined)
          return "";
        for (const bad of DISALLOWED) {
          if (type.indexOf(bad) !== -1)
            return "";
        }
        return orig(type);
      };
    }, installH264ify = function() {
      try {
        const videoElem = document.createElement("video");
        const origCanPlayType = videoElem.canPlayType.bind(videoElem);
        HTMLVideoElement.prototype.canPlayType = makeChecker(origCanPlayType);
      } catch (e) {}
      try {
        const mse = window.MediaSource;
        if (mse && typeof mse.isTypeSupported === "function") {
          const origIsTypeSupported = mse.isTypeSupported.bind(mse);
          mse.isTypeSupported = makeChecker(origIsTypeSupported);
        }
      } catch (e) {}
    }, installNavigationListener = function() {
      document.addEventListener("yt-navigate-finish", () => {
        window.__electrobunSendToHost({
          type: "page-navigated",
          states: {
            ...Object.fromEntries(new URL(location.href).searchParams),
            url: location.href
          }
        });
      });
    }, installVideoSelectionListener = function() {
      document.addEventListener("click", (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
          return;
        }
        const target = event.target;
        if (!(target instanceof Element))
          return;
        const anchor = target.closest("a[href]");
        if (!anchor)
          return;
        if (!anchor.closest(ACCEPTED_VIDEO_LINK_ANCHOR_ELEMENT))
          return;
        const url = new URL(anchor.href);
        if (url.protocol !== "https:" || !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
          return;
        }
        const isWatch = url.pathname === "/watch", isWatchShorts = url.pathname.match(/^\/shorts\/([^/]+)\/?$/);
        let watchId = null;
        if (isWatch) {
          watchId = url.searchParams.get("v");
        } else if (isWatchShorts) {
          watchId = isWatchShorts[1];
        } else {
          return;
        }
        window.__electrobunSendToHost({
          type: "video-selected",
          watchId,
          watchUrl: url.href
        });
      }, true);
    };
    intercept();
    if (document.documentElement) {
      injectAdCSS();
    } else {
      document.addEventListener("DOMContentLoaded", injectAdCSS, { once: true });
    }
    const DISALLOWED = ["webm", "vp8", "vp9", "av01"];
    installH264ify();
    const ACCEPTED_VIDEO_LINK_ANCHOR_ELEMENT = [
      ".ytLockupMetadataViewModelTitle",
      ".ytdVideoPreviewMediaContainerLink",
      ".ytLockupViewModelMetadata",
      ".ytLockupViewModelContentImage",
      ".shortsLockupViewModelHostEndpoint",
      ".reel-item-endpoint",
      "a.yt-simple-endpoint.inline-block.style-scope.ytd-thumbnail",
      "a.yt-simple-endpoint.style-scope.ytd-video-renderer"
    ].join(", ");
    installVideoSelectionListener();
    installNavigationListener();
  } catch (error) {
    console.error("[mods] initialization failed:", error);
  }
})();
