import { suggestClientAuthMethod } from '$lib/smart/capabilities';
import { remediation } from '../remediation';
import { result, type Check } from '../types';
import type { FeatureGate } from '$lib/smart/types';

/**
 * Compares what the server advertises against what Swiss is configured to do.
 *
 * Policy throughout: a capability the server did not advertise is a WARNING,
 * never a failure, and Swiss proceeds anyway. Servers under-report constantly,
 * and refusing to send a request because a capability was not listed makes it
 * impossible to discover that the server supports it.
 */

function gateStatus(gate: FeatureGate): 'pass' | 'warn' | 'fail' {
  if (gate.state === 'yes') return 'pass';
  if (gate.state === 'not-advertised') return 'warn';
  return 'fail';
}

const pkce: Check = {
  id: 'cap.pkce-s256',
  title: 'PKCE S256 is supported',
  group: 'capabilities',
  async run(ctx) {
    if (!ctx.gates) {
      return result({
        status: 'skip',
        summary: 'No SMART configuration document, so capabilities are unknown.'
      });
    }

    const gate = ctx.gates.pkceS256;
    if (gate.state === 'yes') {
      return result({ status: 'pass', summary: 'The server advertises S256.' });
    }
    if (gate.state === 'not-advertised') {
      return result({
        status: 'warn',
        summary: 'S256 is not advertised. SMART 2.0 requires it, so Swiss will send it anyway.',
        detail: gate.detail,
        spec: {
          name: 'SMART App Launch',
          section: 'App Launch',
          url: 'https://build.fhir.org/ig/HL7/smart-app-launch/app-launch.html'
        }
      });
    }
    return result({
      status: 'fail',
      summary: 'The server explicitly does not support S256.',
      detail: `${gate.detail ?? ''}\n\n${
        ctx.gates.pkcePlain.state === 'yes'
          ? 'It does advertise `plain`, which SMART 2.0 forbids. Swiss can send `plain` if you need to test against this server, but it is not a conformant configuration.'
          : 'It advertises no usable PKCE method, so an authorization code flow cannot be completed conformantly.'
      }`
    });
  }
};

const grantTypes: Check = {
  id: 'cap.grant-types',
  title: 'Required grants are supported',
  group: 'capabilities',
  async run(ctx) {
    if (!ctx.gates) {
      return result({ status: 'skip', summary: 'No SMART configuration document.' });
    }

    const wantsRefresh =
      ctx.config.scopes.includes('offline_access') || ctx.config.scopes.includes('online_access');
    const notes: string[] = [];
    let status: 'pass' | 'warn' | 'fail' = 'pass';

    const code = ctx.gates.grantAuthorizationCode;
    if (code.state === 'no') {
      status = 'fail';
      notes.push('`authorization_code` is not advertised, so no interactive login is possible.');
    } else if (code.state === 'not-advertised') {
      status = 'warn';
      notes.push('`grant_types_supported` is absent; Swiss assumes `authorization_code` works.');
    }

    // A refresh token actually in hand settles the question, whatever
    // `grant_types_supported` says. Servers under-report it constantly, and
    // warning that refresh is unavailable while the session is holding a
    // refresh token is simply wrong.
    //
    // Only counted when the session is not stale: after a config edit those
    // tokens came from a different server, so they are not evidence about
    // the one being checked now.
    const refreshProven =
      ctx.session !== null && ctx.session.hasRefreshToken && !ctx.session.staleConfig;

    if (wantsRefresh) {
      const refresh = ctx.gates.grantRefreshToken;
      if (refreshProven) {
        if (refresh.state !== 'yes') {
          notes.push(
            "The server issued a refresh token, so the grant works, but it is not listed in `grant_types_supported`. That is a gap in the server's own metadata rather than a problem with your client."
          );
        }
      } else if (refresh.state === 'no') {
        if (status !== 'fail') status = 'warn';
        notes.push(
          'You requested `offline_access` but `refresh_token` is not advertised. You will get an access token with no way to renew it, and the session will simply expire.'
        );
      } else if (refresh.state === 'not-advertised') {
        if (status === 'pass') status = 'warn';
        notes.push('Refresh support is not advertised, so it is unknown until you try it.');
      }
    }

    return result({
      status,
      summary:
        notes.length === 0
          ? 'All the grants Swiss needs are advertised.'
          : status === 'pass'
            ? 'Everything Swiss needs works; one detail of the server metadata is off.'
            : `${notes.length} note(s) about grant support.`,
      detail: notes.map((n) => `- ${n}`).join('\n'),
      // No point telling someone to enable refresh tokens on a client that
      // has just been issued one.
      remediations:
        wantsRefresh && !refreshProven && ctx.gates.grantRefreshToken.state === 'no'
          ? [remediation('refresh-not-enabled')]
          : []
    });
  }
};

