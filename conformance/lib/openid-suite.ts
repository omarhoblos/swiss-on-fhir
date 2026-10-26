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
 * The OpenID Foundation conformance suite's REST API, as its own
 * scripts/conformance.py uses it. In development mode it needs no token.
 */
export const OPENID_SUITE = 'https://localhost.emobix.co.uk:8443';
export const BASIC_RP_PLAN = 'oidcc-client-basic-certification-test-plan';

export interface ModuleInfo {
  status: string | null;
  result: string | null;
}

export class OpenIdSuite {
  private constructor(private api: APIRequestContext) {}

  static async connect(): Promise<OpenIdSuite | null> {
    const api = await request.newContext({ baseURL: OPENID_SUITE, ignoreHTTPSErrors: true });
    try {
      const response = await api.get('/api/runner/available', { timeout: 5_000 });
      if (response.ok()) return new OpenIdSuite(api);
    } catch {
      /* not running */
    }
    await api.dispose();
    return null;
  }

  async createPlan(
    config: unknown,
    variant: Record<string, string>
  ): Promise<{ id: string; modules: string[] }> {
    const response = await this.api.post('/api/plan', {
      params: { planName: BASIC_RP_PLAN, variant: JSON.stringify(variant) },
      data: config
    });
    if (response.status() !== 201)
      throw new Error(`Creating the plan failed: ${await response.text()}`);
    const plan = await response.json();
    return { id: plan.id, modules: plan.modules.map((m: { testModule: string }) => m.testModule) };
  }

  /** Creates a test from the plan; it waits for the client from then on. */
  async startModule(planId: string, module: string): Promise<{ id: string; issuer: string }> {
    const response = await this.api.post('/api/runner', { params: { test: module, plan: planId } });
    if (response.status() !== 201)
      throw new Error(`Starting ${module} failed: ${await response.text()}`);
    const { id } = await response.json();
    const runner = await (await this.api.get(`/api/runner/${id}`)).json();
    return { id, issuer: runner.exposed.issuer };
  }

  async info(id: string): Promise<ModuleInfo> {
    const info = await (await this.api.get(`/api/info/${id}`)).json();
    return { status: info.status ?? null, result: info.result ?? null };
  }

  async waitFor(id: string, states: string[], timeoutMs = 120_000): Promise<ModuleInfo> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const info = await this.info(id);
      if (info.status && states.includes(info.status)) return info;
      if (Date.now() > until) return info;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  /**
   * The client's next request after a sound sign-in: UserInfo, with the
   * access token. Swiss has no UserInfo client, so the harness makes it,
   * standing in for an app; the suite finishes a positive test on it.
   */
  async callUserinfo(issuer: string, accessToken: string): Promise<number> {
    const response = await this.api.get(`${issuer.replace(/\/$/, '')}/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return response.status();
  }

  /** The suite's own log for a test: the conditions it checked and why it failed. */
  async failures(id: string): Promise<string[]> {
    const log: { result?: string; msg?: string }[] = await (
      await this.api.get(`/api/log/${id}`)
    ).json();
    return log
      .filter((entry) => entry.result === 'FAILURE' || entry.result === 'WARNING')
      .map((entry) => `${entry.result}: ${entry.msg ?? ''}`);
  }

  async dispose(): Promise<void> {
    await this.api.dispose();
  }
}
