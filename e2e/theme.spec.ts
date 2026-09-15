import { expect, test } from './fixtures';

test.describe('theme', () => {
  test('toggles and persists without a flash', async ({ page }) => {
    // With no stored preference the initial theme follows the OS, as the
    // Angular app did; emulate dark so the starting point is deterministic.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');

    await expect(page.locator('html')).not.toHaveClass(/light-theme/);

    await page.getByRole('button', { name: /Switch to light theme/ }).click();
    await expect(page.locator('html')).toHaveClass(/light-theme/);

    // Applied before first paint on reload, by the inline script in app.html
    // rather than after hydration -- so there is no light-to-dark flash.
    await page.reload({ waitUntil: 'commit' });
    await expect(page.locator('html')).toHaveClass(/light-theme/);

    // Same storage key and values as the Angular app, so an existing
    // preference carries over.
    expect(await page.evaluate(() => localStorage.getItem('themeSelected'))).toBe('light');
  });

  test('follows the OS preference when nothing is stored', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/light-theme/);

    // An explicit choice then wins over the OS preference.
    await page.getByRole('button', { name: /Switch to dark theme/ }).click();
    await page.reload({ waitUntil: 'commit' });
    await expect(page.locator('html')).not.toHaveClass(/light-theme/);
  });
});
