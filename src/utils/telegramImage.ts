/**
 * Resolves image values persisted by the panel.
 *
 * Telegram returns a bot-local file_id rather than a browser URL. Keeping that
 * ID in data and proxying it through the current app host avoids tying images
 * to a particular Railway deployment domain. Existing URLs, data URLs and
 * stored image paths stay untouched for backwards compatibility.
 */
export const resolveTelegramImageSource = (imageReference?: string): string | null => {
  const normalizedReference = imageReference?.trim();
  if (!normalizedReference) return null;

  // Absolute browser-safe references plus root-relative and dot-relative paths
  // are already usable by the current deployment host.
  if (/^(https?:\/\/|data:image\/|blob:|\/|\.{1,2}\/)/i.test(normalizedReference)) {
    return normalizedReference;
  }

  // Older records can contain a relative uploads path without a leading `./`.
  // File IDs do not normally have an image extension, so retain known image
  // paths while sending all other opaque values through the Telegram proxy.
  if (/(?:^|\/)[^/?#]+\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i.test(normalizedReference)) {
    return normalizedReference;
  }

  return `/api/telegram/file/${encodeURIComponent(normalizedReference)}`;
};
