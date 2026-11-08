import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';


import { useEffect, useRef, useCallback, useState, RefObject } from 'react';
import '@videojs/react/video/skin.css';
import { VideoPlayer, VideoSkin } from '@videojs/react/video';
import { HlsJsVideo } from '@videojs/react/media/hlsjs-video';
import { Selection } from '../Selection';
import { MAX_FRAMES, TARGET_CELL_WIDTH } from '../../types';
import { useTrimRangeStore } from '../Selection'; // adjust the path to where Selection.tsx lives
async function resolveVideoFromServer(videoId: string) {
    const res = await fetch(
        `http://127.0.0.1:4317/resolve?id=${encodeURIComponent(videoId)}`,
    );
    if (!res.ok) {
        throw new Error(`resolve failed: ${res.status} ${await res.text()}`);
    }
    const streams = await res.json();
    return streams[0];
}

const SPEEDS = [0.5, 1, 1.25, 1.5, 1.75, 2];

const formatShort = (t: number) => {
    if (!isFinite(t)) return '00:00';
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${String(h).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
};

function useVideoState(playerRef: RefObject<HTMLVideoElement>) {
    // Track the element itself in state so we re-subscribe if it mounts later or changes.
    const [video, setVideo] = useState<HTMLVideoElement | null>(null);
    useEffect(() => {
        if (playerRef.current !== video) setVideo(playerRef.current);
    });

    const [state, setState] = useState({
        isPlaying: false,
        currentTime: 0,
        volume: 1,
        muted: false,
        speed: 1,
        hasCaptions: false,
        ccOn: false,
    });

    useEffect(() => {
        if (!video) return;

        // Read everything from the element: it is the single source of truth.
        const sync = () => {
            const track = video.textTracks[0];
            setState({
                isPlaying: !video.paused && !video.ended,
                currentTime: video.currentTime,
                volume: video.volume,
                muted: video.muted,
                speed: video.playbackRate,
                hasCaptions: video.textTracks.length > 0,
                ccOn: track ? track.mode === 'showing' : false,
            });
        };

        sync(); // initial sync

        const events = [
            'play', 'pause', 'ended', 'timeupdate', 'seeked',
            'volumechange', 'ratechange', 'loadedmetadata', 'emptied',
        ] as const;
        events.forEach((e) => video.addEventListener(e, sync));
        video.textTracks.addEventListener('addtrack', sync);
        video.textTracks.addEventListener('removetrack', sync);
        video.textTracks.addEventListener('change', sync);

        return () => {
            events.forEach((e) => video.removeEventListener(e, sync));
            video.textTracks.removeEventListener('addtrack', sync);
            video.textTracks.removeEventListener('removetrack', sync);
            video.textTracks.removeEventListener('change', sync);
        };
    }, [video]);

    return { video, ...state };
}

const iconBtn: React.CSSProperties = {
    background: 'transparent', border: 'none', padding: 8,
    cursor: 'pointer', color: '#111', display: 'flex', alignItems: 'center',
};

const selectStyle: React.CSSProperties = {
    background: 'transparent', border: 'none', font: 'inherit', fontSize: '13px',
    fontWeight: 600, cursor: 'pointer', padding: '8px 4px',
};

function PlayerControls({ playerRef, containerRef, duration, qualityLabel }: {
    playerRef: RefObject<HTMLVideoElement>;
    containerRef: RefObject<HTMLDivElement | null>;
    duration: number;
    qualityLabel: string;
}) {
    const { video, isPlaying, currentTime, volume, muted, speed, hasCaptions, ccOn } =
        useVideoState(playerRef);

    const togglePlay = () => {
        if (!video) return;
        if (video.paused) video.play().catch(() => { }); // play() returns a promise that can reject
        else video.pause();
    };

    const toggleCaptions = () => {
        const track = video?.textTracks[0];
        if (!track) return;
        track.mode = track.mode === 'showing' ? 'hidden' : 'showing';
    };

    const toggleFullscreen = () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else containerRef.current?.requestFullscreen();
    };

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, height: 56, padding: '0 16px', background: '#fff', color: '#111', fontSize: 15, fontWeight: 500 }}>
            <button type="button" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={togglePlay} style={iconBtn}>
                {isPlaying ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
                ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                )}
            </button>

            <select
                aria-label="Kecepatan"
                value={speed}
                onChange={(e) => { if (video) video.playbackRate = Number(e.target.value); }}
                style={{ ...selectStyle, appearance: 'none' }}
            >
                {SPEEDS.map((v) => (
                    <option key={v} value={v}>{v}x</option>
                ))}
            </select>

            <button type="button" aria-label={muted ? 'Unmute' : 'Mute'}
                onClick={() => { if (video) video.muted = !video.muted; }} style={iconBtn}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z" opacity={muted || volume === 0 ? 0.4 : 1} />
                </svg>
            </button>


            <div style={{ flex: 1, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                {formatShort(currentTime)} / {formatShort(duration)}
            </div>

            <select aria-label="Kualitas" value={qualityLabel} onChange={() => { }} style={selectStyle}>
                <option value={qualityLabel}>{qualityLabel}</option>
            </select>

            <button type="button" aria-label="Fullscreen" onClick={toggleFullscreen} style={iconBtn}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
            </button>
        </div>
    );
}


