import fs from 'fs';
import path from 'path';
import { DATA_DIR as RESOLVED_DATA_DIR } from './dataPaths';

/** Shared durable directory (DATA_DIR env / Railway Volume / project dir). */
export const DATA_DIR = RESOLVED_DATA_DIR;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
/** Previous good copy, kept so a corrupted write is always recoverable. */
const PREVIOUS_FILE = path.join(DATA_DIR, 'data.prev.json');
/** Rolling safety copies, newest first: data.bak.1.json … data.bak.N.json */
const ROLLING_COPIES = 5;
const ROLLING_INTERVAL_MS = 60 * 60 * 1000;

export interface PersistedData {
  products: any[];
  orders: any[];
  customOrders: any[];
  /** Standalone manual invoices. Order invoices are derived at read time. */
  invoices: any[];
  discounts: any[];
  supportTickets: any[];
  customers: any[];
  walletTransactions?: any[];
  backupSnapshots: any[];
  backupSchedule: any;
  /** Sent broadcast history (targeted customer messages). */
  broadcasts?: any[];
}

function rollingPath(index: number): string {
  return path.join(DATA_DIR, `data.bak.${index}.json`);
}

/**
 * Remove leftover *.tmp files from a previous crash.
 *
 * A killed process leaves its partial temp file behind; on a small VPS disk
 * those multi-megabyte orphans would pile up until the disk fills, which would
 * then break saving entirely.
 */
function cleanupStaleTempFiles(): void {
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(DATA_DIR)) {
      if (!name.startsWith('data.') || !name.endsWith('.tmp')) continue;
      const file = path.join(DATA_DIR, name);
      try {
        // Only touch files that are clearly not from an in-flight write.
        if (now - fs.statSync(file).mtimeMs > 60_000) fs.unlinkSync(file);
      } catch {
        /* another process may have removed it already */
      }
    }
  } catch {
    /* best-effort housekeeping */
  }
}

/** A store's data file is only usable if it parses AND looks like our shape. */
function readIfHealthy(filePath: string): PersistedData | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    // A truncated write usually still parses as *something*; require a known key.
    if (!Array.isArray(parsed.orders) && !Array.isArray(parsed.customers) && !Array.isArray(parsed.products)) {
      return null;
    }
    return parsed as PersistedData;
  } catch {
    return null;
  }
}

/**
 * Load the newest data file that is actually intact.
 *
 * Losing customer and order history is unacceptable for a shop, so instead of
 * returning null on a corrupted file (which would silently start the shop with
 * an empty database and then overwrite the damaged file) we walk back through
 * the previous copy and the rolling backups.
 */
export function loadData(): PersistedData | null {
  cleanupStaleTempFiles();

  const candidates: { label: string; file: string }[] = [
    { label: 'data.json', file: DATA_FILE },
    { label: 'data.prev.json', file: PREVIOUS_FILE },
    ...Array.from({ length: ROLLING_COPIES }, (_, i) => ({
      label: `data.bak.${i + 1}.json`,
      file: rollingPath(i + 1),
    })),
  ];

  for (const [index, candidate] of candidates.entries()) {
    const data = readIfHealthy(candidate.file);
    if (data) {
      if (index > 0) {
        console.error(
          `[persist] data.json was missing or corrupted; recovered from ${candidate.label}. ` +
            'The damaged file is kept as data.corrupt.json for inspection.',
        );
        try {
          if (fs.existsSync(DATA_FILE)) {
            fs.copyFileSync(DATA_FILE, path.join(DATA_DIR, 'data.corrupt.json'));
          }
        } catch {
          /* keeping the evidence is best-effort */
        }
      }
      return data;
    }
    if (fs.existsSync(candidate.file)) {
      console.error(`[persist] ${candidate.label} exists but is unreadable; trying an older copy.`);
    }
  }

  return null;
}

function rotateRollingCopies(): void {
  try {
    const oldest = rollingPath(ROLLING_COPIES);
    if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
    for (let i = ROLLING_COPIES - 1; i >= 1; i--) {
      const from = rollingPath(i);
      if (fs.existsSync(from)) fs.renameSync(from, rollingPath(i + 1));
    }
    if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, rollingPath(1));
  } catch (e) {
    console.error('[persist] Failed to rotate rolling backups:', e);
  }
}

function lastRollingTime(): number {
  try {
    return fs.statSync(rollingPath(1)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Write the data file atomically.
 *
 * `writeFileSync` truncates the target first, so a restart (Railway redeploy,
 * `pm2 restart`, OOM kill, power loss) in the middle of a multi-megabyte write
 * leaves a half-written, unparseable file — i.e. the whole shop's history is
 * gone. Writing to a temporary file, flushing it to disk and then renaming
 * means the real file is only ever replaced by a complete one: a rename is
 * atomic on the same filesystem, so readers see either the old file or the new
 * one, never a partial mix.
 */
export function saveData(data: PersistedData): void {
  const temporaryFile = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  try {
    const serialized = JSON.stringify(data, null, 2);

    const handle = fs.openSync(temporaryFile, 'w');
    try {
      fs.writeFileSync(handle, serialized, 'utf-8');
      // Force the bytes out of the OS cache, otherwise a power loss can leave
      // the renamed file empty even though the rename itself succeeded.
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }

    // Keep the last known good version before replacing it. Copy via a
    // temporary name too: a crash during copyFileSync would otherwise leave a
    // truncated data.prev.json, destroying the very fallback we rely on.
    try {
      if (fs.existsSync(DATA_FILE)) {
        const previousTemp = `${PREVIOUS_FILE}.${process.pid}.tmp`;
        fs.copyFileSync(DATA_FILE, previousTemp);
        fs.renameSync(previousTemp, PREVIOUS_FILE);
      }
    } catch (e) {
      console.error('[persist] Failed to refresh data.prev.json:', e);
    }

    fs.renameSync(temporaryFile, DATA_FILE);

    if (Date.now() - lastRollingTime() >= ROLLING_INTERVAL_MS) {
      rotateRollingCopies();
      cleanupStaleTempFiles();
    }
  } catch (e) {
    console.error('Failed to save data:', e);
    try {
      if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
    } catch {
      /* the temp file is disposable */
    }
  }
}
