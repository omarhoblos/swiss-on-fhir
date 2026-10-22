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

/**
 * Checks a file dropped onto the Config screen's import box before its text
 * goes in the box. Only a `.json` or `.env` file is read; anything else is
 * refused with a reason, and nothing is applied until the user presses Import.
 */

/** The same cap the container puts on the rendered swiss-env.json. */
export const MAX_IMPORT_BYTES = 64 * 1024;

export type ImportFileKind = 'json' | 'env';

/** `.json`, or `.env` alone or as an extension (`prod.env`); null for anything else. */
export function importFileKind(name: string): ImportFileKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.env')) return 'env';
  return null;
}

export type ImportFileResult =
  { ok: true; name: string; kind: ImportFileKind; text: string } | { ok: false; error: string };

export async function readImportFile(files: readonly File[]): Promise<ImportFileResult> {
  if (files.length !== 1) {
    return { ok: false, error: 'Drop one file at a time.' };
  }
  const file = files[0]!;
  const kind = importFileKind(file.name);
  if (!kind) {
    return { ok: false, error: `${file.name} is not a .json or .env file, so it was not read.` };
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return {
      ok: false,
      error: `${file.name} is ${file.size} bytes; the limit is ${MAX_IMPORT_BYTES}. A configuration file is far smaller.`
    };
  }
  const text = await file.text();
  // A text file has no NUL bytes; a renamed binary almost always does.
  if (text.includes('\u0000')) {
    return { ok: false, error: `${file.name} is not a text file, so it was not read.` };
  }
  if (kind === 'json') {
    try {
      JSON.parse(text);
    } catch {
      return { ok: false, error: `${file.name} is not valid JSON, so it was not read.` };
    }
  }
  return { ok: true, name: file.name, kind, text };
}
