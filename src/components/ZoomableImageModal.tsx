import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';

interface ZoomableImageModalProps {
  imageSrc: string | null | undefined;
  onClose: () => void;
  alt: string;
  title?: string;
  description?: string;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;
// Customer receipts are often examined on a phone. A slightly amplified drag
// avoids the slow, heavy feeling of a literal one-to-one movement.
const PAN_SENSITIVITY = 1.55;
const PINCH_ZOOM_SENSITIVITY = 1.12;
const WHEEL_ZOOM_SENSITIVITY = 0.0035;

type Point = { x: number; y: number };

const distanceBetween = (first: Point, second: Point): number => {
  return Math.hypot(second.x - first.x, second.y - first.y);
};

/**
 * Shared image viewer for customer uploads. It batches transform work in the
 * animation frame and writes it directly to the image layer, so high-resolution
 * Telegram receipts remain responsive while dragging, zooming, or pinching.
 */
export const ZoomableImageModal: React.FC<ZoomableImageModalProps> = ({
  imageSrc,
  onClose,
  alt,
  title = 'مشاهده تصویر',
  description,
}) => {
  // `zoom` is intentionally only the compact UI display state. Pan and the
  // actual transform stay in refs; changing them does not re-render the whole
  // modal for every pointer event.
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef<Point>({ x: 0, y: 0 });
  const transformFrame = useRef<number | null>(null);
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const activePointers = useRef(new Map<number, Point>());
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);

