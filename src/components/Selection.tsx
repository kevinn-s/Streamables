import { useEffect, useRef, useCallback, useLayoutEffect, useState, RefObject, ReactNode } from 'react';

import { create } from 'zustand';
import { CAP_WIDTH, MIN_GAP, PINK, MAX_FRAMES, TARGET_CELL_WIDTH } from '../types';

type TrimRangeState = {
  startRange: number;
  endRange: number;
  duration: number;
  setDuration: (duration: number) => void;
  setStartRange: (value: number) => void;
  setEndRange: (value: number) => void;
  setRange: (start: number, end: number) => void;
  moveRange: (delta: number) => void;
  resetRange: () => void;
};

export const useTrimRangeStore = create<TrimRangeState>()((set) => ({
  startRange: 0,
  endRange: 0,
  duration: 0,

  setDuration: (duration) =>
    set((state) => {
      // pertama kali video ke-load, endRange masih 0, jadi isi penuh
      const endRange =
        state.endRange === 0 || state.endRange > duration
          ? duration
          : state.endRange;
      const startRange = Math.min(
        state.startRange,
        Math.max(0, endRange - MIN_GAP),
      );
      return { duration, startRange, endRange };
    }),

  setStartRange: (value) =>
    set((state) => ({
      startRange: Math.max(
        0,
        Math.min(value, state.endRange - MIN_GAP),
      ),
    })),

  setEndRange: (value) =>
    set((state) => ({
      endRange: Math.min(
        state.duration > 0 ? state.duration : value,
        Math.max(value, state.startRange + MIN_GAP),
      ),
    })),

  setRange: (start, end) =>
    set((state) => {
      let nextStart = Math.max(0, start);
      let nextEnd =
        state.duration > 0 ? Math.min(end, state.duration) : end;
      if (nextEnd - nextStart < MIN_GAP) {
        nextEnd = nextStart + MIN_GAP;
      }
      if (state.duration > 0 && nextEnd > state.duration) {
        nextEnd = state.duration;
        nextStart = Math.max(nextEnd, nextEnd - MIN_GAP);
      }
      return { startRange: nextStart, endRange: nextEnd };
    }),

  moveRange: (delta) =>
    set((state) => {
      const length = state.endRange - state.startRange;
      if (length <= 0 || state.duration <= 0) return state;
      const nextStart = Math.max(
        0,
        Math.min(state.startRange + delta, state.duration - length),
      );
      return { startRange: nextStart, endRange: nextStart + length };
    }),

  resetRange: () =>
    set((state) => ({ startRange: 0, endRange: state.duration })),
}));


const formatTime = (t: number) => {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60),
    s = Math.floor(t % 60);

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const WhiteLine = () => (
  <svg style={{ height: '60%', width: 4, display: 'block' }} viewBox="0 0 4 100" preserveAspectRatio="none" aria-hidden="true">
    <line x1="2" y1="4" x2="2" y2="96" stroke="#fff" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
  </svg>
);


