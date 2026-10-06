// playwright.config.js — E2E against the foundation server (silent TTS, no browser opening,
// temp copy of fixtures/lessons, random port). Playwright is pinned to 1.54.x: >= 1.62 has no
// Chromium build for macOS 13, which this machine runs (see README / lessons.md).
import { defineConfig } from '@playwright/test';
import { mkdtempSync, cpSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// The config is evaluated in the runner and again in workers: keep port and dirs stable via env.
if (!process.env.KHAN_E2E_PORT) process.env.KHAN_E2E_PORT = String(7800 + Math.floor(Math.random() * 1000));
if (!process.env.KHAN_E2E_ROOT) {
  const tmp = mkdtempSync(join(tmpdir(), 'khan-e2e-'));
  mkdirSync(join(tmp, 'lessons'));
  cpSync(join(root, 'fixtures', 'lessons'), join(tmp, 'lessons'), { recursive: true });
  process.env.KHAN_E2E_ROOT = tmp;
}
const port = Number(process.env.KHAN_E2E_PORT);
const e2eRoot = process.env.KHAN_E2E_ROOT;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `node server/index.js --port ${port} --lessons-dir "${join(e2eRoot, 'lessons')}" --cache-dir "${join(e2eRoot, 'cache')}"`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { ...process.env, KHAN_TTS: 'silent', KHAN_NO_OPEN: '1', KHAN_IDLE_EXIT_MS: String(60 * 60 * 1000) },
  },
});
