'use strict';
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { ServerManager } = require('../src/core');

// Capture the real application with isolated example profiles. No real players,
// API keys, private logs, or installed runtime profiles are used in the gallery.
(async () => {
  const root = path.resolve(__dirname, '..');
  const fixture = path.join(root, 'output', 'readme-gallery-' + Date.now());
  const images = path.join(root, 'docs', 'screenshots');
  fs.mkdirSync(images, { recursive: true });
  const manager = await new ServerManager(path.join(fixture, 'state'), path.join(fixture, 'library')).init();
  const first = await manager.create({ name: 'Chispi Community', port: 27777, eula: false });
  const second = await manager.create({ name: 'Friends Only', port: 27778, eula: false });
  await manager.setPreferences({ language: 'en' });
  // Optional templates come from an existing local game installation, never from
  // private server configuration, and are not redistributed with the screenshots.
  const runtime = path.join(root, 'runtime', 'library', 'servers');
  let templates;
  if (fs.existsSync(runtime)) for (const item of fs.readdirSync(runtime)) {
    const candidate = path.join(runtime, item, 'game', 'ConfigTemplates');
    if (fs.existsSync(candidate)) { templates = candidate; break; }
  }
  if (templates) {
    fs.cpSync(templates, path.join(manager.game(first), 'ConfigTemplates'), { recursive: true });
    await manager.seedConfigs(first);
  }
  const loopback = manager.snapshot().adapters.find(adapter => adapter.address === '127.0.0.1');
  assert.ok(loopback, 'A loopback adapter is required for privacy-safe captures');
  for (const server of [first, second]) await manager.setNetwork(server.id, loopback.address, loopback.name);
  await manager.backup(first.id);
  const packaged = process.argv.includes('--packaged');
  const application = await electron.launch(packaged ? {
    executablePath: path.join(root, 'release', 'win-unpacked', 'SCP Chispi Manager.exe'), args: ['--data-dir=' + manager.dataDir]
  } : { args: [root, '--data-dir=' + manager.dataDir] });
  try {
    const page = await application.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1920, 1080));
    await page.waitForSelector('#splash', { state: 'detached' });
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal((await page.evaluate(() => window.chispi.call('state'))).value.hasSteamKey, false);
    const capture = async name => {
      // Public captures must contain no private address or Windows profile path.
      const visible = await page.locator('body').innerText();
      assert.ok(!/C:\\Users\\|192\.168\.\d|10\.\d+\.\d+\.\d+/.test(visible), 'Private data found in capture');
      await page.screenshot({ path: path.join(images, name), animations: 'disabled' });
    };
    await capture('dashboard.png');
    await page.locator('[data-server="' + first.id + '"]').first().click();
    await page.locator('[data-tab="settings"]').click();
    await page.waitForSelector('[data-config-key="max_players"]');
    await capture('configuration.png');
    await page.locator('[data-tab="admin"]').click();
    await page.waitForSelector('#admin-role');
    await capture('administration.png');
    await page.locator('[data-tab="backups"]').click();
    await page.waitForSelector('.backup-entry');
    await capture('backups.png');
    await page.locator('[data-nav="overview"]').click();
    await page.locator('[data-action="new"]').first().click();
    await page.waitForSelector('#wizard-name');
    await page.locator('#wizard-name').fill('Weekend Server');
    await capture('server-wizard.png');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(fixture, 'capture-report.json'), JSON.stringify({ language: 'en', resolution: '1920x1080', templatesAvailable: Boolean(templates), profiles: 2, gameProcessesStarted: 0, privateDataCheck: 'passed', images: fs.readdirSync(images).filter(f => f.endsWith('.png')) }, null, 2));
    console.log('Captured five real English application screenshots; privacy checks passed. ' + fixture);
  } finally { await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
