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

import { request, type APIRequestContext } from '@playwright/test';

/**
 * Inferno's JSON API, as its web interface uses it, for the SMART App Launch
 * STU2.2 client suite. Inferno's simulated SMART server lives under
 * /custom/smart_client_stu2_2.
 */
export const INFERNO = 'http://localhost:4570';
export const CLIENT_SUITE = 'smart_client_stu2_2';
export const INFERNO_FHIR = `${INFERNO}/custom/${CLIENT_SUITE}/fhir`;

export const CLIENT_TYPES = {
  public: 'SMART,authorization_code,public',
  symmetric: 'SMART,authorization_code,confidential_symmetric',
  asymmetric: 'SMART,authorization_code,confidential_asymmetric',
  backend: 'SMART,client_credentials,confidential_asymmetric'
} as const;

export type ClientType = keyof typeof CLIENT_TYPES;

export interface InfernoResult {
  test: string;
  result: string;
  message: string;
  messages: string[];
}

/** Inferno's JSON can carry raw control characters in strings; JSON.parse refuses them. */
async function json(response: { text(): Promise<string> }): Promise<unknown> {
  // eslint-disable-next-line no-control-regex
  return JSON.parse((await response.text()).replace(/[\u0000-\u001f]/g, ' '));
}

export class Inferno {
  private constructor(private api: APIRequestContext) {}

  static async connect(): Promise<Inferno | null> {
    const api = await request.newContext({ baseURL: INFERNO });
    try {
      const response = await api.get('/api/test_suites', { timeout: 5_000 });
      if (response.ok()) return new Inferno(api);
    } catch {
      /* not running */
    }
    await api.dispose();
    return null;
  }

  async createSession(clientType: ClientType): Promise<string> {
    const response = await this.api.post('/api/test_sessions', {
      data: {
        test_suite_id: CLIENT_SUITE,
        suite_options: [{ id: 'client_type', value: CLIENT_TYPES[clientType] }]
      }
    });
    const session = (await json(response)) as { id: string };
    return session.id;
  }

  async startRun(sessionId: string, inputs: Record<string, string>): Promise<void> {
    const response = await this.api.post('/api/test_runs', {
      data: {
        test_session_id: sessionId,
        test_suite_id: CLIENT_SUITE,
        inputs: Object.entries(inputs).map(([name, value]) => ({ name, value }))
      }
    });
    if (!response.ok()) throw new Error(`Starting the run failed: ${await response.text()}`);
  }

  async runStatus(sessionId: string): Promise<string> {
    const run = (await json(
      await this.api.get(`/api/test_sessions/${sessionId}/last_test_run`)
    )) as {
      status: string;
    };
    return run.status;
  }

  async waitForStatus(sessionId: string, statuses: string[], timeoutMs = 120_000): Promise<string> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const status = await this.runStatus(sessionId);
      if (statuses.includes(status) || Date.now() > until) return status;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  async sessionValue(sessionId: string, name: string): Promise<string | undefined> {
    const data = (await json(
      await this.api.get(`/api/test_sessions/${sessionId}/session_data`)
    )) as {
      name: string;
      value?: string;
    }[];
    return data.find((entry) => entry.name === name)?.value;
  }

  async results(sessionId: string): Promise<InfernoResult[]> {
    const results = (await json(await this.api.get(`/api/test_sessions/${sessionId}/results`))) as {
      test_id?: string;
      result: string;
      result_message?: string;
      messages?: { type: string; message: string }[];
    }[];
    return results
      .filter((r) => r.test_id)
      .map((r) => ({
        test: (r.test_id ?? '').split('-').pop() ?? '',
        result: r.result,
        message: r.result_message ?? '',
        messages: (r.messages ?? []).map((m) => `${m.type}: ${m.message}`)
      }));
  }

  async dispose(): Promise<void> {
    await this.api.dispose();
  }
}
