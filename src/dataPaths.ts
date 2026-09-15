import fs from 'fs';

/**
 * Resolve the single durable data directory used for data.json, settings.json,
 * userStates.json, userCarts.json, product images and the Telegram file cache.
 *
 * Priority:
 *   1. DATA_DIR environment variable — set this on a VPS (e.g.
 *      DATA_DIR=/var/lib/shirini-data) to a folder OUTSIDE the app code so the
 *      data survives code updates / re-clones.
 *   2. /app/data when it exists — the Railway persistent volume mount point.
 *   3. Current working directory — convenient for local development.
 *
 * The directory is created on import so every caller can write into it.
 */
function resolveDataDir(): string {
  const envDir = (process.env.DATA_DIR || '').trim();
  if (envDir) {
    fs.mkdirSync(envDir, { recursive: true });
    return envDir;
  }
  if (fs.existsSync('/app/data')) return '/app/data';
  const cwd = process.cwd();
  fs.mkdirSync(cwd, { recursive: true });
  return cwd;
}

export const DATA_DIR = resolveDataDir();
