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

test.describe('Swiss on FHIR Documentation', () => {
  test('explains each mechanism with a labelled diagram', async ({ page }) => {
    await page.goto('/how-it-works');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Swiss on FHIR Documentation' })
    ).toBeVisible();

    // Every diagram states its claim for readers who cannot see it.
    const diagrams = page.locator('figure svg[role="img"]');
    await expect(diagrams).toHaveCount(10);
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

  test('searches the page from the contents', async ({ page }) => {
    await page.goto('/how-it-works');
    const contents = page.getByRole('navigation', { name: 'On this page' });
    const search = contents.getByRole('searchbox', { name: 'Search the documentation' });
    const links = contents.getByRole('link');
    const all = await links.count();

    // A word in a section's text, not its title, finds that section.
    await search.fill('jose');
    await expect(contents.getByRole('link', { name: 'The Swiss layout' })).toBeVisible();
    await expect(contents.getByRole('link', { name: 'Discovery' })).toHaveCount(0);
    expect(await links.count()).toBeLessThan(all);
    await expect(contents.getByText(/of \d+ sections/)).toBeVisible();

    // Every word must appear; Enter jumps to the first match.
    await search.fill('nginx entrypoint');
    await search.press('Enter');
    const first = await links.first().getAttribute('href');
    await expect(page).toHaveURL(new RegExp(`${first}$`));

    await search.fill('zzqx');
    await expect(contents.getByText('No section mentions “zzqx”.')).toBeVisible();
    await expect(links).toHaveCount(0);

    // Escape clears the search and brings every section back.
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(links).toHaveCount(all);

    // So does the clear button, which leaves focus in the box.
    const clear = contents.getByRole('button', { name: 'Clear search' });
    await expect(clear).toHaveCount(0);
    await search.fill('jose');
    await expect(links).not.toHaveCount(all);
    await clear.click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(links).toHaveCount(all);
    await expect(clear).toHaveCount(0);
  });

  test('floats a button that goes back to the top', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/how-it-works');
    const button = page.getByRole('button', { name: 'Back to top' });
    // Not needed at the top of the page.
    await expect(button).toHaveCount(0);

    await page.goto('/how-it-works#shipping');
    await expect(button).toBeVisible();
    // It sits clear of the exchange log bar along the bottom.
    const bar = await page.getByRole('complementary', { name: 'Exchange log' }).boundingBox();
    const box = await button.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y);

    await button.click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Swiss on FHIR Documentation' })
    ).toBeFocused();
    await expect(button).toHaveCount(0);
  });

  test('keys the diagrams in a legend card', async ({ page }) => {
    await page.goto('/how-it-works');
    const legend = page.getByRole('list', { name: 'Legend' });
    await expect(page.getByTestId('legend').getByRole('heading')).toHaveText('Legend');
    await expect(legend.getByRole('listitem')).toHaveText([
      "Swiss's own code and requests",
      'Data kept in the browser',
      'Your servers',
      'A browser navigation, not a request Swiss reads'
    ]);
  });

  test('highlights the section being read as you scroll', async ({ page }) => {
    await page.goto('/how-it-works');
    const contents = page.getByRole('navigation', { name: 'On this page' });
    for (const [id, title] of [
      ['config', 'Configuration'],
      ['diagnostics', 'Diagnostics'],
      ['shape', 'The Swiss layout']
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

  for (const [section, testId] of [
    ['Diagnostics', 'check-inventory'],
    ['Swiss on FHIR Documentation', 'principles'],
    ['Making changes', 'recipes']
  ]) {
    test(`highlights the ${section} card under the cursor`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/how-it-works');
      const cards = page.getByTestId(testId).locator(':scope > div');
      const first = cards.nth(0);
      const second = cards.nth(1);
      const border = (card: typeof first) =>
        card.evaluate((el) => getComputedStyle(el).borderColor);
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
  }

  test('stays server-agnostic and names no private infrastructure', async ({ page }) => {
    await page.goto('/how-it-works');
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/smile\s*cdr|keycloak|keycloak-docker/i);
    // Both parts are present: how it works, then how to work on it.
    for (const heading of [
      'The component structure',
      'After sign-in: the session',
      'Set up',
      'Testing',
      'Releasing'
    ]) {
      await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
    }
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