const launchFlavor: Check = {
  id: 'cap.launch-flavor',
  title: 'Launch modes are supported',
  group: 'capabilities',
  async run(ctx) {
    if (!ctx.gates) {
      return result({ status: 'skip', summary: 'No SMART configuration document.' });
    }

    const rows = [
      ['Standalone launch', ctx.gates.launchStandalone],
      ['EHR launch', ctx.gates.launchEhr],
      ['Public client', ctx.gates.clientPublic],
      ['Confidential (symmetric)', ctx.gates.clientConfidentialSymmetric],
      ['Confidential (asymmetric / backend services)', ctx.gates.clientConfidentialAsymmetric],
      ['SSO via OpenID Connect', ctx.gates.ssoOpenidConnect]
    ] as const;

    const advertised = rows.filter(([, g]) => g.state === 'yes').map(([label]) => label);
    const unknown = rows.filter(([, g]) => g.state === 'not-advertised');

    return result({
      status: unknown.length === rows.length ? 'warn' : 'pass',
      summary:
        advertised.length > 0
          ? `Advertised: ${advertised.join(', ')}.`
          : 'The server advertises no launch capabilities.',
      detail: rows
        .map(
          ([label, gate]) =>
            `- ${label}: **${gate.state === 'yes' ? 'supported' : gate.state === 'no' ? 'not supported' : 'not advertised'}**${gate.detail ? ` — ${gate.detail}` : ''}`
        )
        .join('\n')
    });
  }
};

const scopes: Check = {
  id: 'cap.scopes',
  title: 'Requested scopes are supported',
  group: 'capabilities',
  async run(ctx) {
    const requested = ctx.config.scopes.split(/\s+/).filter(Boolean);
    const supported = ctx.gates?.scopesSupported ?? null;

    if (supported === null) {
      return result({
        status: 'warn',
        summary:
          'The server does not publish `scopes_supported`, so requested scopes cannot be checked in advance.',
        detail: `Requested: ${requested.map((s) => `\`${s}\``).join(', ')}\n\nThe granted scope in the token response is the authoritative answer, and Swiss shows the difference after a launch.`
      });
    }

    const unsupported = requested.filter((s) => !supported.includes(s));
    const syntax = ctx.gates?.scopeSyntax ?? 'unknown';
    const usesV1 = requested.some((s) => /\.(read|write|\*)$/.test(s));
    const usesV2 = requested.some((s) => /\.[cruds]+$/.test(s));

    const notes: string[] = [];
    if (unsupported.length > 0) {
      notes.push(
        `Not in \`scopes_supported\`: ${unsupported.map((s) => `\`${s}\``).join(', ')}. Servers commonly under-report this, so Swiss still requests them.`
      );
    }
    if (syntax === 'v2' && usesV1) {
      notes.push(
        'The server advertises `permission-v2` but you are requesting SMART 1.0 syntax (`.read`/`.write`). It may normalise them, which will look like scopes were dropped unless you compare carefully -- Swiss reports a normalisation separately from a real reduction.'
      );
    }
    if (syntax === 'v1' && usesV2) {
      notes.push(
        'The server advertises only `permission-v1` but you are requesting SMART 2.0 syntax (`.rs`/`.cruds`), which it may not understand.'
      );
    }

    return result({
      // Never a failure: only the token response settles this.
      status: notes.length > 0 ? 'warn' : 'pass',
      summary:
        notes.length > 0
          ? `${notes.length} note(s) about the requested scopes.`
          : `All ${requested.length} requested scopes are advertised as supported.`,
      detail: notes.map((n) => `- ${n}`).join('\n'),
      remediations: unsupported.length > 0 ? [remediation('scope-not-granted')] : []
    });
  }
};

const clientAuth: Check = {
  id: 'cap.client-auth',
  title: 'Client authentication method is accepted',
  group: 'capabilities',
  async run(ctx) {
    const hasSecret = Boolean(ctx.config.clientSecret);
    const suggestion = ctx.gates
      ? suggestClientAuthMethod(ctx.gates, hasSecret)
      : { method: 'none' as const, reason: 'No capabilities document.' };

    const configured = ctx.config.clientAuthMethod;
    const advertised = ctx.gates?.tokenAuthMethodsSupported;

    if (configured === suggestion.method) {
      return result({
        status: 'pass',
        summary: `Using ${describeMethod(configured)}. ${suggestion.reason}`
      });
    }

    return result({
      status: 'warn',
      summary: `Configured for ${describeMethod(configured)}, but ${describeMethod(suggestion.method)} looks more likely to work.`,
      detail: `${suggestion.reason}\n\n${
        advertised
          ? `The server advertises: ${advertised.map((m) => `\`${m}\``).join(', ')}.`
          : 'The server does not advertise `token_endpoint_auth_methods_supported`.'
      }`,
      remediations: [
        {
          id: 'client-auth-suggestion',
          label: `Switch to ${describeMethod(suggestion.method)}`,
          body: suggestion.reason,
          actions: [
            {
              kind: 'set-config',
              label: `Use ${describeMethod(suggestion.method)}`,
              patch: { clientAuthMethod: suggestion.method }
            }
          ]
        }
      ]
    });
  }
};

