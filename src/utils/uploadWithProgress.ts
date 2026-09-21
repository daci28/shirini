/**
 * Uploading through fetch() gives no way to observe how many bytes have left
 * the browser, so every upload in the panel goes through XMLHttpRequest, which
 * is the only transport that fires real progress events.
 */

export type UploadProgress = {
  /** 0-100, already clamped and rounded. */
  percent: number;
  /** 1-based index of the file currently going up. */
  current: number;
  /** How many files are in this batch. */
  total: number;
};

/**
 * Sends one blob to /api/upload-image and reports the fraction (0..1) that has
 * actually been transmitted. Resolves with the stored URL, or null on failure.
 */
export function uploadImageWithProgress(
  blob: Blob,
  onFraction?: (fraction: number) => void,
): Promise<string | null> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/upload-image', true);
    request.withCredentials = true;
    request.setRequestHeader('Content-Type', blob.type || 'image/png');

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || !event.total) return;
      onFraction?.(Math.min(1, event.loaded / event.total));
    };

    request.onload = () => {
      // The bytes are up; whatever is left is the server answering.
      onFraction?.(1);
      let body: any = null;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        body = null;
      }
      if (request.status < 200 || request.status >= 300 || !body?.url) {
        resolve(null);
        return;
      }
      resolve(body.url as string);
    };

    request.onerror = () => resolve(null);
    request.onabort = () => resolve(null);

    request.send(blob);
  });
}

/**
 * Uploads a batch and reports one combined percentage for the whole set.
 * Progress is weighted by byte size, otherwise a small picture would race the
 * bar to 100% while a large one is still uploading.
 */
export async function uploadImagesWithProgress(
  blobs: Blob[],
  onProgress: (progress: UploadProgress | null) => void,
): Promise<string[]> {
  if (blobs.length === 0) return [];

  const totalBytes = blobs.reduce((sum, blob) => sum + blob.size, 0) || 1;
  let uploadedBytes = 0;
  const urls: string[] = [];

  onProgress({ percent: 0, current: 1, total: blobs.length });
  try {
    for (const [index, blob] of blobs.entries()) {
      const url = await uploadImageWithProgress(blob, (fraction) => {
        const percent = Math.round(((uploadedBytes + blob.size * fraction) / totalBytes) * 100);
        onProgress({
          percent: Math.min(100, Math.max(0, percent)),
          current: index + 1,
          total: blobs.length,
        });
      });
      uploadedBytes += blob.size;
      if (url) urls.push(url);
    }
  } finally {
    onProgress(null);
  }
  return urls;
}
