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

import { deriveRedirectUri } from './merge';
import type { AppConfig, ConfigIssue } from './types';

/**
 * Cross-field validation, run against the effective config.
 *
 * Almost everything here is a WARNING rather than an error. The point of
 * Swiss is to tell you that a configuration is suspicious, which means it has
 * to be able to load a suspicious configuration in the first place. Only
 * genuinely unusable states (a missing client id, a target the browser will
 * refuse outright) are errors.
 */
export function validateConfig(config: AppConfig, origin: string | null): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  const required: (keyof AppConfig)[] = ['fhirBaseUrl', 'authIssuer', 'clientId'];
  for (const key of required) {
    if (!String(config[key]).trim()) {
      issues.push({
        key,
        severity: 'error',
        message: `${key} is empty. Set it below, or in your .env.`
      });
    }
  }

  // Host-case normalisation is NOT checked here: coerceUrl has already run
  // `new URL()`, which lowercases the host, so the original casing is gone by
  // this point. It is reported at parse time instead, by
  // describeUrlNormalization() in coerce.ts, which still sees the raw value.
  const pageIsHttps = origin?.startsWith('https://') ?? false;

  for (const key of ['fhirBaseUrl', 'authIssuer'] as const) {
    const value = config[key];
    if (!value) continue;

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      continue; // coerceUrl already reported this
    }

    // Mixed content is a certainty, not a guess: the browser blocks the
    // request outright and gives JavaScript no useful error.
    if (pageIsHttps && url.protocol === 'http:' && !isLoopback(url.hostname)) {
      issues.push({
        key,
        severity: 'error',
        message: `Swiss is served over HTTPS but ${key} is plaintext http. The browser will block these requests as mixed content before they are sent. Serve this endpoint over HTTPS, or run Swiss over http://localhost.`
      });
    } else if (url.protocol === 'http:') {
      issues.push({
        key,
        severity: 'warning',
        message: `${key} uses plaintext http. Fine for local testing; tokens and patient data would be readable in transit anywhere else.`
      });
    }

    // Private Network Access: an HTTPS page fetching a loopback or RFC1918
    // address triggers a PNA preflight in recent Chrome and can be blocked
    // even when CORS is otherwise correct.
    if (pageIsHttps && isPrivateAddress(url.hostname)) {
      issues.push({
        key,
        severity: 'warning',
        message: `${key} points at a private or loopback address from an HTTPS page. Chrome sends a Private Network Access preflight for this and may block it regardless of CORS.`
      });
    }
  }

  if (config.clientSecret) {
    issues.push({
      key: 'clientSecret',
      severity: 'warning',
      message:
        'A client secret is set. In a browser app it is readable by anyone who opens devtools, and it is served in plaintext at /swiss-env.json. Swiss always uses PKCE, so a public client needs no secret -- use one only against a server on a network you control.'
    });
    if (config.clientAuthMethod === 'none') {
      issues.push({
        key: 'clientAuthMethod',
        severity: 'warning',
        message:
          'A client secret is set but client authentication is "Public (PKCE only)", so the secret will not be sent. Pick HTTP Basic or Request body to use it.'
      });
    }
  } else if (config.clientAuthMethod !== 'none') {
    issues.push({
      key: 'clientAuthMethod',
      severity: 'warning',
      message: `Client authentication is set to "${config.clientAuthMethod}" but no client secret is configured.`
    });
  }

  const scopes = config.scopes.split(/\s+/).filter(Boolean);
  if (scopes.length === 0) {
    issues.push({ key: 'scopes', severity: 'error', message: 'No scopes requested.' });
  } else {
    if (scopes.includes('fhirUser') && !scopes.includes('openid')) {
      issues.push({
        key: 'scopes',
        severity: 'warning',
        message:
          'The fhirUser scope requires openid as well -- fhirUser is an ID token claim, and without openid no ID token is issued.'
      });
    }
    if (scopes.includes('offline_access') && scopes.includes('online_access')) {
      issues.push({
        key: 'scopes',
        severity: 'warning',
        message: 'offline_access and online_access are mutually exclusive; servers will pick one.'
      });
    }
  }

  if (config.audMode === 'omit') {
    issues.push({
      key: 'audMode',
      severity: 'info',
      message:
        'The aud parameter will be omitted. SMART requires it, so most servers will reject the authorize request -- useful for confirming yours enforces it.'
    });
  }

  if (config.tokenStorage === 'local') {
    issues.push({
      key: 'tokenStorage',
      severity: 'warning',
      message:
        'Tokens will be written to local storage, so they survive a browser restart and stay on disk until you log out.'
    });
  }

  if (!config.redactSecrets) {
    issues.push({
      key: 'redactSecrets',
      severity: 'warning',
      message:
        'Redaction is off, so exchange logs and diagnostics exports will contain live tokens. Turn it back on before sharing a report.'
    });
  }

  if (origin) {
    issues.push({
      key: null,
      severity: 'info',
      message: `Register this exact redirect URI with your client: ${deriveRedirectUri(origin)}`
    });
  }

  return issues;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function isPrivateAddress(hostname: string): boolean {
  if (isLoopback(hostname)) return true;
  return (
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}