function Playhead({ playerRef }: { playerRef: RefObject<HTMLVideoElement> }) {
    const trackRef = useRef<HTMLDivElement>(null);
    const rafRef = useRef(0);
    const draggingRef = useRef(false);

    useEffect(() => {
        const player = playerRef.current, track = trackRef.current;
        if (!player || !track) return;
        const parent = track.parentElement!;

        const render = () => {
            if (!(player.duration > 0)) return;
            const x = (player.currentTime / player.duration) * parent.clientWidth;
            track.style.setProperty('--position-x', `${x - 16}px`);
            track.setAttribute('aria-valuemax', String(player.duration));
            track.setAttribute('aria-valuenow', String(player.currentTime));
        };

        const loop = () => {
            render();
            rafRef.current = requestAnimationFrame(loop);
        };
        const start = () => {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(loop);
        };
        const stop = () => {
            cancelAnimationFrame(rafRef.current);
            render(); // final position when paused/ended
        };

        // paused seeks and metadata also need a redraw
        const redraw = () => render();

        player.addEventListener('play', start);
        player.addEventListener('pause', stop);
        player.addEventListener('ended', stop);
        player.addEventListener('seeked', redraw);
        player.addEventListener('seeking', redraw);
        player.addEventListener('loadedmetadata', redraw);
        window.addEventListener('resize', redraw);

        render();
        if (!player.paused) start();

        return () => {
            cancelAnimationFrame(rafRef.current);
            player.removeEventListener('play', start);
            player.removeEventListener('pause', stop);
            player.removeEventListener('ended', stop);
            player.removeEventListener('seeked', redraw);
            player.removeEventListener('seeking', redraw);
            player.removeEventListener('loadedmetadata', redraw);
            window.removeEventListener('resize', redraw);
        };
    });

    const seekFromClientX = (clientX: number) => {
        const player = playerRef.current, track = trackRef.current;
        if (!player || !track || !(player.duration > 0)) return;
        const rect = track.parentElement!.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        let time = ratio * player.duration;

        // keep the playhead inside the selected range
        const { startRange, endRange } = useTrimRangeStore.getState();
        time = Math.min(endRange, Math.max(startRange, time));

        player.currentTime = time;
    };

    return (
        <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="Waktu saat ini"
            aria-valuemin={0}
            aria-valuemax={0}
            onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                draggingRef.current = true;
                seekFromClientX(e.clientX);
            }}
            onPointerMove={(e) => {
                if (draggingRef.current) seekFromClientX(e.clientX);
            }}
            onPointerUp={(e) => {
                draggingRef.current = false;
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                    e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => { draggingRef.current = false; }}
            style={{
                position: 'absolute', top: 0, height: '100%',
                marginLeft: 16,
                padding: '0 16px', paddingLeft: 0,
                cursor: 'grab',
                pointerEvents: 'auto',   // parent wrapper is pointer-events: none
                touchAction: 'none',
                transform: 'translateX(var(--position-x))',
                '--position-x': '-16px',
            } as React.CSSProperties}
        >
            <div style={{ zIndex: 10, background: 'rgb(229, 230, 231)', width: 3, height: '100%', position: 'absolute' }} />
        </div>
    );
}

