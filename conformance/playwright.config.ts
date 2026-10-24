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

import { defineConfig, devices } from '@playwright/test';

/**
 * Conformance runs: Swiss driven through external test suites running in
 * Docker on this machine. Its own config, so `npm run test:e2e` never
 * touches it. Run with `npm run test:conformance` once a suite is up
 * (`npm run conformance:up -- openid` or `-- inferno`).
 *
 * One worker, in order: each suite routes every request for its test alias
 * to the test running now, so two at once would see each other's traffic.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 20 * 60_000,
  reporter: 'list',
  outputDir: 'results/playwright',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:4173',
    // The OpenID suite serves a self-signed certificate.
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure'
  },
  webServer: {
    // The same static output that ships, as the e2e suite uses. Its default
    // configuration points at localhost; each spec imports its own
    // environments file instead.
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    cwd: '..',
    port: 4173,
    reuseExistingServer: true,
    timeout: 180_000
  }
});
