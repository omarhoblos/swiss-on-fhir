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

import { cleanTabLabel, copiedTabLabel, isTabId } from '#lib/tab-label.ts';

/**
 * This browser tab's identity, its label, and the channel tabs talk on.
 *
 * Swiss keeps what a tab is doing in that tab, so tabs need a way to tell
 * themselves apart and to warn each other: a tab id that survives a reload
 * (sessionStorage), and a BroadcastChannel, which works over plain http,
 * unlike Web Locks or crypto.subtle.
 *
 * A browser's "Duplicate tab" copies sessionStorage, id included. On load a
 * tab asks whether a live tab already has its id; one that is told yes takes
 * a new id, so the original keeps its log entries. Two tabs loading at the
 * same instant can both keep the copied id, since neither has settled to
 * answer; that is rare enough to accept.
 */

export const TAB_ID_KEY = 'swiss.tab.v1';
export const TAB_LABEL_KEY = 'swiss.tab.label.v1';
export const APP_TITLE = 'Swiss on FHIR';

/** How long a new tab waits for another to say it already has the id. */
const DUPLICATE_WAIT_MS = 150;

export type TabMessage =
  | { type: 'hello'; tabId: string; nonce: string }
  | { type: 'taken'; tabId: string; nonce: string }
  /** A refresh token, by fingerprint, has been rotated and must not be sent again. */
  | { type: 'rt-rotated'; fingerprint: string }
  /** A tab changed what it stored in the log. */
  | { type: 'log-changed'; tabId: string };

/** Messages arrive from any script on this origin, so they are checked like other input. */
export function isTabMessage(raw: unknown): raw is TabMessage {
  if (!raw || typeof raw !== 'object') return false;
  const m = raw as Record<string, unknown>;
  const short = (value: unknown) => typeof value === 'string' && value.length <= 64;
  switch (m.type) {
    case 'hello':
    case 'taken':
      return short(m.tabId) && short(m.nonce);
    case 'rt-rotated':
      return short(m.fingerprint);
    case 'log-changed':
      return short(m.tabId);
    default:
      return false;
  }
}

function randomTabId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  while (id.length < 8) {
    for (const byte of crypto.getRandomValues(new Uint8Array(12))) {
      if (byte < 252 && id.length < 8) id += alphabet[byte % alphabet.length];
    }
  }
  return id;
}

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* kept for this page view only */
  }
}

class TabIdentity {
  #id = $state('');
  #label = $state('');
  #settled = false;
  #ready: Promise<void>;
  #channel: BroadcastChannel | null = null;
  #listeners = new Set<(message: TabMessage) => void>();

  constructor() {
    const stored = readSession(TAB_ID_KEY);
    this.#id = isTabId(stored) ? stored : randomTabId();
    writeSession(TAB_ID_KEY, this.#id);
    this.#label = cleanTabLabel(readSession(TAB_LABEL_KEY));

    try {
      this.#channel =
        typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('swiss');
    } catch {
      this.#channel = null;
    }
    this.#channel?.addEventListener('message', (event) => {
      if (isTabMessage(event.data)) this.#receive(event.data);
    });

    this.#ready = this.#checkForDuplicate();
  }

  /** This tab's id, stable across reloads. */
  get id(): string {
    return this.#id;
  }

  /** The label the user gave this tab, or ''. */
  get label(): string {
    return this.#label;
  }

  /** What to call this tab: its label, or `Tab` and the start of its id. */
  get displayLabel(): string {
    return this.#label || `Tab ${this.#id.slice(0, 4)}`;
  }

  /** The document title, with this tab's label in front when it has one. */
  title(page: string = APP_TITLE): string {
    return this.#label ? `${this.#label} · ${page}` : page;
  }

  /** Settles once the duplicate check is done and the id is final. */
  ready(): Promise<void> {
    return this.#ready;
  }

  /** Renames this tab; an empty label goes back to the default. */
  setLabel(raw: string): void {
    this.#label = cleanTabLabel(raw);
    writeSession(TAB_LABEL_KEY, this.#label || null);
  }

  post(message: TabMessage): void {
    try {
      this.#channel?.postMessage(message);
    } catch {
      /* closed or unavailable: other tabs simply do not hear it */
    }
  }

  /** Listens for messages from other tabs; returns the unsubscribe function. */
  subscribe(listener: (message: TabMessage) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #receive(message: TabMessage): void {
    // Only a settled tab answers: one still checking may itself be the copy.
    if (message.type === 'hello' && this.#settled && message.tabId === this.#id) {
      this.post({ type: 'taken', tabId: this.#id, nonce: message.nonce });
      return;
    }
    for (const listener of this.#listeners) listener(message);
  }

  async #checkForDuplicate(): Promise<void> {
    if (!this.#channel) {
      this.#settled = true;
      return;
    }
    const nonce = randomTabId();
    const original = this.#id;
    const taken = await new Promise<boolean>((resolve) => {
      const unsubscribe = this.subscribe((message) => {
        if (message.type === 'taken' && message.nonce === nonce && message.tabId === original) {
          unsubscribe();
          resolve(true);
        }
      });
      setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, DUPLICATE_WAIT_MS);
      this.post({ type: 'hello', tabId: original, nonce });
    });
    if (taken) {
      this.#id = randomTabId();
      writeSession(TAB_ID_KEY, this.#id);
      if (this.#label) this.setLabel(copiedTabLabel(this.#label));
    }
    this.#settled = true;
  }
}

export const tab = new TabIdentity();
