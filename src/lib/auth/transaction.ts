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

import type { ConfigSnapshot } from '$lib/config/types';
import type { Pkce } from '$lib/oidc/pkce';
import type { ResolvedEndpoints } from '$lib/smart/types';

/**
 * In-flight authorization state, persisted across the redirect.
 *
 * sessionStorage is the right lifetime: a top-level OAuth redirect stays in
 * the same tab and origin, so sessionStorage survives it and nothing longer.
 * It is also not shared across tabs, so two concurrent tests cannot stomp
 * each other's verifier (localStorage would), and it dies with the tab
 * rather than leaving a verifier on disk.
 */

export type LaunchFlavor = 'standalone' | 'ehr' | 'backend-services';

export interface LaunchIntent {
  flavor: LaunchFlavor;
  /** EHR launch only: the opaque token from the launch URL. */
  launch?: string;
  /** EHR launch only: the FHIR base the EHR supplied via `iss`. */
  iss?: string;
}

export type TransactionStatus = 'pending' | 'exchanging' | 'consumed' | 'failed';

export interface AuthTransaction {
  state: string;
  nonce?: string;
  pkce: Pkce;
  /** Snapshotted, because it must match the token request byte for byte. */
  redirectUri: string;
  clientId: string;
  requestedScopes: string;
  authorizeUrl: string;
  endpoints: ResolvedEndpoints;
  /**
   * The config as it was at authorize time. Lets Swiss say precisely what
   * changed if the user edits settings mid-flow, instead of producing an
   * inexplicable invalid_grant.
   */
  configSnapshot: ConfigSnapshot;
  intent: LaunchIntent;
  createdAt: number;
  status: TransactionStatus;
}

const PREFIX = 'swiss.tx.v1.';
const INDEX_KEY = 'swiss.tx.v1.index';
const MAX_INDEXED = 10;
export const TRANSACTION_TTL_MS = 10 * 60_000;

/** Set while a redirect is in flight, so config edits can be blocked. */
const FLOW_STATE_KEY = 'swiss.flow.v1';

export type FlowState = 'idle' | 'redirecting' | 'handling-callback';

function safeSession(): Storage | null {
  try {
    // Touch it: a partitioned iframe throws on access, not just on write.
    void sessionStorage.length;
    return sessionStorage;
  } catch {
    return null;
  }
}

/** In-memory fallback so a launch still works where storage is blocked. */
const memory = new Map<string, string>();

function read(key: string): string | null {
  const store = safeSession();
  if (store) {
    try {
      return store.getItem(key);
    } catch {
      /* fall through to memory */
    }
  }
  return memory.get(key) ?? null;
}

function write(key: string, value: string): void {
  const store = safeSession();
  if (store) {
    try {
      store.setItem(key, value);
      return;
    } catch {
      /* fall through to memory */
    }
  }
  memory.set(key, value);
}

function remove(key: string): void {
  const store = safeSession();
  if (store) {
    try {
      store.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  memory.delete(key);
}

function readIndex(): string[] {
  const raw = read(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(states: string[]): void {
  write(INDEX_KEY, JSON.stringify(states.slice(0, MAX_INDEXED)));
}

export function saveTransaction(tx: AuthTransaction): void {
  write(PREFIX + tx.state, JSON.stringify(tx));
  writeIndex([tx.state, ...readIndex().filter((s) => s !== tx.state)]);
}

export function loadTransaction(state: string): AuthTransaction | null {
  const raw = read(PREFIX + state);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthTransaction;
  } catch {
    return null;
  }
}

export function updateTransactionStatus(state: string, status: TransactionStatus): void {
  const tx = loadTransaction(state);
  if (!tx) return;
  saveTransaction({ ...tx, status });
}

export function deleteTransaction(state: string): void {
  remove(PREFIX + state);
  writeIndex(readIndex().filter((s) => s !== state));
}

export function pruneExpired(now = Date.now()): void {
  for (const state of readIndex()) {
    const tx = loadTransaction(state);
    if (!tx || now - tx.createdAt > TRANSACTION_TTL_MS * 6) deleteTransaction(state);
  }
}

/**
 * Why a callback could not be matched to a transaction.
 *
 * These are four genuinely different situations that naive implementations
 * collapse into one confusing "state mismatch".
 */
export type CallbackMatch =
  | { kind: 'ok'; transaction: AuthTransaction; expired: boolean }
  | { kind: 'already-consumed'; transaction: AuthTransaction }
  | { kind: 'no-transaction'; knownStates: number }
  | { kind: 'state-mismatch'; knownStates: number };

export function matchCallback(state: string | null): CallbackMatch {
  const index = readIndex();

  if (!state) return { kind: 'state-mismatch', knownStates: index.length };

  const tx = loadTransaction(state);
  if (!tx) return { kind: 'no-transaction', knownStates: index.length };

  // Defensive: the record is keyed by state, so this should be impossible.
  if (tx.state !== state) return { kind: 'state-mismatch', knownStates: index.length };

  if (tx.status === 'consumed' || tx.status === 'exchanging') {
    return { kind: 'already-consumed', transaction: tx };
  }

  return { kind: 'ok', transaction: tx, expired: Date.now() - tx.createdAt > TRANSACTION_TTL_MS };
}

export function getFlowState(): FlowState {
  const raw = read(FLOW_STATE_KEY);
  return raw === 'redirecting' || raw === 'handling-callback' ? raw : 'idle';
}

export function setFlowState(state: FlowState): void {
  if (state === 'idle') remove(FLOW_STATE_KEY);
  else write(FLOW_STATE_KEY, state);
}

/** Clears flow state and every pending transaction. */
export function cancelFlow(): void {
  setFlowState('idle');
  for (const state of readIndex()) deleteTransaction(state);
  writeIndex([]);
}
