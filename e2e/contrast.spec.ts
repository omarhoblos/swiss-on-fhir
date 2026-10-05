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

import type { Page } from '@playwright/test';
import { expect, seedSession, stubDiscovery, test } from './fixtures';

/**
 * WCAG 2.2 AA colour contrast, measured on the rendered page in both themes:
 * 4.5:1 for text (3:1 when large), 3:1 for the edge of an input, dropdown or
 * outlined button, and 4.5:1 for placeholder text.
 *
 * Colours are read back through a canvas, so the oklab and color-mix values
 * Tailwind produces for tints like bg-error/10 are measured as drawn. A
 * background is found by layering every ancestor's fill over the page.
 * Disabled controls, and anything inside one or faded with opacity, are
 * inactive and exempt, as WCAG allows.
 */
async function contrastFailures(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    type RGBA = [number, number, number, number];
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const rgba = (css: string): RGBA => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (top: RGBA, bottom: RGBA): RGBA => {
      const a = top[3];
      return [
        top[0] * a + bottom[0] * (1 - a),
        top[1] * a + bottom[1] * (1 - a),
        top[2] * a + bottom[2] * (1 - a),
        1
      ];
    };
    const luminance = ([r, g, b]: RGBA) => {
      const lin = (c: number) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (a: RGBA, b: RGBA) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };

    const page = rgba(getComputedStyle(document.body).backgroundColor);
    // The fill behind an element, from the page up through its ancestors.
    const backgroundOf = (el: Element | null): RGBA => {
      const fills: RGBA[] = [];
      for (let node = el; node; node = node.parentElement) {
        const fill = rgba(getComputedStyle(node).backgroundColor);
        if (fill[3] > 0) fills.push(fill);
        if (fill[3] === 1) break;
      }
      return fills.reverse().reduce((under, fill) => over(fill, under), page);
    };
    const inactive = (el: Element) =>
      el.closest(':disabled, [aria-disabled="true"]') !== null ||
      (() => {
        for (let node: Element | null = el; node; node = node.parentElement) {
          if (Number(getComputedStyle(node).opacity) < 1) return true;
        }
        return false;
      })();
    const describe = (el: Element, text: string) =>
      `<${el.tagName.toLowerCase()}> "${text.trim().slice(0, 40)}"`;

    const failures: string[] = [];
    const elements = document.body.querySelectorAll('*');
    for (const el of elements) {
      if (!(el instanceof HTMLElement) || !el.checkVisibility()) continue;
      if (inactive(el)) continue;
      const style = getComputedStyle(el);

      const text = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('');
      if (text.trim()) {
        const bg = backgroundOf(el);
        const fg = over(rgba(style.color), bg);
        const size = parseFloat(style.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
        const need = large ? 3 : 4.5;
        const got = ratio(fg, bg);
        if (got < need) failures.push(`${describe(el, text)} text ${got.toFixed(2)}:1`);
      }

      const control = el.matches(
        'input:not([type=checkbox]):not([type=radio]), select, textarea, button, a'
      );
      if (control && parseFloat(style.borderTopWidth) > 0) {
        const outside = backgroundOf(el.parentElement);
        const edge = over(rgba(style.borderTopColor), outside);
        const fill = backgroundOf(el);
        // A filled button is found by its fill; anything else by its edge.
        if (ratio(edge, outside) < 3 && ratio(fill, outside) < 3) {
          failures.push(
            `${describe(el, el.textContent || el.getAttribute('aria-label') || '')} edge ${ratio(edge, outside).toFixed(2)}:1`
          );
        }
      }

      if (
        el.matches('input[placeholder], textarea[placeholder]') &&
        el.matches(':placeholder-shown')
      ) {
        const bg = backgroundOf(el);
        const placeholder = over(rgba(getComputedStyle(el, '::placeholder').color), bg);
        const got = ratio(placeholder, bg);
        if (got < 4.5) {
          failures.push(
            `${describe(el, el.getAttribute('placeholder')!)} placeholder ${got.toFixed(2)}:1`
          );
        }
      }
    }
    return failures;
  });
}

const screens: [string, (page: Page) => Promise<void>][] = [
  [
    'Session',
    async (page) => {
      await page.goto('/');
      for (const summary of await page.locator('details > summary').all()) await summary.click();
    }
  ],
  ['Launch', async (page) => page.goto('/launch').then(() => undefined)],
  [
    'Launch with an error',
    async (page) => {
      await page.goto('/launch?launch=abc');
      await page.getByText('No iss parameter').waitFor();
    }
  ],
  ['FHIR API', async (page) => page.goto('/fhir').then(() => undefined)],
  ['Config', async (page) => page.goto('/config').then(() => undefined)],
  ['Swiss on FHIR Documentation', async (page) => page.goto('/how-it-works').then(() => undefined)],
  [
    'Diagnostics',
    async (page) => {
      await page.goto('/diagnostics');
      await page.getByRole('button', { name: 'Run checks' }).click();
      await page.locator('select').first().waitFor({ timeout: 30_000 });
    }
  ],
  [
    'Glossary',
    async (page) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'Glossary', exact: true }).click();
      await page.locator('#claim-glossary-search').fill('exp');
      await page.getByRole('dialog').locator('li button').first().click();
    }
  ]
];

test.describe('colour contrast (WCAG AA)', () => {
  for (const scheme of ['dark', 'light'] as const) {
    for (const [name, open] of screens) {
      test(`${name}, ${scheme} theme`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await stubDiscovery(page);
        await seedSession(page);
        await open(page);
        const html = expect(page.locator('html'));
        await (scheme === 'light' ? html : html.not).toHaveClass(/light-theme/);
        expect(await contrastFailures(page)).toEqual([]);
      });
    }
  }
});
