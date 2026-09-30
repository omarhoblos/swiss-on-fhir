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

import { redactExchange, type HttpExchange } from '$lib/http/exchange';
import { probeJson } from '$lib/http/probe';
import { FHIR_USER_TYPES, parseFhirUser } from '$lib/smart/context';
import { originOf } from '$lib/url';
import { remediation, remediations } from '../remediation';
import { result, type Check, type CheckStatus, type DiagnosticsContext } from '../types';

/**
 * Checks that need a live session: what the server issued at sign-in,
 * tested against the server itself.
 */

const FHIR_USER_SPEC = {
  name: 'SMART App Launch: fhirUser',
  url: 'https://hl7.org/fhir/smart-app-launch/scopes-and-launch-context.html#scopes-for-requesting-identity-data'
};

const SOURCE_LABEL = {
  'token-response': 'the token response',
  'id-token': 'the ID token',
  'access-token': 'the access token'
} as const;

/** `Type/id` from a FHIR reference such as `Patient/patient-a` or a full URL ending in one. */
function typeAndId(reference: unknown): { type: string; id: string } | null {
  if (typeof reference !== 'string') return null;
  const parts = reference.split(/[?#]/)[0]?.split('/').filter(Boolean) ?? [];
  const id = parts.pop();
  const type = parts.pop();
  return type && id ? { type, id } : null;
}

const RANK: Record<CheckStatus, number> = {
  pass: 0,
  manual: 0,
  running: 0,
  skip: 1,
  warn: 2,
  fail: 3
};

/**
 * Whether the `fhirUser` the server issued names a resource it can serve.
 *
 * SMART defines `fhirUser` as the URL of the FHIR resource for the signed-in
 * user. A claim that is well formed, and signed, can still name a record the
 * FHIR server does not have, or one on another server. The Session screen
 * shows the claim; this reads it, as the session, from the FHIR base the
 * token was issued for.
 */
const fhirUserResolves: Check = {
  id: 'flow.fhir-user',
  title: 'fhirUser names a resource the FHIR server has',
  group: 'flow',
  async run(ctx: DiagnosticsContext) {
    const session = ctx.session;
    if (!session) {
      return result({
        status: 'skip',
        summary: 'Needs a session. Sign in on the Launch screen, then run the checks again.'
      });
    }

    const granted = (session.grantedScopes ?? '').split(/\s+/);
    if (!session.fhirUser) {
      return granted.includes('fhirUser') && granted.includes('openid')
        ? result({
            status: 'warn',
            summary:
              'The server granted `fhirUser` but issued no `fhirUser` claim, so there is no record of who signed in.',
            spec: FHIR_USER_SPEC
          })
        : result({
            status: 'skip',
            summary:
              'This session did not ask for `fhirUser` with `openid`, so there is no claim to check.'
          });
    }

    const tokenBase = session.tokenBase || ctx.config.fhirBaseUrl;
    const claim = session.fhirUser.value;
    const parsed = parseFhirUser(claim, tokenBase);
    if (!parsed) {
      return result({
        status: 'fail',
        summary: `\`fhirUser\` is \`${claim}\`, which is not a reference to a FHIR resource.`,
        detail: 'SMART expects the URL of a resource such as `Patient/123` or `Practitioner/abc`.',
        spec: FHIR_USER_SPEC
      });
    }

    const findings: { status: CheckStatus; text: string }[] = [];
    const note = (status: CheckStatus, text: string) => findings.push({ status, text });
    const label = `${parsed.resourceType}/${parsed.id}`;

    note('pass', `The claim came from ${SOURCE_LABEL[session.fhirUser.source]}.`);
    if (session.fhirUser.source === 'id-token' && session.idTokenVerified === false) {
      note(
        'warn',
        'The ID token it came from did not verify, so the claim itself cannot be trusted. See the ID token panel on the Session screen.'
      );
    }
    if (session.fhirUser.source === 'access-token') {
      note(
        'warn',
        'It was read from the access token, which SMART treats as opaque to the app. The ID token is where `fhirUser` belongs.'
      );
    }
    if (parsed.unexpectedType) {
      note(
        'warn',
        `\`${parsed.unexpectedType}\` is not one of the types SMART allows for \`fhirUser\`: ${FHIR_USER_TYPES.join(', ')}.`
      );
    }

    // Where to read it. Always the FHIR base the token was issued for: the
    // token never goes to another origin, and a claim built on another
    // server's address is looked up here by type and id instead.
    const baseOrigin = originOf(tokenBase);
    let url: string;
    if (parsed.absolute && originOf(claim) !== baseOrigin) {
      note(
        'warn',
        `The claim is on \`${originOf(claim) ?? claim}\`, not the FHIR base \`${tokenBase}\`, so an app following it would leave the FHIR server. Swiss looked up \`${label}\` on the FHIR base instead.`
      );
      url = `${tokenBase.replace(/\/+$/, '')}/${encodeURIComponent(parsed.resourceType)}/${encodeURIComponent(parsed.id)}`;
    } else if (parsed.absolute) {
      url = claim;
    } else {
      url = `${tokenBase.replace(/\/+$/, '')}/${encodeURIComponent(parsed.resourceType)}/${encodeURIComponent(parsed.id)}`;
    }

    const headers: Record<string, string> = { Accept: 'application/fhir+json' };
    if (session.accessToken && baseOrigin !== null && originOf(url) === baseOrigin) {
      headers.Authorization = `Bearer ${session.accessToken}`;
    }

    const { exchange, json } = await probeJson(url, {
      label: `fhirUser ${label}`,
      headers,
      fetchImpl: ctx.fetchImpl,
      signal: ctx.signal
    });
    const shown: HttpExchange = ctx.config.redactSecrets ? redactExchange(exchange) : exchange;

    /** The result: its own status, raised to the worst finding, with every finding listed. */
    const finish = (
      summary: string,
      extra: {
        status?: CheckStatus;
        detail?: string;
        remediations?: ReturnType<typeof remediations>;
      } = {}
    ) => {
      const status = findings.reduce<CheckStatus>(
        (worst, f) => (RANK[f.status] > RANK[worst] ? f.status : worst),
        extra.status ?? 'pass'
      );
      const detail = [findings.map((f) => `- ${f.text}`).join('\n'), extra.detail]
        .filter(Boolean)
        .join('\n\n');
      return result({
        status,
        summary,
        detail,
        remediations: extra.remediations,
        exchanges: [shown],
        spec: FHIR_USER_SPEC
      });
    };

    if (exchange.outcome === 'aborted') {
      return result({ status: 'skip', summary: 'Stopped before the server answered.' });
    }
    if (
      exchange.outcome === 'network-or-cors' ||
      exchange.outcome === 'blocked-precondition' ||
      exchange.outcome === 'timeout'
    ) {
      return finish(`Could not read \`${label}\` from the FHIR server.`, {
        status: 'fail',
        detail: exchange.diagnosis?.evidence.map((e) => `- ${e}`).join('\n'),
        remediations: remediations(exchange.diagnosis?.remediationIds ?? [])
      });
    }

    const status = exchange.response?.status ?? 0;
    if (status === 404 || status === 410) {
      return finish(
        `\`fhirUser\` names \`${label}\`, which the FHIR server does not have (${status}).`,
        { status: 'fail', remediations: [remediation('fhir-user-unresolved')] }
      );
    }
    if (status === 401 || status === 403) {
      return finish(`The FHIR server would not return \`${label}\` to this session (${status}).`, {
        status: 'warn',
        detail: `It may exist but be outside what the granted scopes cover. Granted: \`${session.grantedScopes ?? 'unknown'}\`.`
      });
    }
    if (status >= 400 || !json || typeof json !== 'object') {
      return finish(
        `Reading \`${label}\` did not return a FHIR resource (${status || exchange.outcome}).`,
        {
          status: 'warn'
        }
      );
    }

    const resource = json as Record<string, unknown>;
    if (resource.resourceType !== parsed.resourceType || resource.id !== parsed.id) {
      note(
        'warn',
        `The server answered with \`${String(resource.resourceType)}/${String(resource.id)}\`, not \`${label}\`.`
      );
    }

    // The user and the launch context should describe the same person, or
    // someone acting for them.
    if (session.patient) {
      if (parsed.resourceType === 'Patient' && parsed.id !== session.patient) {
        note(
          'warn',
          `The user is \`Patient/${parsed.id}\`, but the launch context is \`Patient/${session.patient}\`. A patient user normally launches into their own record.`
        );
      }
      if (parsed.resourceType === 'RelatedPerson') {
        const linked = typeAndId(
          (resource.patient as { reference?: unknown } | undefined)?.reference
        );
        if (!linked) {
          note(
            'warn',
            '`RelatedPerson.patient` is missing, so nothing says whose record this user may act on.'
          );
        } else if (linked.id !== session.patient) {
          note(
            'warn',
            `\`RelatedPerson.patient\` is \`${linked.type}/${linked.id}\`, but the launch context is \`Patient/${session.patient}\`.`
          );
        } else {
          note(
            'pass',
            `\`RelatedPerson.patient\` is \`Patient/${session.patient}\`, the patient in context.`
          );
        }
      }
    }

    const matchesContext =
      parsed.resourceType === 'Patient' && session.patient === parsed.id
        ? ', the patient in context'
        : '';
    return finish(`\`fhirUser\` resolves to \`${label}\`${matchesContext}.`);
  }
};

export const flowChecks: Check[] = [fhirUserResolves];
