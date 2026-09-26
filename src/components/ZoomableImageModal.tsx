import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';

interface ZoomableImageModalProps {
  imageSrc: string | null | undefined;
  onClose: () => void;
  alt: string;
  title?: string;
  description?: string;
  /**
   * Every image of the set the opened one belongs to. When it holds more than
   * one entry the viewer can step through them, so a message with an album
   * does not have to be closed and reopened picture by picture.
   */
  gallery?: string[];
  /** Called with the newly shown image when the viewer steps through `gallery`. */
  onNavigate?: (imageSrc: string) => void;
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
  gallery,
  onNavigate,
}) => {
  // `zoom` is intentionally only the compact UI display state. Pan and the
  // actual transform stay in refs; changing them does not re-render the whole
  // modal for every pointer event.
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [imageBaseSize, setImageBaseSize] = useState<{ width: number; height: number } | null>(null);
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
    // The zoom is applied to the element's actual layout size below, rather
    // than scaling a composited preview with transform: scale(). Browsers then
    // resample the original pixels at the requested size, keeping small text
    // sharp just like the Telegram viewer.
    image.style.transform = `translate3d(${x}px, ${y}px, 0)`;
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

  const setZoomLevel = (nextZoom: number, focalPoint?: Point) => {
    const previousZoom = zoomRef.current;
    const clampedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));

    // Keep the image point under the pointer fixed while changing scale.
    // Because the image transform origin is its center, `pan` is measured from
    // that same center. This is the key difference from simply scaling around
    // the middle of the image.
    if (focalPoint && previousZoom > 0 && clampedZoom > 1) {
      const scaleRatio = clampedZoom / previousZoom;
      panRef.current = {
        x: focalPoint.x - (focalPoint.x - panRef.current.x) * scaleRatio,
        y: focalPoint.y - (focalPoint.y - panRef.current.y) * scaleRatio,
      };
    }

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
    setImageBaseSize(null);
    resetView();
  }, [imageSrc]);

  const handleImageLoad = () => {
    const image = imageRef.current;
    if (!image) return;
    // At zoom 1 the browser has already constrained the image to the modal.
    // Capture that crisp, correctly-contained size and use it as the base for
    // pixel-preserving zoom dimensions.
    const rect = image.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setImageBaseSize({ width: rect.width, height: rect.height });
    }
  };

  useEffect(() => () => {
    if (transformFrame.current !== null) {
      window.cancelAnimationFrame(transformFrame.current);
      transformFrame.current = null;
    }
  }, []);

  // Only a set with more than one picture turns the viewer into a gallery.
  const galleryImages = (gallery && gallery.length > 1) ? gallery : [];
  const galleryIndex = imageSrc ? galleryImages.indexOf(imageSrc) : -1;
  const hasGallery = galleryIndex >= 0;

  const showRelativeImage = (offset: number) => {
    if (!hasGallery || !onNavigate) return;
    // Wrap around, so the last image steps back to the first.
    const total = galleryImages.length;
    const nextIndex = (galleryIndex + offset + total) % total;
    onNavigate(galleryImages[nextIndex]);
  };

  useEffect(() => {
    if (!imageSrc) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'ArrowRight') {
        // The panel is RTL: the right arrow moves towards the previous image.
        if (hasGallery) { event.preventDefault(); showRelativeImage(-1); }
      } else if (event.key === 'ArrowLeft') {
        if (hasGallery) { event.preventDefault(); showRelativeImage(1); }
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
  }, [imageSrc, onClose, hasGallery, galleryIndex, galleryImages.length]);

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
    // Calculate the pointer position relative to the viewport center, which is
    // also the transform origin of the image. Zooming then keeps this exact
    // point anchored instead of always pulling the image toward its center.
    const bounds = event.currentTarget.getBoundingClientRect();
    const focalPoint = {
      x: event.clientX - (bounds.left + bounds.width / 2),
      y: event.clientY - (bounds.top + bounds.height / 2),
    };

    // A higher factor makes trackpad/wheel inspection feel responsive without
    // making individual wheel ticks jump past small receipt details.
    const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
    setZoomLevel(zoomRef.current * factor, focalPoint);
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
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-bold text-white">{title}</h3>
              {hasGallery && (
                <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                  {(galleryIndex + 1).toLocaleString('fa-IR')} از {galleryImages.length.toLocaleString('fa-IR')}
                </span>
              )}
            </div>
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
          {hasGallery && (
            <>
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); showRelativeImage(-1); }}
                className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full border border-slate-700 bg-slate-950/80 p-2 text-slate-200 shadow-lg transition hover:bg-slate-800 hover:text-white sm:right-4"
                aria-label="تصویر قبلی"
                title="تصویر قبلی"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); showRelativeImage(1); }}
                className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full border border-slate-700 bg-slate-950/80 p-2 text-slate-200 shadow-lg transition hover:bg-slate-800 hover:text-white sm:left-4"
                aria-label="تصویر بعدی"
                title="تصویر بعدی"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            </>
          )}
          <img
            ref={imageRef}
            src={imageSrc}
            alt={alt}
            onLoad={handleImageLoad}
            draggable={false}
            className={`${imageBaseSize ? '' : 'max-h-full max-w-full'} select-none object-contain shadow-2xl`}
            style={{
              width: imageBaseSize ? `${imageBaseSize.width * zoom}px` : undefined,
              height: imageBaseSize ? `${imageBaseSize.height * zoom}px` : undefined,
              maxWidth: imageBaseSize ? 'none' : undefined,
              maxHeight: imageBaseSize ? 'none' : undefined,
              transformOrigin: 'center center',
              imageRendering: 'auto',
            }}
            referrerPolicy="no-referrer"
          />
        </div>

        {hasGallery && (
          <div className="flex gap-1.5 overflow-x-auto border-t border-slate-800 bg-slate-950/60 px-3 py-2">
            {galleryImages.map((thumbnail, index) => (
              <button
                key={`${thumbnail}-${index}`}
                type="button"
                onClick={() => onNavigate?.(thumbnail)}
                className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border transition ${
                  index === galleryIndex
                    ? 'border-amber-400 ring-2 ring-amber-400/40'
                    : 'border-slate-700 opacity-60 hover:opacity-100'
                }`}
                aria-label={`نمایش تصویر ${index + 1}`}
                title={`تصویر ${index + 1}`}
              >
                <img
                  src={thumbnail}
                  alt=""
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        )}

        <footer className="flex flex-col-reverse items-center justify-between gap-2 border-t border-slate-800 bg-slate-900 px-3 py-2.5 sm:flex-row sm:px-4">
          <p className="text-center text-[11px] text-slate-400 sm:text-right">
            {hasGallery
              ? 'با دکمه‌های کناری یا کلیدهای جهت‌دار بین تصاویر جابه‌جا شوید؛ با چرخ ماوس یا نیشگون دو انگشت زوم کنید.'
              : 'با چرخ ماوس/ترک‌پد یا نیشگون دو انگشت زوم کنید؛ در حالت بزرگ‌نمایی، تصویر را سریع‌تر بکشید.'}
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
