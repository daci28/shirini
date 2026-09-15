import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './dataPaths';

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

export function loadSettings(): any {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return null;
}

export function saveSettings(settings: any): void {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}