export const Selection = (props: {
  imgSprite: string;

  playhead: ReactNode;
  duration: number;
  onSeek?: (time: number) => void;
}) => {
  const {
    startRange,
    endRange,
    duration,
    setStartRange,
    setEndRange,
    setDuration,
    moveRange,
  } = useTrimRangeStore();
  const [stripWidth, setStripWidth] = useState(0);
  const stripElementRef = useRef<HTMLDivElement>(null);
  const leftDrag = useRef(false);
  const rightDrag = useRef(false);
  const buttonDrag = useRef<number | null>(null);
  const buttonDownX = useRef(0);
  const buttonMoved = useRef(false);
  const numFrames = stripWidth > 0
    ? Math.max(6, Math.min(MAX_FRAMES, Math.round(stripWidth / TARGET_CELL_WIDTH)))
    : MAX_FRAMES;
  useEffect(() => {
    if (!stripElementRef.current) return;
    const observer = new ResizeObserver((entries) => {
      setStripWidth(entries[0].contentRect.width);
    });
    observer.observe(stripElementRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setDuration(props.duration);
  }, [props.duration, setDuration]);
  // Posisi di dalam strip, 0 = awal strip
  const p1x = duration > 0 ? (startRange / duration) * stripWidth : 0;
  const p2x = duration > 0 ? (endRange / duration) * stripWidth : 0;
  // Posisi di timeline wrapper. Strip di tengah dengan margin
  // CAP_WIDTH kiri dan kanan, jadi semua posisi timeline = posisi
  // strip + CAP_WIDTH.
  const stripLeft = CAP_WIDTH;
  const frameStartX = stripLeft + p1x;
  const frameEndX = stripLeft + p2x;
  const leftCapX = frameStartX - CAP_WIDTH;
  const rightCapX = frameEndX;
  const selectionWidth = frameEndX - frameStartX;
  const timeFromClientX = (clientX: number) => {
    const rect = stripElementRef.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return null;
    return ((clientX - rect.left) / rect.width) * duration;
  };
  const releaseCapture = (
    e: React.PointerEvent<HTMLElement>,
  ) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const leftPillRef = useRef<HTMLDivElement>(null);
  const rightPillRef = useRef<HTMLDivElement>(null);
  const [leftPillWidth, setLeftPillWidth] = useState(0);
  const [rightPillWidth, setRightPillWidth] = useState(0);

  // Ukur lebar pill yang sebenarnya, karena teks waktunya berubah.
  // Pakai useLayoutEffect supaya tidak kedip satu frame.
  useLayoutEffect(() => {
    if (leftPillRef.current) {
      setLeftPillWidth(leftPillRef.current.offsetWidth);
    }
    if (rightPillRef.current) {
      setRightPillWidth(rightPillRef.current.offsetWidth);
    }
  }, [startRange, endRange]);

  const containerWidth = stripWidth + CAP_WIDTH * 2;
  const leftHalf = leftPillWidth / 2;
  const rightHalf = rightPillWidth / 2;

  // Pill kiri: baru ikutin handle kalau handle sudah sampai
  // di tengah pill, atau lebih. Sebelum itu, pill diam di tepi kiri.
  const leftPillLeft = frameStartX >= leftHalf ? frameStartX - leftHalf : 0;

  // Pill kanan: sama, tapi dari kanan.
  // rightDistance = jarak handle kanan ke tepi kanan container.
  const rightDistance = containerWidth - frameEndX;
  const rightPillRight = rightDistance >= rightHalf ? rightDistance - rightHalf : 0;

  return (
    <div style={{ position: 'relative', width: '100%', overflow: 'hidden' }}>


      <div style={{ position: 'relative', width: '100%', overflow: 'hidden' }}>
        <div
          ref={stripElementRef}
          style={{
            display: 'flex',
            width: `calc(100% - ${CAP_WIDTH * 2}px)`,
            margin: '0 auto',
            overflow: 'hidden',
            borderRadius: 8,
          }}
        >

          {Array.from({ length: numFrames }, (_, i) => {
            const spriteIndex = numFrames === 1
              ? 0
              : Math.round(i * (MAX_FRAMES - 1) / (numFrames - 1));
            const col = spriteIndex % 6;
            const row = Math.floor(spriteIndex / 6);

            return (
              <div key={i} style={{ flex: '1 0 0', minWidth: 0, aspectRatio: '214/144', position: 'relative', overflow: 'hidden' }}>
                {props.imgSprite !== '' && (
                  <img
                    src={props.imgSprite}
                    draggable={false}
                    style={{ position: 'absolute', width: '600%', height: '400%', left: `${-col * 100}%`, top: `${-row * 100}%` }}
                  />
                )}
              </div>
            );
          })}
        </div>
        {/* Dark kiri: dari awal strip sampai awal frame terpilih */}
        <div style={{ position: 'absolute', left: stripLeft, top: 0, bottom: 0, width: p1x, background: '#000', opacity: 0.75, pointerEvents: 'none' }} />
        {/* Dark kanan: dari akhir frame terpilih sampai akhir strip */}
        <div style={{ position: 'absolute', left: frameEndX, top: 0, bottom: 0, width: stripWidth - p2x, background: '#000', opacity: 0.75, pointerEvents: 'none' }} />
        {/* Garis pink atas/bawah, di antara dua cap */}
        <div style={{ position: 'absolute', left: frameStartX, width: selectionWidth, top: 0, height: 3, background: PINK, pointerEvents: 'none', zIndex: 2 }} />
        <div style={{ position: 'absolute', left: frameStartX, width: selectionWidth, bottom: 0, height: 3, background: PINK, pointerEvents: 'none', zIndex: 2 }} />
        <button
          type="button" role="slider" tabIndex={0} aria-label="Posisi pemangkasan" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={startRange} aria-valuetext={formatTime(startRange)}
          style={{ position: 'absolute', left: frameStartX, width: selectionWidth, top: 0, bottom: 0, background: 'transparent', border: 'none', padding: 0, cursor: 'grab', zIndex: 3 }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            buttonDrag.current = e.clientX;
            buttonDownX.current = e.clientX;
            buttonMoved.current = false;
          }}
          onPointerMove={(e) => {
            if (buttonDrag.current === null) return;
            if (!buttonMoved.current && Math.abs(e.clientX - buttonDownX.current) < 4) return;
            buttonMoved.current = true;

            const rect = stripElementRef.current?.getBoundingClientRect();
            if (!rect || duration <= 0) return;
            moveRange(((e.clientX - buttonDrag.current) / rect.width) * duration);
            buttonDrag.current = e.clientX;
          }}
          onPointerUp={(e) => {
            if (buttonDrag.current !== null && !buttonMoved.current) {
              const time = timeFromClientX(e.clientX);
              if (time !== null) props.onSeek?.(time);   // it was a click, so seek
            }
            buttonDrag.current = null;
            buttonMoved.current = false;
            releaseCapture(e);
          }}
          onPointerCancel={(e) => {
            buttonDrag.current = null;
            buttonMoved.current = false;
            releaseCapture(e);
          }}
        />
        <input type="range" min={0} max={duration} step={0.01} value={startRange} aria-label="Pemangkasan, awal tepian" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={startRange} aria-valuetext={formatTime(startRange)}
          style={{ position: 'absolute', left: leftCapX, right: 0, top: 0, bottom: 0, opacity: 0, pointerEvents: 'none' }} />
        <input type="range" min={0} max={duration} step={0.01} value={endRange} aria-label="Pemangkasan, akhir tepian" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={endRange} aria-valuetext={formatTime(endRange)}
          style={{ position: 'absolute', left: 0, width: rightCapX + CAP_WIDTH, top: 0, bottom: 0, opacity: 0, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, pointerEvents: 'none' }}>
          <div
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: CAP_WIDTH, transform: `translateX(${leftCapX}px)`, background: PINK, borderRadius: '12px 0 0 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'ew-resize', pointerEvents: 'auto', zIndex: 5 }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              leftDrag.current = true;
            }}
            onPointerMove={(e) => {
              if (!leftDrag.current) return;
              const time = timeFromClientX(e.clientX);
              if (time !== null) setStartRange(time);
            }}
            onPointerUp={(e) => {
              leftDrag.current = false;
              releaseCapture(e);
            }}
            onPointerCancel={(e) => {
              leftDrag.current = false;
              releaseCapture(e);
            }}
          >
            <WhiteLine />
          </div>
        </div>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, pointerEvents: 'none' }}>
          <div
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: CAP_WIDTH, transform: `translateX(${rightCapX}px)`, background: PINK, borderRadius: '0 12px 12px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'ew-resize', pointerEvents: 'auto', zIndex: 5 }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              rightDrag.current = true;
            }}
            onPointerMove={(e) => {
              if (!rightDrag.current) return;
              const time = timeFromClientX(e.clientX);
              if (time !== null) setEndRange(time);
            }}
            onPointerUp={(e) => {
              rightDrag.current = false;
              releaseCapture(e);
            }}
            onPointerCancel={(e) => {
              rightDrag.current = false;
              releaseCapture(e);
            }}
          >
            <WhiteLine />
          </div>
        </div>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: CAP_WIDTH, width: `calc(100% - ${CAP_WIDTH * 2}px)`, pointerEvents: 'none', zIndex: 10 }}>
          {props.playhead}
        </div>
      </div>

      <div style={{ position: 'relative', height: 28, marginBottom: 4 }}>
        <div
          ref={leftPillRef}
          style={{ position: 'absolute', left: leftPillLeft, background: '#f1f1f4', color: '#333', borderRadius: 999, padding: '6px 12px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}
        >
          {formatTime(startRange)}
        </div>
        <div
          ref={rightPillRef}
          style={{ position: 'absolute', right: rightPillRight, background: '#f1f1f4', color: '#333', borderRadius: 999, padding: '6px 12px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}
        >
          {formatTime(endRange)}
        </div>
      </div>
    </div>
  );
};

