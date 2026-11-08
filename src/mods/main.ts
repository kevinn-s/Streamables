import { intercept } from "./intercept";

try {
intercept();

function injectAdCSS() {
  const id = "streamables-ad-css";
  const style =
    document.querySelector<HTMLStyleElement>(`#${id}`) ??
    document.createElement("style");

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
}

if (document.documentElement) {
  injectAdCSS();
} else {
  document.addEventListener("DOMContentLoaded", injectAdCSS, { once: true });
}

// Force YouTube to serve H.264 by claiming we cannot play VP8/VP9/AV1/WebM.
// Adapted from https://github.com/erkserkserks/h264ify (MIT).
const DISALLOWED = ['webm', 'vp8', 'vp9', 'av01']

function makeChecker(orig: (type: string) => any) {
  return function (type: string) {
    if (type === undefined) return ''
    for (const bad of DISALLOWED) {
      if (type.indexOf(bad) !== -1) return ''
    }
    return orig(type)
  }
}

function installH264ify() {
  try {
    const videoElem = document.createElement('video')
    const origCanPlayType = videoElem.canPlayType.bind(videoElem)
      ; (HTMLVideoElement.prototype as any).canPlayType = makeChecker(origCanPlayType)
  } catch (e) { }

  try {
    const mse: any = (window as any).MediaSource
    if (mse && typeof mse.isTypeSupported === 'function') {
      const origIsTypeSupported = mse.isTypeSupported.bind(mse)
      mse.isTypeSupported = makeChecker(origIsTypeSupported)
    }
  } catch (e) { }
}

installH264ify()

const ACCEPTED_VIDEO_LINK_ANCHOR_ELEMENT = [
  ".ytLockupMetadataViewModelTitle",
  ".ytdVideoPreviewMediaContainerLink",
  ".ytLockupViewModelMetadata",
  ".ytLockupViewModelContentImage",
  ".shortsLockupViewModelHostEndpoint", /** YouTube Shorts */
  ".reel-item-endpoint", /** YouTube Shorts */
  "a.yt-simple-endpoint.inline-block.style-scope.ytd-thumbnail",
  "a.yt-simple-endpoint.style-scope.ytd-video-renderer",
].join(", ");

function installNavigationListener() {
  document.addEventListener("yt-navigate-finish", () => {
  window.__electrobunSendToHost({
    type: "page-navigated",
    states: {
      ...Object.fromEntries(new URL(location.href).searchParams),
      url: location.href,
    },
  });
});
}
function installVideoSelectionListener() {
  document.addEventListener(
    "click",
    (event: MouseEvent) => {
      // Leave modified clicks alone.
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      // Only accept known video-title/thumbnail link contexts.
      if (!anchor.closest(ACCEPTED_VIDEO_LINK_ANCHOR_ELEMENT)) return;

      const url = new URL(anchor.href);

      if (
        url.protocol !== "https:" ||
        !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(
          url.hostname
        ) 
      ) {
        return;
      } 

      const isWatch = url.pathname === "/watch", isWatchShorts = url.pathname.match(/^\/shorts\/([^/]+)\/?$/);

      let watchId = null

      if(isWatch) {
        watchId = url.searchParams.get("v")
      } else if (isWatchShorts) {
        watchId = isWatchShorts[1];
      } else {
        return;
      }

      /** Do not use these event propagation, as you will not able to click and watch any video, YouTube requires this. */
      // event.preventDefault();
      // event.stopImmediatePropagation();

      window.__electrobunSendToHost({
        type: "video-selected",
        watchId: watchId,
        watchUrl: url.href,
      });
    },
    true
  );
}

installVideoSelectionListener();

installNavigationListener()

} catch (error) {
  console.error("[mods] initialization failed:", error);
}