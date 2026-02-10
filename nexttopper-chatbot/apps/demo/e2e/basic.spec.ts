import { expect, test } from '@playwright/test';

test('guest can start sales flow and submit phone for counselor callback', async ({
  page,
}) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Set Guest' }).click();

  // Open widget
  await page.locator('#nt-counselor-widget-root .ntw-fab').click();

  // L1 menu
  await page
    .locator('#nt-counselor-widget-root .ntw-quick-btn')
    .filter({ hasText: 'New Batches (2026-27)' })
    .click();

  // Pick class 10
  await page
    .locator('#nt-counselor-widget-root .ntw-quick-btn')
    .filter({ hasText: 'Class 10' })
    .click();

  // Talk to counselor
  await page
    .locator('#nt-counselor-widget-root .ntw-quick-btn')
    .filter({ hasText: 'Talk to Counselor' })
    .click();

  // Provide phone
  const input = page.locator('#nt-counselor-widget-root .ntw-input input');
  await input.fill('9999999999');
  await page.locator('#nt-counselor-widget-root .ntw-input button').click();

  await expect(
    page.locator('#nt-counselor-widget-root .ntw-messages')
  ).toContainText('call');
});

