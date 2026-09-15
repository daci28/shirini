import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './dataPaths';

const STATES_FILE = path.join(DATA_DIR, 'userStates.json');
const CARTS_FILE = path.join(DATA_DIR, 'userCarts.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Persistent Map that auto-saves to disk
export class PersistentMap<V> {
  private map: Map<string, V>;
  private filePath: string;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(filePath: string) {
    // Callers use simple filenames for cart and multi-step bot state. Resolve
    // them into Railway's mounted /app/data volume rather than leaving them in
    // the ephemeral application working directory after a deployment.
    this.filePath = path.isAbsolute(filePath) ? filePath : path.join(DATA_DIR, filePath);
    this.map = new Map();
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf-8');
        const obj = JSON.parse(data);
        for (const [key, val] of Object.entries(obj)) {
          this.map.set(key, val as V);
        }
        console.log(`Loaded ${this.map.size} entries from ${this.filePath}`);
      }
    } catch (e) {
      console.error(`Failed to load ${this.filePath}:`, e);
    }
  }

  private scheduleSave() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      try {
        const obj: Record<string, V> = {};
        this.map.forEach((val, key) => { obj[key] = val; });
        fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2), 'utf-8');
      } catch (e) {
        console.error(`Failed to save ${this.filePath}:`, e);
      }
    }, 500); // Debounce 500ms
  }

  get(key: string): V | undefined {
    return this.map.get(key);
  }

  set(key: string, value: V): this {
    this.map.set(key, value);
    this.scheduleSave();
    return this;
  }

  delete(key: string): boolean {
    const result = this.map.delete(key);
    if (result) this.scheduleSave();
    return result;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  clear(): void {
    this.map.clear();
    this.scheduleSave();
  }

  get size(): number {
    return this.map.size;
  }

  forEach(callbackfn: (value: V, key: string, map: Map<string, V>) => void): void {
    this.map.forEach(callbackfn);
  }
}
