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
import type { XmlElement } from './xml';
import { searchXml, xmlNodeText } from './xml-tree';

const el = (
  name: string,
  attributes: [string, string][] = [],
  children: XmlElement['children'] = []
): XmlElement => ({ kind: 'element', name, attributes, children });

// <Bundle><id value="b1"/><entry><resource><Patient><id value="patient-a"/>
//   <name><family value="Wonka"/></name></Patient></resource></entry></Bundle>
const BUNDLE = el(
  'Bundle',
  [['xmlns', 'http://hl7.org/fhir']],
  [
    el('id', [['value', 'b1']]),
    el(
      'entry',
      [],
      [
        el(
          'resource',
          [],
          [
            el(
              'Patient',
              [],
              [
                el('id', [['value', 'patient-a']]),
                el('name', [], [el('family', [['value', 'Wonka']])]),
                { kind: 'text', text: 'Charlie & co' }
              ]
            )
          ]
        )
      ]
    )
  ]
);

describe('searchXml', () => {
  it('finds attribute values and keeps the branch that leads there', () => {
    const { hits, paths } = searchXml(BUNDLE, 'wonka');
    expect([...hits]).toEqual(['$[1][0][0][1][0]']);
    expect([...paths].sort()).toEqual(
      ['$', '$[1]', '$[1][0]', '$[1][0][0]', '$[1][0][0][1]', '$[1][0][0][1][0]'].sort()
    );
  });

  it('finds element names, attribute names and text, ignoring case', () => {
    expect(searchXml(BUNDLE, 'PATIENT').hits.has('$[1][0][0]')).toBe(true);
    expect(searchXml(BUNDLE, 'xmlns').hits.has('$')).toBe(true);
    expect(searchXml(BUNDLE, 'charlie').hits.has('$[1][0][0][2]')).toBe(true);
  });

  it('finds nothing for an empty query or a miss', () => {
    expect(searchXml(BUNDLE, '  ').paths.size).toBe(0);
    expect(searchXml(BUNDLE, 'absent').paths.size).toBe(0);
  });
});

describe('xmlNodeText', () => {
  it('writes a subtree as indented XML, escaping what needs it', () => {
    const patient = (BUNDLE.children[1] as XmlElement).children[0] as XmlElement;
    expect(xmlNodeText(patient.children[0]!)).toBe(
      [
        '<Patient>',
        '  <id value="patient-a"/>',
        '  <name>',
        '    <family value="Wonka"/>',
        '  </name>',
        '  Charlie &amp; co',
        '</Patient>'
      ].join('\n')
    );
    expect(xmlNodeText(el('x', [['a', 'say "hi" & <go>']]))).toBe(
      '<x a="say &quot;hi&quot; &amp; &lt;go&gt;"/>'
    );
  });
});
