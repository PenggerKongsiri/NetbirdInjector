import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';

const environment = spawn(process.execPath, ['tools/fake-environment.mjs'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let output = '';
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('fake browser environment did not start')), 15_000);
  environment.stdout.on('data', (chunk) => {
    output += chunk;
    const match = output.match(/Admin UI: (http:\/\/127\.0\.0\.1:\d+)/);
    if (match) { clearTimeout(timeout); resolve(match[1]); }
  });
  environment.once('exit', (code) => reject(new Error(`fake browser environment exited early with status ${code}`)));
});
environment.stderr.on('data', (chunk) => { output += chunk; });

let browser;
try {
  const adminUrl = await ready;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(adminUrl);
  await page.getByLabel('Administrator username', { exact: true }).fill('admin');
  await page.getByLabel('Administrator password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'invalid credentials' }).waitFor();
  await page.getByLabel('Administrator password').fill('fake-admin-password-only');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Route control', exact: true }).waitFor();
  await page.getByRole('heading', { name: /fake-app\.test/ }).waitFor();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('heading', { name: 'Account and access settings', exact: true }).waitFor();
  await page.getByText(/two-factor authentication disabled/).waitFor();
  await page.getByRole('button', { name: 'Routes', exact: true }).click();

  page.once('dialog', async (dialog) => dialog.accept('clone-browser.test'));
  await page.getByRole('button', { name: 'Clone', exact: true }).first().click();
  const cloneArticle = page.getByRole('article').filter({ hasText: 'clone-browser.test' });
  await cloneArticle.getByRole('heading', { name: /clone-browser\.test/ }).waitFor();
  page.once('dialog', async (dialog) => dialog.accept());
  await cloneArticle.getByRole('button', { name: 'Delete', exact: true }).click();
  await cloneArticle.waitFor({ state: 'detached' });

  await page.getByRole('button', { name: 'Profiles', exact: true }).click();
  const storedXssName = '<img src=x onerror="window.__nimXss=1">';
  await page.getByLabel('Name', { exact: true }).fill(storedXssName);
  await page.locator('#profile-items').fill('[]');
  const createProfileButtons = page.getByRole('button', { name: 'Create profile', exact: true });
  if (await createProfileButtons.count() !== 2) throw new Error('unexpected profile create button count');
  await createProfileButtons.nth(1).click();
  const xssProfile = page.getByRole('article').filter({ hasText: storedXssName });
  await xssProfile.getByRole('heading', { name: storedXssName, exact: true }).waitFor();
  if (await page.evaluate(() => window.__nimXss === 1)) throw new Error('stored profile text executed as script');
  page.once('dialog', async (dialog) => dialog.accept());
  await xssProfile.getByRole('button', { name: 'Delete', exact: true }).click();
  await xssProfile.waitFor({ state: 'detached' });

  await page.getByRole('button', { name: 'Peers', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('heading', { name: /fake-app-peer/ }).waitFor();
  await page.setViewportSize({ width: 375, height: 812 });
  if (!await page.getByRole('heading', { name: 'Route control', exact: true }).isVisible()) throw new Error('mobile dashboard heading is not visible');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.tagName ?? '');
  if (!['BUTTON', 'A', 'INPUT'].includes(focused)) throw new Error(`keyboard navigation did not reach an interactive control: ${focused}`);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Administrator password').waitFor();
  process.stdout.write('browser smoke passed: login failure/success, dashboard, account settings, clone/delete confirmation, stored-XSS escaping, peers, mobile viewport, keyboard focus, logout\n');
} finally {
  await browser?.close();
  if (environment.exitCode === null) environment.kill('SIGTERM');
  if (environment.exitCode === null) await Promise.race([once(environment, 'exit'), new Promise((resolve) => setTimeout(resolve, 5000))]);
}