  const applyTransform = () => {
    const image = imageRef.current;
    if (!image) return;
    const { x, y } = panRef.current;
    image.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${zoomRef.current})`;
  };

  const scheduleTransform = () => {
    if (transformFrame.current !== null) return;
    transformFrame.current = window.requestAnimationFrame(() => {
      transformFrame.current = null;
      applyTransform();
      // React skips this update while only pan has changed, so the UI does not
      // compete with the compositor during a drag.
      setZoom(zoomRef.current);
    });
  };

  const updatePan = (nextPan: Point) => {
    panRef.current = nextPan;
    scheduleTransform();
  };

  const setZoomLevel = (nextZoom: number) => {
    const clampedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    zoomRef.current = clampedZoom;
    if (clampedZoom <= 1) panRef.current = { x: 0, y: 0 };
    scheduleTransform();
  };

  const resetView = () => {
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    dragStart.current = null;
    pinchStart.current = null;
    setIsDragging(false);
    applyTransform();
    setZoom(1);
  };

  const zoomBy = (amount: number) => setZoomLevel(zoomRef.current + amount);

  useEffect(() => {
    activePointers.current.clear();
    resetView();
  }, [imageSrc]);

  useEffect(() => () => {
    if (transformFrame.current !== null) {
      window.cancelAnimationFrame(transformFrame.current);
      transformFrame.current = null;
    }
  }, []);

  useEffect(() => {
    if (!imageSrc) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomBy(ZOOM_STEP);
      } else if (event.key === '-') {
        event.preventDefault();
        zoomBy(-ZOOM_STEP);
      } else if (event.key === '0') {
        event.preventDefault();
        resetView();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [imageSrc, onClose]);

  if (!imageSrc) return null;

  const updatePinchStart = () => {
    const pointers = [...activePointers.current.values()];
    if (pointers.length !== 2) return;
    pinchStart.current = {
      distance: distanceBetween(pointers[0], pointers[1]),
      zoom: zoomRef.current,
    };
    dragStart.current = null;
    setIsDragging(false);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.current.size === 2) {
      updatePinchStart();
      return;
    }

    if (zoomRef.current <= 1) return;
    dragStart.current = {
      x: event.clientX,
      y: event.clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!activePointers.current.has(event.pointerId)) return;

    // Browsers may coalesce many pen/touch points into one React event. Taking
    // the newest point keeps the viewer attached to the user's finger/mouse.
    const nativeEvent = event.nativeEvent;
    const coalescedEvents = typeof nativeEvent.getCoalescedEvents === 'function'
      ? nativeEvent.getCoalescedEvents()
      : [nativeEvent];
    const latestEvent = coalescedEvents[coalescedEvents.length - 1] || nativeEvent;
    activePointers.current.set(event.pointerId, { x: latestEvent.clientX, y: latestEvent.clientY });

    const pointers = [...activePointers.current.values()];
    if (pointers.length >= 2 && pinchStart.current) {
      event.preventDefault();
      const distance = distanceBetween(pointers[0], pointers[1]);
      if (pinchStart.current.distance > 0) {
        const ratio = distance / pinchStart.current.distance;
        setZoomLevel(pinchStart.current.zoom * Math.pow(ratio, PINCH_ZOOM_SENSITIVITY));
      }
      return;
    }

    if (!dragStart.current) return;
    event.preventDefault();
    updatePan({
      x: dragStart.current.panX + (latestEvent.clientX - dragStart.current.x) * PAN_SENSITIVITY,
      y: dragStart.current.panY + (latestEvent.clientY - dragStart.current.y) * PAN_SENSITIVITY,
    });
  };

  const finishPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    activePointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (activePointers.current.size < 2) pinchStart.current = null;
    if (activePointers.current.size === 0) {
      dragStart.current = null;
      setIsDragging(false);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    // A higher factor makes trackpad/wheel inspection feel responsive without
    // making individual wheel ticks jump past small receipt details.
    const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
    setZoomLevel(zoomRef.current * factor);
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 p-3 sm:p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex h-[min(90vh,820px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-3 py-3 sm:px-4">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-white">{title}</h3>
            {description && <p className="mt-0.5 text-[11px] text-slate-400">{description}</p>}
          </div>

          <div className="flex items-center gap-1.5" dir="ltr">
            <button
              type="button"
              onClick={() => zoomBy(-ZOOM_STEP)}
              disabled={zoom <= MIN_ZOOM}
              className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Zoom out"
              title="کوچک‌نمایی"
            >
              <ZoomOut className="h-4 w-4" />
              <span className="hidden text-xs sm:inline">−</span>
            </button>
            <span className="min-w-14 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-center text-xs font-bold text-amber-300">
              {Math.round(zoom * 100)}٪
            </span>
            <button
              type="button"
              onClick={() => zoomBy(ZOOM_STEP)}
              disabled={zoom >= MAX_ZOOM}
              className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Zoom in"
              title="بزرگ‌نمایی"
            >
              <ZoomIn className="h-4 w-4" />
              <span className="hidden text-xs sm:inline">+</span>
            </button>
            <button
              type="button"
              onClick={resetView}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 px-2 text-slate-300 transition hover:bg-slate-700 hover:text-white"
              aria-label="Reset zoom"
              title="بازنشانی زوم"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 px-2 text-slate-300 transition hover:bg-rose-950 hover:text-rose-200"
              aria-label="Close image viewer"
              title="بستن"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div
          className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,_rgba(51,65,85,0.45),_rgba(2,6,23,0.98))] p-4 sm:p-8 ${zoom > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
          onLostPointerCapture={finishPointer}
          onWheel={handleWheel}
          // Disable browser page gestures here so a two-finger pinch controls
          // the image, not the entire page.
          style={{ touchAction: 'none' }}
        >
          <img
            ref={imageRef}
            src={imageSrc}
            alt={alt}
            draggable={false}
            className="max-h-full max-w-full select-none object-contain shadow-2xl transform-gpu"
            style={{
              transformOrigin: 'center center',
              willChange: 'transform',
            }}
            referrerPolicy="no-referrer"
          />
        </div>

        <footer className="flex flex-col-reverse items-center justify-between gap-2 border-t border-slate-800 bg-slate-900 px-3 py-2.5 sm:flex-row sm:px-4">
          <p className="text-center text-[11px] text-slate-400 sm:text-right">
            با چرخ ماوس/ترک‌پد یا نیشگون دو انگشت زوم کنید؛ در حالت بزرگ‌نمایی، تصویر را سریع‌تر بکشید.
          </p>
          <a
            href={imageSrc}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-sky-300 transition hover:bg-slate-800 hover:text-sky-200"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            باز کردن اندازه اصلی
          </a>
        </footer>
      </section>
    </div>
  );
};
