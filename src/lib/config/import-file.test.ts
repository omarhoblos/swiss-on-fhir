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

import { describe, expect, it } from 'vitest';
import { importFileKind, MAX_IMPORT_BYTES, readImportFile } from './import-file';

const file = (name: string, text: string) => new File([text], name);

describe('importFileKind', () => {
  it('accepts .json and .env, in any case', () => {
    expect(importFileKind('swiss-config.json')).toBe('json');
    expect(importFileKind('EXPORT.JSON')).toBe('json');
    expect(importFileKind('.env')).toBe('env');
    expect(importFileKind('prod.env')).toBe('env');
  });

  it('refuses everything else', () => {
    for (const name of ['config.txt', '.env.local', 'env', 'config.json.exe', 'notes.md', '']) {
      expect(importFileKind(name), name).toBeNull();
    }
  });
});

describe('readImportFile', () => {
  it('reads a .json or .env file', async () => {
    expect(await readImportFile([file('a.json', '{"clientId":"x"}')])).toEqual({
      ok: true,
      name: 'a.json',
      kind: 'json',
      text: '{"clientId":"x"}'
    });
    expect(await readImportFile([file('.env', 'CLIENT_ID=x\n')])).toMatchObject({
      ok: true,
      kind: 'env',
      text: 'CLIENT_ID=x\n'
    });
  });

  it('refuses a file of another type, naming it', async () => {
    expect(await readImportFile([file('settings.yaml', 'clientId: x')])).toEqual({
      ok: false,
      error: 'settings.yaml is not a .json or .env file, so it was not read.'
    });
  });

  it('refuses none or several files at once', async () => {
    expect(await readImportFile([])).toMatchObject({ ok: false });
    expect(await readImportFile([file('a.json', '{}'), file('b.env', '')])).toEqual({
      ok: false,
      error: 'Drop one file at a time.'
    });
  });

  it('refuses a .json file that is not JSON, a binary, or an oversized file', async () => {
    expect(await readImportFile([file('a.json', '{nope')])).toMatchObject({ ok: false });
    expect(await readImportFile([file('a.env', 'A=1\u0000\u0001')])).toMatchObject({
      ok: false
    });
    const big = file('big.env', 'A='.padEnd(MAX_IMPORT_BYTES + 1, 'x'));
    expect(await readImportFile([big])).toMatchObject({ ok: false });
  });
});
