import { describe, expect, it } from 'vitest';
import { DEFAULTS } from './defaults';
import { validateConfig } from './validate';
import type { AppConfig, Severity } from './types';

function issuesFor(overrides: Partial<AppConfig>, origin: string | null = 'http://localhost:4200') {
  return validateConfig({ ...DEFAULTS, ...overrides }, origin);
}

function messagesOf(overrides: Partial<AppConfig>, severity: Severity, origin?: string | null) {
  return issuesFor(overrides, origin === undefined ? 'http://localhost:4200' : origin)
    .filter((i) => i.severity === severity)
    .map((i) => i.message);
}

describe('validateConfig', () => {
  it('accepts the shipped defaults without errors', () => {
    expect(messagesOf({}, 'error')).toEqual([]);
  });

  it('errors on a missing required field', () => {
    expect(messagesOf({ clientId: '' }, 'error').join()).toContain('clientId');
    expect(messagesOf({ authIssuer: '' }, 'error').join()).toContain('authIssuer');
  });

  it('treats plaintext http as a warning when the page is also http', () => {
    // The default config is all localhost http, which is the normal local
    // testing setup and must not be an error.
    const warnings = messagesOf({}, 'warning').join();
    expect(warnings).toContain('plaintext http');
    expect(messagesOf({}, 'error')).toEqual([]);
  });

  it('escalates plaintext http to an error when the page is https', () => {
    // Mixed content is a certainty: the browser blocks it before sending and
    // gives JavaScript no usable error, so we must say so up front.
    const errors = messagesOf(
      { fhirBaseUrl: 'http://fhir.example', authIssuer: 'https://idp.example' },
      'error',
      'https://swiss.example'
    ).join();
    expect(errors).toContain('mixed content');
  });

  it('exempts localhost from the mixed-content error', () => {
    // http://localhost is a secure context, so it is genuinely reachable.
    const errors = messagesOf(
      { fhirBaseUrl: 'http://localhost:8001', authIssuer: 'https://idp.example' },
      'error',
      'https://swiss.example'
    ).join();
    expect(errors).not.toContain('mixed content');
  });

  it('warns about a private-network target from an https page', () => {
    const warnings = messagesOf(
      { fhirBaseUrl: 'http://192.168.1.50:8001' },
      'warning',
      'https://swiss.example'
    ).join();
    expect(warnings).toContain('Private Network Access');
  });

  it('warns whenever a client secret is set', () => {
    const warnings = messagesOf({ clientSecret: 'hunter2' }, 'warning').join();
    expect(warnings).toContain('devtools');
    expect(warnings).toContain('/config/env.json');
  });

  it('never echoes the secret value in an issue message', () => {
    const all = issuesFor({ clientSecret: 'hunter2' })
      .map((i) => i.message)
      .join();
    expect(all).not.toContain('hunter2');
  });

  it('flags a secret that will not be sent because auth is public', () => {
    const warnings = messagesOf(
      { clientSecret: 'hunter2', clientAuthMethod: 'none' },
      'warning'
    ).join();
    expect(warnings).toContain('will not be sent');
  });

  it('flags client auth configured without a secret', () => {
    const warnings = messagesOf({ clientSecret: '', clientAuthMethod: 'basic' }, 'warning').join();
    expect(warnings).toContain('no client secret');
  });

  it('warns that skipIssuerCheck is non-compliant', () => {
    const warnings = messagesOf({ skipIssuerCheck: true }, 'warning').join();
    expect(warnings).toContain('non-compliant');
  });

  it('flags fhirUser requested without openid', () => {
    // fhirUser is an ID token claim, so without openid there is no ID token
    // and the claim can never arrive.
    const warnings = messagesOf({ scopes: 'fhirUser patient/*.read' }, 'warning').join();
    expect(warnings).toContain('requires openid');
  });

  it('errors on an empty scope string', () => {
    expect(messagesOf({ scopes: '' }, 'error').join()).toContain('No scopes');
  });

  it('warns when tokens are stored on disk', () => {
    expect(messagesOf({ tokenStorage: 'local' }, 'warning').join()).toContain('local storage');
  });

  it('warns when redaction is disabled', () => {
    expect(messagesOf({ redactSecrets: false }, 'warning').join()).toContain('live tokens');
  });

  it('always surfaces the exact redirect URI to register', () => {
    const info = issuesFor({}).filter((i) => i.severity === 'info');
    expect(info.map((i) => i.message).join()).toContain('http://localhost:4200/callback');
  });
});
