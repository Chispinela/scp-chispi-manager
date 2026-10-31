const { _electron: electron } = require('playwright');
const path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
(async () => {
  const root = path.resolve('output/folder-recovery-ui-' + Date.now()); fs.mkdirSync(root, { recursive: true });
  const packaged = process.argv.includes('--packaged'), data = path.join(root, 'state'), file = path.join(root, 'diagnostic.zip');
  const app = await electron.launch(packaged ? { executablePath: path.resolve('release/win-unpacked/SCP Chispi Manager.exe'), args: ['--data-dir=' + data] } : { args: [path.resolve('.'), '--data-dir=' + data] });
  try {
    const page = await app.firstWindow(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.waitForSelector('#splash', { state: 'detached' });
    await app.evaluate(({ utilityProcess, dialog }, { fixture, root, file }) => {
      global.originalFolderFork = utilityProcess.fork.bind(utilityProcess);
      utilityProcess.fork = (script, args, options) => global.originalFolderFork(script.endsWith('server-files-worker.js') ? fixture : script, args, options);
      process.env.LOCALAPPDATA = root;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, { fixture: path.resolve('tests/fixtures/folder-hang.cjs'), root: path.join(root, 'local-appdata'), file });
    await page.locator('[data-action="new"]').first().click();
    await page.locator('[data-action="wizard-next"]').click();
    await page.locator('#wizard-folder').evaluate((el, value) => el.value = value, path.join(root, 'original-library'));
    await page.locator('[data-action="wizard-next"]').click();
    await page.locator('#wizard-eula').check(); await page.locator('#wizard-install').uncheck();
    const started = Date.now(); await page.locator('[data-action="wizard-create"]').click();
    await page.waitForFunction(() => document.querySelector('#creation-status')?.textContent.includes('más de lo esperado'), null, { timeout: 22000 });
    await page.locator('#modal-root [data-action="export-diagnostics"]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(el => el.textContent.includes('Diagnóstico guardado')));
    assert.ok(JSON.parse(new AdmZip(file).readAsText('summary.json')).pending.some(p => p.method === 'create'));
    await page.waitForFunction(() => document.querySelector('.modal-error')?.textContent.includes('30 segundos'), null, { timeout: 22000 });
    assert.ok(Date.now() - started >= 29000 && Date.now() - started < 40000);
    assert.equal(await page.locator('[data-action="wizard-create"]').isEnabled(), true);
    assert.equal((await page.evaluate(() => window.chispi.call('state'))).value.servers.length, 0);
    await page.screenshot({ path: path.join(root, 'folder-timeout.png') });
    await app.evaluate(({ utilityProcess }) => { utilityProcess.fork = global.originalFolderFork; });
    await page.locator('#modal-root [data-action="wizard-local"]').click();
    const expected = path.join(root, 'local-appdata', 'SCP Chispi Manager', 'Servers'); assert.equal(await page.locator('#wizard-folder').inputValue(), expected);
    await page.locator('[data-action="wizard-next"]').click();
    assert.equal(await page.locator('#wizard-eula').isChecked(), true);
    await page.locator('[data-action="wizard-create"]').click();
    await page.waitForSelector('.server-top-title', { timeout: 10000 });
    const state = (await page.evaluate(() => window.chispi.call('state'))).value;
    assert.equal(state.servers.length, 1); assert.equal(state.library, expected);
    assert.ok(fs.existsSync(path.join(state.servers[0].directory, 'game', 'hoster_policy.txt')));
    const result = await page.evaluate(() => window.chispi.call('exportDiagnostics')); assert.equal(result.ok, true);
    const records = new AdmZip(file).readAsText('logs/application.jsonl').trim().split('\n').map(JSON.parse);
    const failure = records.find(r => r.event === 'operation.failed' && r.data.method === 'create'); assert.equal(failure.data.error.code, 'folderTimeout'); assert.equal(failure.data.error.path, 'test-blocked-folder');
    assert.ok(records.some(r => r.event === 'create.stage' && r.data.operation === 'rename' && r.data.status === 'complete'));
    assert.deepEqual(errors, []); console.log('PASS: real helper hang, 30s termination, export during hang, controls recover, alternative folder creates exactly one profile, precise filesystem logs. ' + root);
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
