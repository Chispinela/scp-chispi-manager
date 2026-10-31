'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const port = process.parentPort;
const send = message => port ? port.postMessage(message) : process.send(message);
let running = false, stage, operation, target;
const directories = new Set();
function progress(nextStage, nextOperation, nextPath, status = 'start', elapsedMs) {
  stage = nextStage; operation = nextOperation; target = nextPath;
  send({ type: 'progress', stage, operation, path: target, status, elapsedMs });
}
function perform(nextStage, nextOperation, nextPath, fn) {
  progress(nextStage, nextOperation, nextPath); const started = Date.now();
  const value = fn(); progress(nextStage, nextOperation, nextPath, 'complete', Date.now() - started); return value;
}
function mkdirTree(directory, stage) {
  const absolute = path.resolve(directory), root = path.parse(absolute).root;
  let current = root;
  for (const component of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const item = current;
    if (directories.has(item)) continue;
    let missing = false;
    try {
      perform(stage, 'stat', item, () => {
        if (!fs.statSync(item).isDirectory()) throw Object.assign(new Error('Expected a directory: ' + item), { code: 'ENOTDIR', syscall: 'stat', path: item });
      });
    } catch (error) { if (error.code !== 'ENOENT') throw error; missing = true; }
    if (!missing) { directories.add(item); continue; }
    perform(stage, 'mkdir', item, () => {
      try { fs.mkdirSync(item); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (!fs.statSync(item).isDirectory()) throw Object.assign(new Error('Expected a directory: ' + item), { code: 'ENOTDIR', syscall: 'mkdir', path: item });
      }
    });
    directories.add(item);
  }
}
function run(plan) {
  if (plan.type === 'shutdown' && running) { process.exit(0); return; }
  if (running) return; running = true;
  try {
    for (const directory of plan.directories) mkdirTree(directory, 'createDirectories');
    for (const file of plan.files) {
      mkdirTree(path.dirname(file.path), file.stage);
      const temp = file.path + '.' + crypto.randomUUID() + '.tmp';
      perform(file.stage, 'writeFile', temp, () => fs.writeFileSync(temp, file.text, { encoding: 'utf8', flag: 'wx' }));
      perform(file.stage, 'rename', file.path, () => fs.renameSync(temp, file.path));
    }
    send({ type: 'complete' });
  } catch (error) {
    send({ type: 'failed', error: { message: error.message, code: error.code || 'folderWorkerFailed', stack: error.stack, syscall: error.syscall || operation, path: error.path || target, stage } });
  }
}
if (port) port.on('message', event => run(event.data)); else process.on('message', run);
send({ type: 'ready' });
