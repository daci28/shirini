#!/usr/bin/env node
// Runs before the build on a deployment and prints, in one place, the facts
// that decide whether the build can succeed. When a platform build fails, this
// output identifies the cause instead of leaving a bare non-zero exit.
import fs from 'fs';
import { execSync } from 'child_process';

const need = ['vite', 'esbuild', 'tailwindcss', '@vitejs/plugin-react', '@tailwindcss/vite'];

function isInstalled(pkg) {
  if (fs.existsSync(`node_modules/${pkg}`)) return true;
  try {
    import.meta.resolve(pkg);
    return true;
  } catch {
    return false;
  }
}

let missing = need.filter((m) => !isInstalled(m));

const memoryLimitMb = () => {
  // cgroup v2, then v1 — this is what a container actually enforces.
  for (const file of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    try {
      const raw = fs.readFileSync(file, 'utf8').trim();
      if (!raw || raw === 'max') continue;
      const mb = Math.round(Number(raw) / 1048576);
      // An unset v1 limit shows up as a huge sentinel value.
      if (Number.isFinite(mb) && mb > 0 && mb < 1024 * 1024) return mb;
    } catch {}
  }
  return null;
};

const limit = memoryLimitMb();

console.log('[verify-build] node        :', process.version);
console.log('[verify-build] NODE_ENV    :', process.env.NODE_ENV || '(unset)');
console.log('[verify-build] memory limit:', limit ? `${limit} MB` : 'unknown');

if (missing.length > 0) {
  console.log(`[verify-build] Missing build tools: ${missing.join(', ')}. Attempting automatic install...`);
  try {
    execSync('npm install --include=dev --loglevel=error', { stdio: 'inherit' });
    missing = need.filter((m) => !isInstalled(m));
  } catch (err) {
    console.warn('[verify-build] Automatic install attempt failed:', err?.message || err);
  }
}

console.log('[verify-build] build tools :', missing.length === 0 ? 'all present' : `MISSING -> ${missing.join(', ')}`);

if (missing.length) {
  console.error(
    '\n[verify-build] FAILED: the build tools listed above are not installed.\n' +
      'This happens when the platform installs with --omit=dev or NODE_ENV=production.\n' +
      'They are declared under "dependencies" in package.json, so a plain `npm install --include=dev` must be used.',
  );
  process.exit(1);
}

if (limit !== null && limit < 512) {
  console.warn(
    `\n[verify-build] WARNING: only ${limit} MB is available to this container.\n` +
      'Building the panel needs roughly 350 MB. If the build dies with exit code 137,\n' +
      'it was killed for memory — raise the memory limit for the service.',
  );
}
