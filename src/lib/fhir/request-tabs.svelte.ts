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

import { config } from '#lib/config/config.svelte.ts';
import { switchEnvironment } from '#lib/environments/switch.ts';
import type { FhirMethod, FhirResponse } from './client';
import type { DenialHint } from './denial';
import {
  blankDraft,
  cleanTabName,
  draftTitle,
  followEnvironment,
  MAX_REQUEST_TABS,
  moveTab,
  parseRequestTabs,
  serializeRequestTabs,
  tabAfterClose,
  type RequestDraft
} from './request-tabs';
import type { BodyFormat } from './xml';

/**
 * The FHIR console's open request tabs.
 *
 * A browser tab keeps its own set in sessionStorage, so a reload brings them
 * back and two browser tabs never edit each other's. The last set written by
 * any browser tab is also kept in localStorage, and a new browser tab starts
 * from it, as reopening an API client brings back its tabs. Only the drafts
 * are kept: responses stay in memory, and headers are the environment's,
 * stored by the header editor under its own rules.
 */

export const REQUEST_TABS_KEY = 'swiss.requests.v1';
export const LAST_REQUEST_TABS_KEY = 'swiss.requests.last.v1';
const SAVE_DELAY_MS = 300;

/** One open tab: its draft, and the request and response it is showing. */
export class RequestTab {
  readonly id: string;
  environmentId = $state('');
  name = $state('');
  method = $state<FhirMethod>('GET');
  // Starts empty. The input's placeholder shows the expected shape instead
  // of prefilling a value the user then has to delete.
  query = $state('');
  body = $state('');
  /**
   * The format the body is typed in, and the one responses are asked for.
   * Switching the body's format does not convert what is typed: that needs
   * the FHIR type model, and a body that is not what the user wrote is not a
   * test of the server.
   */
  bodyFormat = $state<BodyFormat>('json');
  responseFormat = $state<BodyFormat>('json');

  // Not kept across a reload: a write, and sending the token elsewhere, are
  // decided again each time.
  enableWrites = $state(false);
  allowCrossOriginToken = $state(false);

  loading = $state(false);
  /** Raw, not deep: a response can be a large Bundle that is only ever read. */
  response = $state.raw<FhirResponse | null>(null);
  /** Why a 401 or 403 may have happened, worked out when it arrived. */
  denial = $state.raw<DenialHint | null>(null);
  error = $state<string | null>(null);
  sentUrl = $state<string | null>(null);
  /** The FHIR base the response came from. */
  configAtResult = $state<string | null>(null);
  /** What the last request was, so switching the response format can ask again. */
  lastSent = $state.raw<{ query: string; method: FhirMethod } | null>(null);
  /** The format the last request asked for, or null when the user's own Accept was sent. */
  askedFor = $state<BodyFormat | null>(null);
  /** Why switching the response format did not send anything. */
  formatNote = $state<string | null>(null);
  /** The last request was cancelled before it answered. */
  cancelled = $state(false);
  controller: AbortController | null = null;

  constructor(draft: RequestDraft) {
    this.id = draft.id;
    this.environmentId = draft.environmentId;
    this.name = draft.name;
    this.method = draft.method;
    this.query = draft.query;
    this.body = draft.body;
    this.bodyFormat = draft.bodyFormat;
    this.responseFormat = draft.responseFormat;
  }

  get draft(): RequestDraft {
    return {
      id: this.id,
      environmentId: this.environmentId,
      name: this.name,
      method: this.method,
      query: this.query,
      body: this.body,
      bodyFormat: this.bodyFormat,
      responseFormat: this.responseFormat
    };
  }

  readonly title = $derived(draftTitle(this));

  /** Nothing typed, named or sent: moving it to another environment loses nothing. */
  get untouched(): boolean {
    return (
      !this.name &&
      this.query.trim() === '' &&
      this.body.trim() === '' &&
      this.response === null &&
      this.error === null &&
      !this.loading
    );
  }

  /** Stops what is in flight. */
  abort(): void {
    this.controller?.abort();
    this.controller = null;
    this.loading = false;
  }
}

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string): void {
  try {
    storage().setItem(key, value);
  } catch {
    /* full or unavailable: kept for this page view */
  }
}

class RequestTabs {
  #tabs = $state<RequestTab[]>([]);
  #selectedId = $state('');
  #loaded = false;
  #saveTimer: ReturnType<typeof setTimeout> | null = null;

