import { forwardRef } from "react";
import { useEffect, useRef, useState } from "react";
import type { DetailedHTMLProps, HTMLAttributes } from "react";
import type { WebviewTagElement } from "electrobun/view";
import main from "../../mods/main.bundle.js?raw";

import { useValue } from "./Main";
import { useSettingsStore } from "../../states/settings";
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "electrobun-webview": DetailedHTMLProps<
        HTMLAttributes<WebviewTagElement>,
        WebviewTagElement
      > & {
        src?: string;
        sandbox?: string;
        renderer?: "native" | "cef";
        partition?: string;
      };
    }
  }
}
export type OnLoadEventPayload = {
  url: string
}

export type OnMessageEventPayload = {
  payload: string
}

export type TubeViewProps = {
  style?: React.CSSProperties,
  ref?: React.Ref<any>
  useragent?: string
  src?: string
  navigate: (options: {
    to: string;
    params?: Record<string, string>;
  }) => void;
  partition?: string
  allowpopups?: boolean
  pullToRefreshEnabled?: boolean
  textZoom?: number
  scriptOnStart?: string
  /* One entry per user script: each is injected on its own so a malformed
   * script cannot break the others or the content bundle. */
  userScriptsOnStart?: string[]
  onLoad?: React.ReactEventHandler<HTMLWebViewElement>
  onMessage?: React.ReactEventHandler<HTMLWebViewElement>
}


const TubeView = forwardRef<WebviewTagElement, TubeViewProps>(
  function TubeView(props) {
    const webviewRef = useRef<WebviewTagElement>(null);
    const [initialSrc] = useState(
    () => props.src?.trim() || "https://www.youtube.com"
    );

    useEffect(() => {
      const webview = webviewRef.current;
      if (!webview) return;

      const onDomReady = () => {
        const settings = useSettingsStore.getState();

        webview.executeJavascript(`
        window.isAndroid = false;
        window.StreamablesInitialSettings = ${JSON.stringify(settings)};
        window.StreamablesPreferH264 = ${JSON.stringify(
          settings.preferH264 ? "Yes" : "No"
        )};

        ${main}
      `);
      };

      const onHostMessage = (event: CustomEvent) => {
        const message = event.detail;

        const navigate = props.navigate;

        if (message.type == "video-selected") {
          if (typeof message.watchId !== "string" || typeof message.watchUrl !== "string") return;

          navigate({ to: "Player", params: { watchId: message.watchId, watchUrl: message.watchUrl } });
        }

        if (message.type == "page-navigated") {
          if (
            !message.states ||
            typeof message.states !== "object" ||
            Array.isArray(message.states)
          ) {
            return;
          }
          
          navigate({
            to: "Tubeview",
            params: { ...message.states },
          });
        }
      };

      webview.on("dom-ready", onDomReady);
      webview.on("host-message", onHostMessage);

      return () => {
        webview.off("dom-ready", onDomReady);
        webview.off("host-message", onHostMessage);
      };
    }, []);

    return <electrobun-webview src={initialSrc} ref={webviewRef} />;
  }
);

export default TubeView;