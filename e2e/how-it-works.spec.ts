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

import { expect, test } from './fixtures';

test.describe('How Swiss works', () => {
  test('explains each mechanism with a labelled diagram', async ({ page }) => {
    await page.goto('/how-it-works');
    await expect(page.getByRole('heading', { level: 1, name: 'How Swiss works' })).toBeVisible();

    // Every diagram states its claim for readers who cannot see it.
    const diagrams = page.locator('figure svg[role="img"]');
    await expect(diagrams).toHaveCount(8);
    for (const label of await diagrams.evaluateAll((svgs) =>
      svgs.map((svg) => svg.getAttribute('aria-label') ?? '')
    )) {
      expect(label.length).toBeGreaterThan(40);
    }

    // The contents jump to each section on the page.
    const contents = page.getByRole('navigation', { name: 'On this page' });
    await contents.getByRole('link', { name: 'Where the token goes' }).click();
    await expect(page).toHaveURL(/#token$/);
    await expect(page.getByRole('heading', { name: 'Where the token goes' })).toBeInViewport();
    // The section being read is marked in the contents.
    await expect(contents.getByRole('link', { name: 'Where the token goes' })).toHaveAttribute(
      'aria-current',
      'location'
    );
    await expect(contents.locator('[aria-current]')).toHaveCount(1);
  });

  test('highlights the section being read as you scroll', async ({ page }) => {
    await page.goto('/how-it-works');
    const contents = page.getByRole('navigation', { name: 'On this page' });
    for (const [id, title] of [
      ['config', 'Configuration'],
      ['diagnostics', 'Diagnostics'],
      ['shape', 'The shape of the app']
    ]) {
      await page.locator(`section#${id}`).evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await expect(contents.getByRole('link', { name: title, exact: true })).toHaveAttribute(
        'aria-current',
        'location'
      );
    }
  });

  test('lists the Diagnostics checks from the code, with their dependencies', async ({ page }) => {
    await page.goto('/how-it-works');
    const section = page.locator('section#diagnostics');
    // Read from ALL_CHECKS, so a new check appears here without editing the page.
    await expect(section.getByText('disc.iss-parameter', { exact: false })).toBeVisible();
    await expect(
      section.getByText(/disc\.iss-parameter.*needs disc\.openid-configuration/)
    ).toBeVisible();
    const count = Number(
      (await section.locator('p').first().innerText()).match(/runs (\d+) checks/)?.[1]
    );
    expect(count).toBeGreaterThan(20);
    await expect(section.getByTestId('check-inventory').locator('li')).toHaveCount(count);
  });

  test('highlights the check group under the cursor', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/how-it-works');
    const cards = page.getByTestId('check-inventory').locator(':scope > div');
    const first = cards.nth(0);
    const second = cards.nth(1);
    const border = (card: typeof first) => card.evaluate((el) => getComputedStyle(el).borderColor);
    const primary = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--color-primary)';
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    });

    const resting = await border(first);
    expect(resting).not.toBe(primary);

    await first.hover();
    await expect.poll(() => border(first)).toBe(primary);
    expect(await border(second)).toBe(resting);

    // Moving to another card moves the highlight with it.
    await second.hover();
    await expect.poll(() => border(second)).toBe(primary);
    await expect.poll(() => border(first)).toBe(resting);
  });

  test('links nowhere outside the app', async ({ page }) => {
    await page.goto('/how-it-works');
    const hrefs = await page
      .locator('main a[href]')
      .evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href));
    expect(hrefs.length).toBeGreaterThan(0);
    const origin = new URL(page.url()).origin;
    for (const href of hrefs) expect(new URL(href).origin, href).toBe(origin);
  });
});
