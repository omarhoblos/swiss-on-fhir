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
import { parseBlocks, parseInline } from './markdown';

describe('parseInline', () => {
  it('reads the endpoint agreement line', () => {
    expect(
      parseInline('`jwks_uri`: http://localhost:9200/.well-known/jwks.json _(smart-configuration)_')
    ).toEqual([
      { kind: 'code', value: 'jwks_uri' },
      { kind: 'text', value: ': http://localhost:9200/.well-known/jwks.json ' },
      { kind: 'em', value: '(smart-configuration)' }
    ]);
  });

  it('reads bold', () => {
    expect(parseInline('must **not** redirect')).toEqual([
      { kind: 'text', value: 'must ' },
      { kind: 'strong', value: 'not' },
      { kind: 'text', value: ' redirect' }
    ]);
  });

  it('leaves underscores inside words and code spans alone', () => {
    expect(parseInline('grant_types_supported and `a_b_`')).toEqual([
      { kind: 'text', value: 'grant_types_supported and ' },
      { kind: 'code', value: 'a_b_' }
    ]);
  });

  it('leaves an unclosed backtick as text', () => {
    expect(parseInline('a ` b')).toEqual([{ kind: 'text', value: 'a ` b' }]);
  });

  it('never produces markup from its input', () => {
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([
      { kind: 'text', value: '<img src=x onerror=alert(1)>' }
    ]);
  });
});

describe('parseBlocks', () => {
  it('groups consecutive list items and splits paragraphs on blank lines', () => {
    const blocks = parseBlocks('Intro:\n\n- one\n- two\n\nAfter.');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'list', 'paragraph']);
    expect(blocks[1]).toEqual({
      kind: 'list',
      items: [[{ kind: 'text', value: 'one' }], [{ kind: 'text', value: 'two' }]]
    });
  });

  it('keeps single line breaks inside a paragraph', () => {
    expect(parseBlocks('a\nb')).toEqual([
      {
        kind: 'paragraph',
        lines: [[{ kind: 'text', value: 'a' }], [{ kind: 'text', value: 'b' }]]
      }
    ]);
  });
});
