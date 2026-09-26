/*
 Copyright 2021 Omar Hoblos

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * macOS 27 refuses a Firefox launched from a terminal or an agent access to
 * ~/Library/Application Support/Firefox, and Firefox 155 then exits with
 * "Could not find profile folder" before Playwright's -profile is even read.
 * CoreFoundation resolves the home directory from CFFIXED_USER_HOME, so
 * pointing it at scratch space keeps Firefox out of the guarded folder.
 */
const firefoxEnv =
  process.platform === 'darwin'
    ? { ...process.env, CFFIXED_USER_HOME: mkdtempSync(join(tmpdir(), 'swiss-ff-home-')) }
    : undefined;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['html'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure'
  },
  // Both engines, because the log drawer once broke in a way that looked
  // Firefox-specific and was really state-specific -- a chromium-only suite
  // could not tell those apart.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        ...(firefoxEnv ? { launchOptions: { env: firefoxEnv } } : {})
      }
    }
  ],
  webServer: {
    // Built and previewed rather than dev-served, so the tests exercise the
    // same static output that ships in the image. A separate port keeps this
    // from colliding with a dev server on 4200.
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000
  }
});
