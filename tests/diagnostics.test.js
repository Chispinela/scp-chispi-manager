const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { Diagnostics } = require('../src/diagnostics');
const { ServerManager } = require('../src/core');
const { prepareServerFiles } = require('../src/server-files');
test('blocked filesystem helper is terminated before rejection and a new creation can succeed', async () => {
  const { fork } = require('node:child_process'); let child;
  const started = Date.now();
  await assert.rejects(prepareServerFiles({}, () => {}, { timeoutMs: 600, createChild: () => {
    child = fork(path.join(__dirname, 'fixtures/folder-hang.cjs'), [], { windowsHide: true, stdio: ['ignore','pipe','pipe','ipc'] }); return child;
  } }), error => { assert.equal(error.code, 'folderTimeout'); assert.equal(error.syscall, 'mkdir'); assert.equal(error.path, 'test-blocked-folder'); return true; });
  assert.ok(Date.now() - started < 5000); assert.ok(child.exitCode !== null || child.signalCode !== null);
  const root = path.resolve('output/folder-recovery-' + Date.now()); const entries = [];
  await prepareServerFiles({ directories: [root], files: [{ stage: 'createConfig', path: path.join(root, 'config.txt'), text: 'complete' }] }, entry => entries.push(entry));
  assert.equal(fs.readFileSync(path.join(root, 'config.txt'), 'utf8'), 'complete');
  assert.ok(entries.some(e => e.operation === 'rename' && e.status === 'complete'));
  const blocker = path.join(root, 'file-parent'); fs.writeFileSync(blocker, 'fixture');
  await assert.rejects(prepareServerFiles({ directories: [path.join(blocker, 'child')], files: [] }), error => { assert.equal(error.code, 'ENOTDIR'); assert.equal(error.path, blocker); return true; });
});
test('diagnostics survive restarts, redact secrets, rotate and export pending errors without configuration', async () => {
  const root = path.resolve('output/diagnostics-unit-' + Date.now());
  const logger = new Diagnostics(path.join(root, 'logs'), path.join(root, 'fallback'), { limit: 2500 });
  logger.secret('secret-value-unique');
  logger.write('error', 'failure', { steamKey: 'secret-value-unique', error: Object.assign(new Error('token=secret-value-unique denied'), { code: 'EACCES', path: root, syscall: 'mkdir' }) });
  let raw = fs.readFileSync(logger.file, 'utf8');
  assert.ok(!raw.includes('secret-value-unique')); assert.match(raw, /EACCES/); assert.match(raw, /mkdir/);
  for (let i = 0; i < 90; i++) logger.write('info', 'rotation', { message: 'x'.repeat(200) });
  assert.ok(fs.readdirSync(logger.directory).length <= 5);
  const resumed = new Diagnostics(logger.directory, path.join(root, 'fallback'));
  const pending = resumed.begin('create'); resumed.slow(pending);
  resumed.write('error', 'ui.error', { message: 'api_key=0123456789abcdef0123456789abcdef secret-value-unique' });
  // Known keys are also scrubbed when exporting older sessions.
  resumed.secret('secret-value-unique');
  resumed.write('error', 'redaction-at-end', { message: 'api_key=secret-value-unique' });
  const file = path.join(root, 'diagnostic.zip'); await resumed.exportTo(file, { system: { cpu: 'AMD test' } });
  const zip = new AdmZip(file), text = zip.getEntries().map(e => zip.readAsText(e)).join('\n');
  assert.match(text, /operation.slow/); assert.match(text, /AMD test/); assert.ok(!text.includes('0123456789abcdef0123456789abcdef')); assert.ok(!text.includes('secret-value-unique'));
  for (const entry of zip.getEntries().filter(e => e.entryName.startsWith('logs/'))) for (const line of zip.readAsText(entry).trim().split('\n')) assert.doesNotThrow(() => JSON.parse(line));
  assert.equal(JSON.parse(zip.readAsText('summary.json')).pending[0].method, 'create');
  assert.ok(!zip.getEntries().some(e => e.entryName.endsWith('manager.json')));
  const blocker = path.join(root, 'not-a-directory'); fs.writeFileSync(blocker, 'fixture');
  const fallback = new Diagnostics(path.join(blocker, 'logs'), path.join(root, 'fallback'));
  assert.ok(fallback.failure); assert.ok(fs.existsSync(fallback.file));
});
test('failed profile save rolls back library/profile and records the exact failing creation stage', async () => {
  const root = path.resolve('output/create-failure-unit-' + Date.now());
  const manager = await new ServerManager(path.join(root, 'state'), path.join(root, 'old')).init();
  const entries = []; manager.on('diagnostic', e => entries.push(e));
  manager.save = async () => { throw Object.assign(new Error('fixture write denied'), { code: 'EACCES' }); };
  await assert.rejects(manager.create({ name: 'Test', port: 7777, eula: true, library: path.join(root, 'new') }), { code: 'EACCES' });
  assert.equal(manager.state.servers.length, 0); assert.equal(manager.state.library, path.join(root, 'old'));
  assert.equal(entries.at(-1).stage, 'createSave'); assert.equal(entries.at(-1).error.code, 'EACCES');
});
