import type { UploadProgress } from '../utils/uploadWithProgress';

/**
 * The percentage indicator shown while pictures are being uploaded in the
 * panel. Rendering nothing when there is no upload in flight keeps the callers
 * free of conditionals.
 */
export default function UploadProgressBar({
  progress,
  className = '',
}: {
  progress: UploadProgress | null;
  className?: string;
}) {
  if (!progress) return null;

  const remaining = Math.max(0, 100 - progress.percent);

  return (
    <div
      className={`rounded-xl border border-purple-500/30 bg-slate-950/70 px-3 py-2 ${className}`}
    >
      <div className="mb-1.5 flex items-center justify-between text-[11px]">
        <span className="font-bold text-purple-200">
          {progress.total > 1
            ? `در حال بارگذاری تصویر ${progress.current.toLocaleString('fa-IR')} از ${progress.total.toLocaleString('fa-IR')}`
            : 'در حال بارگذاری تصویر'}
        </span>
        <span className="font-mono text-purple-300">
          {progress.percent.toLocaleString('fa-IR')}٪
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-slate-800"
        role="progressbar"
        aria-label="پیشرفت بارگذاری تصویر"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
      >
        <div
          className="h-full rounded-full bg-gradient-to-l from-purple-500 to-fuchsia-400 transition-all duration-200"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <p className="mt-1 text-[10px] text-slate-500">
        {progress.percent >= 100
          ? 'در حال نهایی‌سازی روی سرور...'
          : `${remaining.toLocaleString('fa-IR')}٪ باقی مانده است`}
      </p>
    </div>
  );
}
