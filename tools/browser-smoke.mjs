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
  await page.getByRole('heading', { name: 'Sites and traffic', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'How requests move', exact: true }).waitFor();
  await page.getByText('This Injector VM', { exact: true }).waitFor();
  await page.getByRole('heading', { name: /fake-app\.test/ }).waitFor();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('heading', { name: 'Account and access settings', exact: true }).waitFor();
  await page.getByText(/two-factor authentication disabled/).waitFor();
  await page.getByRole('button', { name: 'Sites', exact: true }).click();

  page.once('dialog', async (dialog) => dialog.accept('clone-browser.test'));
  await page.getByRole('button', { name: 'Clone', exact: true }).first().click();
  const cloneArticle = page.locator('#route-list').getByRole('article').filter({ hasText: 'clone-browser.test' });
  await cloneArticle.getByRole('heading', { name: /clone-browser\.test/ }).waitFor();
  page.once('dialog', async (dialog) => dialog.accept());
  await cloneArticle.getByRole('button', { name: 'Delete', exact: true }).click();
  await cloneArticle.waitFor({ state: 'detached' });

  await page.getByRole('button', { name: 'Injections', exact: true }).click();
  const umamiProfileName = 'Umami browser import';
  const umamiWebsiteId = '63202f5f-067c-44e3-9e41-c60ea2654350';
  await page.locator('#umami-name').fill(umamiProfileName);
  await page.locator('#umami-snippet').fill(`<script defer src="https://analytics.example/script.js" data-website-id="${umamiWebsiteId}"></script>\n<script defer src="https://analytics.example/recorder.js" data-website-id="${umamiWebsiteId}"></script>`);
  await page.getByRole('button', { name: 'Extract settings', exact: true }).click();
  await page.getByText(`Extracted analytics and recorder for website ${umamiWebsiteId}.`, { exact: true }).waitFor();
  if (await page.locator('#umami-website-id').inputValue() !== umamiWebsiteId) throw new Error('Umami website ID was not extracted');
  if (!await page.locator('#umami-recorder').isChecked()) throw new Error('Umami recorder was not extracted');
  await page.getByRole('button', { name: 'Save Umami injection', exact: true }).click();
  const umamiArticle = page.getByRole('article').filter({ hasText: umamiProfileName });
  await umamiArticle.getByRole('heading', { name: umamiProfileName, exact: true }).waitFor();
  await umamiArticle.getByRole('button', { name: 'Use on new site', exact: true }).click();
  await page.getByRole('heading', { name: 'New site', exact: true }).waitFor();
  const selectedProfile = page.locator('.profile-option').filter({ hasText: umamiProfileName }).locator('input');
  if (!await selectedProfile.isChecked()) throw new Error('Umami profile was not selected on the guided site editor');
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'Edit this path', exact: true }).click();
  const tlsSkipPanel = page.locator('#tls-skip-panel');
  if (!await tlsSkipPanel.isHidden()) throw new Error('TLS bypass was shown for an HTTP destination');
  await page.locator('#upstream-protocol').selectOption('https');
  await tlsSkipPanel.waitFor({ state: 'visible' });
  const tlsSkipSwitch = page.getByRole('switch', { name: /Skip TLS verification/i });
  await tlsSkipSwitch.check();
  await page.getByText(/Certificate identity will not be verified/).waitFor();
  await page.locator('#upstream-protocol').selectOption('http');
  await tlsSkipPanel.waitFor({ state: 'hidden' });
  if (await page.locator('#skip-tls-verify').isChecked()) throw new Error('HTTP destination retained the TLS bypass state');
  await page.getByText('Optional settings', { exact: true }).waitFor();
  await page.locator('#simple-injection-type').selectOption('html');
  await page.locator('#simple-injection-name').fill('Support card');
  await page.locator('#simple-injection-location').selectOption('body-end');
  await page.locator('#simple-injection-content').fill('<aside class="support-card"><strong>Need help?</strong><a href="/support">Open support</a></aside>');
  await page.getByRole('button', { name: 'Add to site', exact: true }).click();
  await page.locator('#simple-injection-list').getByText('Support card', { exact: true }).waitFor();
  await page.locator('#simple-injection-type').selectOption('inline-script');
  await page.locator('#simple-injection-name').fill('Card behavior');
  await page.locator('#simple-injection-content').fill('window.__supportCardReady = true;');
  await page.getByRole('button', { name: 'Add to site', exact: true }).click();
  await page.locator('#simple-injection-list').getByText('Card behavior', { exact: true }).waitFor();
  await page.getByRole('button', { name: '1. Save safe draft', exact: true }).click();
  await page.getByText('Draft saved safely. Live traffic has not changed. Next, test the destination.', { exact: true }).waitFor();
  await page.getByRole('button', { name: '2. Test destination', exact: true }).click();
  await page.getByText(/Destination test passed/).waitFor();

  await page.getByLabel('Advanced mode', { exact: true }).check();
  await page.getByText('Optional settings', { exact: true }).click();
  const directItems = JSON.parse(await page.locator('#injections').inputValue());
  const supportItem = directItems.find((item) => item.name === 'Support card');
  if (!supportItem) throw new Error('support card was not present in the direct injection JSON');
  supportItem.includePaths = ['/support/*'];
  await page.locator('#injections').fill(JSON.stringify(directItems, null, 2));
  await page.locator('#injections').press('Tab');
  const advancedSupportCard = page.locator('#simple-injection-list .injection-entry').filter({ hasText: 'Support card' });
  await advancedSupportCard.getByText(/Advanced controls are preserved/).waitFor();
  if (await advancedSupportCard.getByRole('button', { name: 'Edit', exact: true }).count()) throw new Error('simple editor could discard advanced injection controls');
  await page.getByRole('button', { name: 'Injections', exact: true }).click();
  const storedXssName = '<img src=x onerror="window.__nimXss=1">';
  await page.locator('#profile-name').fill(storedXssName);
  await page.locator('#profile-items').fill('[]');
  await page.getByRole('button', { name: 'Create profile', exact: true }).click();
  const xssProfile = page.getByRole('article').filter({ hasText: storedXssName });
  await xssProfile.getByRole('heading', { name: storedXssName, exact: true }).waitFor();
  if (await page.evaluate(() => window.__nimXss === 1)) throw new Error('stored profile text executed as script');
  page.once('dialog', async (dialog) => dialog.accept());
  await xssProfile.getByRole('button', { name: 'Delete', exact: true }).click();
  await xssProfile.waitFor({ state: 'detached' });
  page.once('dialog', async (dialog) => dialog.accept());
  await umamiArticle.getByRole('button', { name: 'Delete', exact: true }).click();
  await umamiArticle.waitFor({ state: 'detached' });

  await page.getByRole('button', { name: 'Peers', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('heading', { name: /fake-app-peer/ }).waitFor();
  await page.setViewportSize({ width: 375, height: 812 });
  if (!await page.getByRole('heading', { name: 'Sites and traffic', exact: true }).isVisible()) throw new Error('mobile dashboard heading is not visible');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.tagName ?? '');
  if (!['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(focused)) throw new Error(`keyboard navigation did not reach an interactive control: ${focused}`);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Administrator password').waitFor();
  process.stdout.write('browser smoke passed: login, traffic map, compact endpoint, per-route TLS switch, optional settings, account, clone/delete, Umami, HTML/script builder, draft/test, advanced mode, XSS escaping, peers, mobile, keyboard, logout\n');
} finally {
  await browser?.close();
  if (environment.exitCode === null) environment.kill('SIGTERM');
  if (environment.exitCode === null) await Promise.race([once(environment, 'exit'), new Promise((resolve) => setTimeout(resolve, 5000))]);
}
