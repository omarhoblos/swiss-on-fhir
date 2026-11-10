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

import { isEnvironmentId, sanitizeName } from '#lib/environments/types.ts';
import type { FhirMethod } from './client';
import type { BodyFormat } from './xml';

/**
 * The FHIR console's request tabs, as data: what one tab keeps, how a stored
 * set is read back, and which tab to show when the environment changes.
 *
 * Each tab works in one environment. The selected tab is always on the
 * environment the app is on, so choosing a tab switches the app, and
 * switching the app from the nav picker brings up a tab for it.
 */

export const METHODS: readonly FhirMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
export const MAX_REQUEST_TABS = 20;
export const MAX_TAB_NAME_LENGTH = 64;
/** A query longer than this is not a draft worth keeping; it is dropped on read. */
export const MAX_DRAFT_QUERY_LENGTH = 8_192;
/** Bodies can be whole Bundles, but storage is shared with the rest of Swiss. */
export const MAX_DRAFT_BODY_LENGTH = 1_000_000;

/** What a tab keeps across a reload. Responses, tokens and headers are not part of it. */
export interface RequestDraft {
  id: string;
  environmentId: string;
  /** The name the user gave the tab, or ''. */
  name: string;
  method: FhirMethod;
  query: string;
  body: string;
  bodyFormat: BodyFormat;
  responseFormat: BodyFormat;
}

export interface StoredRequestTabs {
  selectedId: string;
  tabs: RequestDraft[];
}

const TAB_ID = /^[a-z0-9]{8}$/;

export function newTabId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  while (id.length < 8) {
    for (const byte of crypto.getRandomValues(new Uint8Array(12))) {
      if (byte < 252 && id.length < 8) id += alphabet[byte % alphabet.length];
    }
  }
  return id;
}

/** A tab name: control characters out, whitespace collapsed, at most 64 characters. */
export function cleanTabName(raw: unknown): string {
  return sanitizeName(raw, MAX_TAB_NAME_LENGTH) ?? '';
}

export function blankDraft(environmentId: string): RequestDraft {
  return {
    id: newTabId(),
    environmentId,
    name: '',
    method: 'GET',
    query: '',
    body: '',
    bodyFormat: 'json',
    responseFormat: 'json'
  };
}

const isFormat = (value: unknown): value is BodyFormat => value === 'json' || value === 'xml';

/** One stored tab, checked like any other input; null when it cannot be used. */
function readDraft(raw: unknown): RequestDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.id !== 'string' || !TAB_ID.test(d.id)) return null;
  if (!isEnvironmentId(d.environmentId)) return null;
  if (!METHODS.includes(d.method as FhirMethod)) return null;
  if (typeof d.query !== 'string' || d.query.length > MAX_DRAFT_QUERY_LENGTH) return null;
  if (typeof d.body !== 'string' || d.body.length > MAX_DRAFT_BODY_LENGTH) return null;
  return {
    id: d.id,
    environmentId: d.environmentId,
    name: cleanTabName(d.name),
    method: d.method as FhirMethod,
    query: d.query,
    body: d.body,
    bodyFormat: isFormat(d.bodyFormat) ? d.bodyFormat : 'json',
    responseFormat: isFormat(d.responseFormat) ? d.responseFormat : 'json'
  };
}

/**
 * Reads a stored set of tabs. Unusable entries and repeated ids are dropped,
 * at most MAX_REQUEST_TABS are kept, and a selection that names no kept tab
 * falls back to the first. Null when nothing usable is there.
 */
export function parseRequestTabs(raw: string | null): StoredRequestTabs | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const { swissRequestTabsVersion, selectedId, tabs } = parsed as Record<string, unknown>;
  if (swissRequestTabsVersion !== 1 || !Array.isArray(tabs)) return null;
  const seen = new Set<string>();
  const kept: RequestDraft[] = [];
  for (const entry of tabs) {
    const draft = readDraft(entry);
    if (!draft || seen.has(draft.id)) continue;
    seen.add(draft.id);
    kept.push(draft);
    if (kept.length === MAX_REQUEST_TABS) break;
  }
  if (kept.length === 0) return null;
  const selected = kept.find((d) => d.id === selectedId) ?? kept[0]!;
  return { selectedId: selected.id, tabs: kept };
}

export function serializeRequestTabs(selectedId: string, tabs: readonly RequestDraft[]): string {
  return JSON.stringify({ swissRequestTabsVersion: 1, selectedId, tabs });
}

/** What a tab is called in the strip: its name, else its request. */
export function draftTitle(
  draft: Pick<RequestDraft, 'name' | 'method' | 'query' | 'body'>
): string {
  if (draft.name) return draft.name;
  const query = draft.query.trim();
  if (query) return `${draft.method} ${query}`;
  // A write with a body and no path goes to the FHIR base itself.
  if (draft.method !== 'GET' && draft.body.trim()) return `${draft.method} (FHIR base)`;
  return 'New request';
}

export type FollowAction =
  { kind: 'stay' } | { kind: 'select'; id: string } | { kind: 'retarget' } | { kind: 'open' };

/**
 * What to show when the app is now on `environmentId`. The selected tab
 * already on it stays. Otherwise a tab already on that environment is
 * brought up, so switching back and forth in the nav returns to each
 * environment's tab. With none, an untouched selected tab simply moves to
 * the new environment, and one with a request in it is kept and a new tab
 * opened beside it. At the tab limit the selected tab moves instead.
 */
export function followEnvironment(
  tabs: readonly Pick<RequestDraft, 'id' | 'environmentId'>[],
  selectedId: string,
  environmentId: string,
  selectedIsUntouched: boolean
): FollowAction {
  const selected = tabs.find((t) => t.id === selectedId);
  if (selected?.environmentId === environmentId) return { kind: 'stay' };
  const existing = tabs.find((t) => t.environmentId === environmentId);
  if (existing) return { kind: 'select', id: existing.id };
  if (!selected || selectedIsUntouched || tabs.length >= MAX_REQUEST_TABS) {
    return { kind: 'retarget' };
  }
  return { kind: 'open' };
}

/**
 * The tabs with `id` moved next to `targetId`: after it when `after`, else
 * before it. Unchanged when either is missing or they are the same tab.
 */
export function moveTab<T extends Pick<RequestDraft, 'id'>>(
  tabs: readonly T[],
  id: string,
  targetId: string,
  after: boolean
): T[] {
  const moving = tabs.find((t) => t.id === id);
  if (!moving || id === targetId || !tabs.some((t) => t.id === targetId)) return [...tabs];
  const rest = tabs.filter((t) => t.id !== id);
  const at = rest.findIndex((t) => t.id === targetId) + (after ? 1 : 0);
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

/** The tab to show after `closedId` closes: the one that took its place, else the one before. */
export function tabAfterClose(
  tabs: readonly Pick<RequestDraft, 'id'>[],
  closedId: string,
  selectedId: string
): string | null {
  const remaining = tabs.filter((t) => t.id !== closedId);
  if (remaining.length === 0) return null;
  if (closedId !== selectedId) return selectedId;
  const at = tabs.findIndex((t) => t.id === closedId);
  return (remaining[at] ?? remaining[at - 1] ?? remaining[0]!).id;
}