  readonly tabs = $derived(this.#tabs);
  readonly selected: RequestTab | undefined = $derived(
    this.#tabs.find((t) => t.id === this.#selectedId) ?? this.#tabs[0]
  );
  readonly full = $derived(this.#tabs.length >= MAX_REQUEST_TABS);

  /**
   * Reads the stored tabs once, then shows the one for the environment the
   * app is on. Tabs on an environment that no longer exists are dropped.
   */
  load(): void {
    if (this.#loaded) return;
    this.#loaded = true;
    const stored =
      parseRequestTabs(read(() => sessionStorage, REQUEST_TABS_KEY)) ??
      parseRequestTabs(read(() => localStorage, LAST_REQUEST_TABS_KEY));
    const tabs = (stored?.tabs ?? [])
      .filter((d) => config.hasEnvironment(d.environmentId))
      .map((d) => new RequestTab(d));
    this.#tabs = tabs;
    this.#selectedId = tabs.find((t) => t.id === stored?.selectedId)?.id ?? tabs[0]?.id ?? '';
    this.follow(config.activeEnvironmentId);
  }

  /** Brings up a tab for the environment the app is now on. See followEnvironment. */
  follow(environmentId: string): void {
    const selected = this.selected;
    if (!selected) {
      this.#add(environmentId);
      return;
    }
    const action = followEnvironment(this.#tabs, selected.id, environmentId, selected.untouched);
    if (action.kind === 'select') this.#selectedId = action.id;
    else if (action.kind === 'retarget') selected.environmentId = environmentId;
    else if (action.kind === 'open') this.#add(environmentId);
    this.scheduleSave();
  }

  /** Shows a tab, and switches the app to its environment. */
  select(id: string): void {
    const target = this.#tabs.find((t) => t.id === id);
    if (!target) return;
    this.#selectedId = id;
    if (!switchEnvironment(target.environmentId)) {
      // Its environment went while the page was open.
      target.environmentId = config.activeEnvironmentId;
    }
    this.scheduleSave();
  }

  /** Opens a new tab on an environment, and shows it. False at the tab limit. */
  open(environmentId: string): boolean {
    if (this.full || !config.hasEnvironment(environmentId)) return false;
    const tab = this.#add(environmentId);
    this.select(tab.id);
    return true;
  }

  /** Closes a tab. The last one closing leaves a new, empty one on the same environment. */
  close(id: string): void {
    const closing = this.#tabs.find((t) => t.id === id);
    if (!closing) return;
    closing.abort();
    const next = tabAfterClose(this.#tabs, id, this.selected?.id ?? '');
    this.#tabs = this.#tabs.filter((t) => t.id !== id);
    if (next === null) {
      this.#add(config.activeEnvironmentId);
    } else if (next !== this.#selectedId) {
      this.select(next);
    }
    this.scheduleSave();
  }

  /** Moves a tab next to another, after it when `after`. */
  move(id: string, targetId: string, after: boolean): void {
    this.#tabs = moveTab(this.#tabs, id, targetId, after);
    this.scheduleSave();
  }

  rename(id: string, raw: string): void {
    const tab = this.#tabs.find((t) => t.id === id);
    if (!tab) return;
    tab.name = cleanTabName(raw);
    this.scheduleSave();
  }

  /** Closes the tabs of environments that are gone, as deleting one removes its other data. */
  prune(): void {
    const gone = this.#tabs.filter((t) => !config.hasEnvironment(t.environmentId));
    if (gone.length === 0) return;
    for (const tab of gone) tab.abort();
    this.#tabs = this.#tabs.filter((t) => !gone.includes(t));
    if (this.#tabs.length === 0 || !this.#tabs.some((t) => t.id === this.#selectedId)) {
      this.follow(config.activeEnvironmentId);
    }
    this.scheduleSave();
  }

  /** Every draft and the selection, read so an effect can track them. */
  snapshot(): string {
    return serializeRequestTabs(
      this.selected?.id ?? '',
      this.#tabs.map((t) => t.draft)
    );
  }

  /** Writes soon: typing should not rewrite storage on every key. */
  scheduleSave(): void {
    if (!this.#loaded) return;
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.save(), SAVE_DELAY_MS);
  }

  /** Writes now, for a page about to go. */
  save(): void {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
    if (!this.#loaded) return;
    const value = this.snapshot();
    write(() => sessionStorage, REQUEST_TABS_KEY, value);
    write(() => localStorage, LAST_REQUEST_TABS_KEY, value);
  }

  #add(environmentId: string): RequestTab {
    const tab = new RequestTab(blankDraft(environmentId));
    this.#tabs = [...this.#tabs, tab];
    this.#selectedId = tab.id;
    return tab;
  }
}

export const requestTabs = new RequestTabs();
