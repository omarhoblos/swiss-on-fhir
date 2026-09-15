import { deriveRedirectUri } from '$lib/config/merge';
import { remediation } from '../remediation';
import { result, type Check } from '../types';

/**
 * Checks that need no network and run first, so an environment problem is
 * reported before a pile of confusing network failures.
 *
 * These are the only checks that can be `certain`: they apply rules the
 * browser will apply, rather than inferring from a rejected fetch.
 */

const secureContext: Check = {
  id: 'env.secure-context',
  title: 'Secure context (PKCE is possible)',
  group: 'environment',
  async run() {
    const isSecure = typeof isSecureContext === 'boolean' ? isSecureContext : true;
    const hasSubtle = Boolean(globalThis.crypto?.subtle);

    if (isSecure && hasSubtle) {
      return result({
        status: 'pass',
        summary: 'This origin is a secure context, so PKCE S256 is available.'
      });
    }

    return result({
      status: 'fail',
      summary:
        'This origin is not a secure context, so crypto.subtle is unavailable and PKCE S256 cannot be computed.',
      detail: `Origin: \`${location.origin}\`\n\n\`isSecureContext\` is \`${isSecure}\` and \`crypto.subtle\` is ${hasSubtle ? 'present' : 'undefined'}.\n\nThis is worth flagging loudly because the Swiss 2.x README recommended running on \`http://yourlocalip:4200\`, which is exactly the case that fails.`,
      remediations: [remediation('insecure-context-no-crypto')],
      spec: {
        name: 'RFC 7636 (PKCE)',
        section: '4.2',
        url: 'https://datatracker.ietf.org/doc/html/rfc7636#section-4.2'
      }
    });
  }
};

const mixedContent: Check = {
  id: 'env.mixed-content',
  title: 'No mixed-content blocks',
  group: 'environment',
  async run(ctx) {
    const pageIsHttps = ctx.origin?.startsWith('https://') ?? false;
    if (!pageIsHttps) {
      return result({
        status: 'pass',
        summary: 'Swiss is not served over HTTPS, so mixed content does not apply.'
      });
    }

    const offenders: string[] = [];
    for (const [label, value] of [
      ['FHIR base', ctx.config.fhirBaseUrl],
      ['Authorization server', ctx.config.authIssuer]
    ] as const) {
      if (!value) continue;
      try {
        const url = new URL(value);
        const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (url.protocol === 'http:' && !loopback) offenders.push(`${label}: ${value}`);
      } catch {
        /* coercion already reported this */
      }
    }

    if (offenders.length === 0) {
      return result({ status: 'pass', summary: 'All configured endpoints use HTTPS.' });
    }

    return result({
      status: 'fail',
      summary: `${offenders.length} endpoint(s) are plaintext http while Swiss is served over HTTPS. The browser blocks these before they are sent.`,
      detail: offenders.map((o) => `- ${o}`).join('\n'),
      remediations: [remediation('mixed-content')]
    });
  }
};

const configShape: Check = {
  id: 'env.config-shape',
  title: 'Configuration is well-formed',
  group: 'environment',
  async run(ctx) {
    const problems: string[] = [];
    const notes: string[] = [];

    if (!ctx.config.fhirBaseUrl) problems.push('The FHIR base URL is empty.');
    if (!ctx.config.authIssuer) problems.push('The authorization server URL is empty.');
    if (!ctx.config.clientId) problems.push('The client ID is empty.');
    if (!ctx.config.scopes.trim()) problems.push('No scopes are requested.');

    if (/\/metadata$/i.test(ctx.config.fhirBaseUrl)) {
      notes.push(
        'The FHIR base URL ends in `/metadata`. That is the CapabilityStatement, not the base; Swiss strips it for discovery but requests will be built from the base.'
      );
    }
    if (/\/(Patient|Observation|Encounter)$/i.test(ctx.config.fhirBaseUrl)) {
      notes.push(
        'The FHIR base URL ends in a resource type, which is probably one path segment too deep.'
      );
    }
    if (ctx.config.fhirBaseUrl && ctx.config.fhirBaseUrl === ctx.config.authIssuer) {
      notes.push(
        'The FHIR base and the authorization server are the same URL. That is legitimate on some servers, but worth confirming.'
      );
    }

    if (problems.length > 0) {
      return result({
        status: 'fail',
        summary: `${problems.length} required setting(s) are missing.`,
        detail: problems.map((p) => `- ${p}`).join('\n')
      });
    }
    if (notes.length > 0) {
      return result({
        status: 'warn',
        summary: 'The configuration loads, but something looks unusual.',
        detail: notes.map((n) => `- ${n}`).join('\n')
      });
    }
    return result({ status: 'pass', summary: 'All required settings are present and plausible.' });
  }
};

const redirectUri: Check = {
  id: 'env.redirect-uri',
  title: 'Redirect URI is registered',
  group: 'environment',
  async run(ctx) {
    const uri = ctx.origin ? deriveRedirectUri(ctx.origin) : '(unknown origin)';
    return result({
      // Genuinely unverifiable from here, and saying so is more useful than
      // a green tick that means nothing.
      status: 'manual',
      summary:
        'Cannot be verified from the browser. Only a real authorization attempt will tell you.',
      detail: `Swiss will send:\n\n\`${uri}\`\n\nRegister that exact string with your client.\n\nThe failure mode is distinctive: if the redirect URI is not registered, a conforming server **must not** redirect back to it. You will land on an error page at the identity provider and never return here, so Swiss cannot show you the error.`,
      remediations: [
        remediation('redirect-uri-not-registered', [
          { kind: 'copy', label: 'Copy the redirect URI', value: uri }
        ])
      ]
    });
  }
};

const iframeStorage: Check = {
  id: 'env.iframe-storage',
  title: 'Storage is usable (not a partitioned iframe)',
  group: 'environment',
  async run() {
    const inIframe = typeof window !== 'undefined' && window.top !== window.self;

    let storageWorks = true;
    try {
      sessionStorage.setItem('swiss.probe', '1');
      sessionStorage.removeItem('swiss.probe');
    } catch {
      storageWorks = false;
    }

    if (!inIframe && storageWorks) {
      return result({
        status: 'pass',
        summary: 'Running at the top level with working session storage.'
      });
    }

    if (!storageWorks) {
      return result({
        status: 'fail',
        summary:
          'Session storage is unavailable, so the PKCE verifier cannot survive the authorization redirect.',
        detail:
          'This usually means private browsing with storage disabled, or a partitioned third-party iframe. Swiss falls back to in-memory state, which does not survive the redirect.'
      });
    }

    return result({
      status: 'warn',
      summary: 'Swiss is running inside an iframe, which often breaks a SMART launch.',
      detail:
        'SMART requires a full-page redirect for the authorization step, and browsers frequently block top-level navigation from an iframe. If the launch does nothing when you click it, ask the EHR to launch Swiss in a new tab or window instead.'
    });
  }
};

export const environmentChecks: Check[] = [
  secureContext,
  mixedContent,
  configShape,
  redirectUri,
  iframeStorage
];
