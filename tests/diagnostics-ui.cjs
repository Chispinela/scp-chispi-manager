const { _electron: electron } = require('playwright');
const path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
(async () => {
  const root = path.resolve('output/diagnostics-ui-' + Date.now()); fs.mkdirSync(root, { recursive: true });
  const data = path.join(root, 'state'), exported = path.join(root, 'report.zip');
  const packaged = process.argv.includes('--packaged');
  const launch = () => electron.launch(packaged ? { executablePath: path.resolve('release/win-unpacked/SCP Chispi Manager.exe'), args: ['--data-dir=' + data] } : { args: [path.resolve('.'), '--data-dir=' + data] });
  let instance = await launch();
  try {
    let page = await instance.firstWindow(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.waitForSelector('#splash', { state: 'detached' });
    await instance.evaluate(({ app, dialog }, exported) => {
      const req = process.mainModule.require.bind(process.mainModule);
      const { ServerManager } = req(req('path').join(app.getAppPath(), 'src/core.js'));
      global.originalSave = ServerManager.prototype.save;
      ServerManager.prototype.save = async function () { throw Object.assign(new Error('Simulated Windows write denial'), { code: 'EACCES', syscall: 'rename', path: req('path').join(app.getPath('userData'), 'manager.json') }); };
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: exported });
    }, exported);
    await page.locator('[data-action="new"]').first().click();
    await page.locator('[data-action="wizard-next"]').click();
    await page.locator('#wizard-folder').evaluate((el, library) => el.value = library, path.join(root, 'library'));
    await page.locator('[data-action="wizard-next"]').click();
    await page.locator('[data-action="wizard-create"]').click(); // EULA required, no operation.
    await page.waitForSelector('.modal-error:not(:empty)');
    await page.locator('#wizard-eula').check(); await page.locator('#wizard-install').uncheck();
    await page.locator('[data-action="wizard-create"]').click();
    await page.waitForFunction(() => document.querySelector('.modal-error')?.textContent.includes('Simulated Windows write denial'));
    assert.equal(await page.locator('[data-action="wizard-create"]').isEnabled(), true);
    assert.equal((await page.evaluate(() => window.chispi.call('state'))).value.servers.length, 0);
    await page.screenshot({ path: path.join(root, 'creation-error.png') });
    await instance.evaluate(({ app }) => {
      const req = process.mainModule.require.bind(process.mainModule), { ServerManager } = req(req('path').join(app.getAppPath(), 'src/core.js'));
      ServerManager.prototype.save = global.originalSave;
      const original = ServerManager.prototype.create;
      ServerManager.prototype.create = async function (p) { await new Promise(r => setTimeout(r, 20000)); return original.call(this, p); };
    });
    await page.locator('[data-action="wizard-create"]').click();
    await page.waitForFunction(() => document.querySelector('#creation-status')?.textContent.includes('más de lo esperado'), { timeout: 22000 });
    assert.equal(await page.locator('[data-action="wizard-create"]').isDisabled(), true);
    await page.locator('#modal-root [data-action="export-diagnostics"]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(el => el.textContent.includes('Diagnóstico guardado')));
    let zip = new AdmZip(exported), summary = JSON.parse(zip.readAsText('summary.json'));
    assert.ok(summary.pending.some(p => p.method === 'create')); assert.ok(summary.system.cpu); assert.ok(summary.gpu.basic);
    let text = zip.getEntries().map(e => zip.readAsText(e)).join('\n'); assert.match(text, /operation.slow/); assert.match(text, /EACCES/); assert.match(text, /rename/);
    await page.screenshot({ path: path.join(root, 'creation-slow.png') });
    await page.waitForSelector('.server-top-title', { timeout: 15000 });
    assert.equal((await page.evaluate(() => window.chispi.call('state'))).value.servers.length, 1);
    await page.evaluate(() => { window.dispatchEvent(new ErrorEvent('error', { message: 'Diagnostic renderer fixture', error: new Error('Diagnostic renderer fixture') })); window.chispi.report({ event: 'ui.unhandledRejection', message: 'Diagnostic rejection fixture' }); });
    await page.locator('[data-nav="preferences"]').click(); await page.waitForSelector('.diagnostics-panel');
    await page.screenshot({ path: path.join(root, 'diagnostics-settings.png') });
    assert.deepEqual(errors, []);
    await instance.close(); instance = await launch(); page = await instance.firstWindow(); await page.waitForSelector('#splash', { state: 'detached' });
    await instance.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, exported);
    const result = await page.evaluate(() => window.chispi.call('exportDiagnostics')); assert.equal(result.ok, true);
    zip = new AdmZip(exported); text = zip.getEntries().map(e => zip.readAsText(e)).join('\n');
    assert.match(text, /Diagnostic renderer fixture/); assert.match(text, /Diagnostic rejection fixture/); assert.match(text, /createSave/);
    const sessions = new Set(zip.readAsText('logs/application.jsonl').trim().split('\n').map(line => JSON.parse(line).session)); assert.ok(sessions.size >= 2);
    console.log('PASS: EULA validation, real wizard save failure/recovery, slow operation warning, export while pending, CPU/GPU, restart persistence, renderer errors. ' + root);
  } finally { await instance.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