function createMergedHlsUrl(videoUrl: string, audioUrl: string | undefined, height: number) {
  if (!audioUrl) return videoUrl;
  const width = Math.round((height * 16) / 9);
  const playlist = [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="audio",DEFAULT=YES,AUTOSELECT=YES,URI="${audioUrl}"`,
    `#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=${width}x${height},AUDIO="aud"`,
    videoUrl,
  ].join('\n');
  return URL.createObjectURL(new Blob([playlist], { type: 'application/vnd.apple.mpegurl' }));
}

export function Player({
    watchId,
    watchUrl
}: {
    watchId: string,
    watchUrl: string
}) {
    /**
     * 
     */
    const hlsPlayerRef = useRef<HTMLVideoElement>(null);
    const playerContainerRef = useRef<HTMLDivElement>(null);
    const blobUrlRef = useRef<string | null>(null);
    const [streamHeight, setStreamHeight] = useState(0);

    // di getStream(), setelah const stream = await resolveVideoFromServer(watchId);

    const [duration, setDuration] = useState(0);

    const [stream, setStream] = useState("")
    const [imgSprite, setImgSprite] = useState<string>("");
    /**
     * These refs, states, functions are for trimming + range selector element functionalities.
     * 
     */

    const hiddenVideoRef = useRef<HTMLVideoElement>(null);

    const createFramesSpritesheet = useCallback(async (
        canvasSpriteSheet: HTMLCanvasElement,
        tempCanvasSpriteSheet: HTMLCanvasElement
    ) => {
        const hiddenVideo = hiddenVideoRef.current;
        if (!hiddenVideo) return;

        const duration = hiddenVideoRef.current.duration;

        const timestamps = Array.from(
            { length: MAX_FRAMES },
            (_, i) => (duration * (i + 0.5)) / MAX_FRAMES,
        );

        const rows = 4, cols = 6;
        const clsWidth = canvasSpriteSheet.width / cols, clsHeight = canvasSpriteSheet.height / rows; //cls as in "cells"
        const s = Math.max(clsWidth / hiddenVideo.videoWidth, clsHeight / hiddenVideo.videoHeight);
        const sW = hiddenVideo.videoWidth * s, sH = hiddenVideo.videoHeight * s;

        for (let index = 0; index < timestamps.length; index++) {
            hiddenVideo.currentTime = timestamps[index];
            await waitToSeek(hiddenVideo);
            const col = index % cols, row = Math.floor(index / cols);

            const x = col * clsWidth, y = row * clsHeight;

            const tempCanvasContext = tempCanvasSpriteSheet.getContext('2d');
            if (!tempCanvasContext) return;

            tempCanvasContext.drawImage(
                hiddenVideo,
                (clsWidth - sW) / 2,
                (clsHeight - sH) / 2,
                sW,
                sH,
            );

            const width = Math.max(
                0,
                Math.min(clsWidth, canvasSpriteSheet.width - x),
            ), height = Math.max(
                0,
                Math.min(clsHeight, canvasSpriteSheet.height - y),
            );

            const canvasContext = canvasSpriteSheet.getContext('2d');
            if (!canvasContext) return;

            canvasContext.drawImage(tempCanvasSpriteSheet, x, y, width, height)

        }
    }, [])

    const waitToSeek = (video: HTMLVideoElement) =>
        new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                video.removeEventListener('seeked', onSeeked);
                reject(new Error('seek timeout'));
            }, 10000);
            const onSeeked = () => {
                clearTimeout(timeout);
                resolve();
            };
            video.addEventListener('seeked', onSeeked, { once: true });
        });

    /** effects */
    useEffect(() => {
        console.log(watchId, watchUrl)
    }, [watchId, watchUrl])

    useEffect(() => {
        const hlsPlayer = hlsPlayerRef.current, hiddenVideo = hiddenVideoRef.current;
        if (!hlsPlayer) return;

        
        const onSourceReady = async () => {
            setDuration(hlsPlayer.duration)
            console.log("video player ready, on source also ready");
        }

        hlsPlayer.addEventListener('loadeddata', onSourceReady, { once: true })

        const onHiddenSourceReady = async () => {
            const canvasSpritesheet = document.createElement("canvas"), tempCanvasSpritesheet = document.createElement("canvas");
            canvasSpritesheet.width = 1284;
            canvasSpritesheet.height = 576;
            tempCanvasSpritesheet.width = 214;
            tempCanvasSpritesheet.height = 144;

            await createFramesSpritesheet(canvasSpritesheet, tempCanvasSpritesheet);

            canvasSpritesheet.toBlob(
                (blob) => {
                    if (!blob) return;
                    const url = URL.createObjectURL(blob);
                    setImgSprite((prev) => {
                        if (prev) URL.revokeObjectURL(prev);
                        return url;
                    });
                },
                'image/jpeg',
                0.85,
            );

        }

        if (hiddenVideo) {
            console.log({
                readyState: hiddenVideo.readyState,
                networkState: hiddenVideo.networkState,
                currentSrc: hiddenVideo.currentSrc,
                src: hiddenVideo.src,
            });

            hiddenVideo.addEventListener('loadeddata', onHiddenSourceReady, { once: true });
        }

        return () => {
            if (hiddenVideo) {
                hiddenVideo.removeEventListener('loadeddata', onHiddenSourceReady)
            }
        }

    }, [stream]);

    useEffect(() => {
  let cancelled = false;

  async function getStream() {
    const stream = await resolveVideoFromServer(watchId);
    if (cancelled) return;

    setStreamHeight(stream.height ?? 0);

    const proxy = (u: string) =>
      `http://127.0.0.1:4317/proxy?url=${encodeURIComponent(u)}`;

    const merged = createMergedHlsUrl(
      proxy(stream.url),
      stream.audioUrl ? proxy(stream.audioUrl) : undefined,
      stream.height ?? 1080,
    );

    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    blobUrlRef.current = merged.startsWith('blob:') ? merged : null;
    setStream(merged);
  }

  getStream();
  return () => { cancelled = true; };
}, [watchId]);

    return (
        <div className="player-container" ref={playerContainerRef}>
            <div
                style={{
                    width: '100%',
                    height: 340,             // give the grey area a real height
                    marginBottom: "1rem",
                    background: '#808080',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                }}
            >
                <VideoPlayer>
                    <div
                        style={{
                            height: '100%',
                            aspectRatio: '16 / 9',   // width is derived from the height
                            background: '#000',
                            flexShrink: 1,
                            minWidth: 0,
                        }}
                    >
                        <HlsJsVideo
                            key={stream}
                            src={stream}
                            ref={hlsPlayerRef}
                            playsInline
                            controls={false}
                            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                        />
                    </div>
                </VideoPlayer>
            </div>
            <div>

                <Selection
                    playhead={stream ? <Playhead playerRef={hlsPlayerRef} /> : null}
                    duration={duration}
                    imgSprite={imgSprite}
                    onSeek={(t) => {
                        const v = hlsPlayerRef.current;
                        if (v) v.currentTime = t;
                    }}
                >
                </Selection>
                <PlayerControls
                    playerRef={hlsPlayerRef}
                    containerRef={playerContainerRef}
                    duration={duration}
                    qualityLabel={streamHeight > 0 ? `${streamHeight}p` : 'Auto'}
                />
            </div>
            <HlsJsVideo
                ref={hiddenVideoRef}

                src={stream}
                muted
                playsInline
                preload="auto"
                style={{
                    position: 'absolute',
                    left: '-9999px',
                    width: '160px',
                    height: '90px',
                    opacity: 0,
                    pointerEvents: 'none',
                }}
            />
        </div>
    )
}