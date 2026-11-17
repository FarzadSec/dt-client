import { memo, useEffect, useRef, useState } from 'react';

import worldSvg from '../geo/world.svg?raw';

export interface MapMarker {
  key: string;
  x: number;
  y: number;
  kind: 'server' | 'selected' | 'connected';
}

const zoom = 2.3;

// Drawn once: the land never changes, only the transform of its wrapper does.
const Land = memo(function Land() {
  return <div className="map-land" dangerouslySetInnerHTML={{ __html: worldSvg }} />;
});

// Keeps the focus at a fixed spot of the frame, clamped so the map never shows its edge.
function placement(frame: { w: number; h: number }, focus: { x: number; y: number }, anchorX: number) {
  const w = frame.w * zoom;
  const h = w * (663 / 1000);
  const tx = Math.min(0, Math.max(frame.w - w, frame.w * anchorX - focus.x * w));
  const ty = Math.min(0, Math.max(frame.h - h, frame.h * 0.5 - focus.y * h));
  return { tx, ty, w, h };
}

export function WorldMap({ markers, focus, rtl }: { markers: MapMarker[]; focus: { x: number; y: number }; rtl: boolean }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ w: 900, h: 380 });

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setFrame({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { tx, ty, w, h } = placement(frame, focus, rtl ? 0.36 : 0.64);

  return (
    <div className="map-frame" ref={frameRef}>
      <div className="map-world" style={{ width: w, height: h, transform: `translate3d(${tx}px, ${ty}px, 0)` }}>
        <Land />
        {markers.map((m) => (
          <span key={m.key} className={`map-dot ${m.kind}`} style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }} />
        ))}
      </div>
    </div>
  );
}