const sso: Check = {
  id: 'cap.sso',
  title: 'OpenID Connect claims are available',
  group: 'capabilities',
  async run(ctx) {
    const requested = ctx.config.scopes.split(/\s+/).filter(Boolean);
    const wantsOpenid = requested.includes('openid');
    const wantsFhirUser = requested.includes('fhirUser');

    if (!wantsOpenid && !wantsFhirUser) {
      return result({
        status: 'pass',
        summary: 'No OpenID Connect scopes requested, so no ID token is expected.'
      });
    }

    if (wantsFhirUser && !wantsOpenid) {
      return result({
        status: 'fail',
        summary: 'You requested `fhirUser` without `openid`, so the claim can never arrive.',
        detail:
          '`fhirUser` is an ID token claim. Without `openid` the server issues no ID token, so there is nowhere for the claim to appear.',
        remediations: [
          {
            id: 'add-openid-scope',
            label: 'Add the openid scope',
            body: 'Adds `openid` to the requested scopes so an ID token is issued.',
            actions: [
              {
                kind: 'set-config',
                label: 'Add openid',
                patch: { scopes: `openid ${ctx.config.scopes}`.trim() }
              }
            ]
          }
        ]
      });
    }

    const gate = ctx.gates?.ssoOpenidConnect;
    if (!gate || gate.state === 'not-advertised') {
      return result({
        status: 'warn',
        summary:
          'You requested OpenID Connect scopes but the server does not advertise `sso-openid-connect`.',
        detail: 'Swiss will request them anyway; the token response will settle it.'
      });
    }
    if (gate.state === 'no') {
      return result({
        status: 'warn',
        summary:
          'The server advertises capabilities but not `sso-openid-connect`, so an ID token may not be issued.'
      });
    }

    return result({
      status: gateStatus(gate),
      summary: 'The server advertises `sso-openid-connect`, so an ID token is expected.'
    });
  }
};

function describeMethod(method: string): string {
  switch (method) {
    case 'none':
      return 'a public client (PKCE only)';
    case 'basic':
      return 'HTTP Basic';
    case 'body':
      return 'a request-body secret';
    default:
      return method;
  }
}

export const capabilityChecks: Check[] = [pkce, grantTypes, launchFlavor, scopes, clientAuth, sso];
