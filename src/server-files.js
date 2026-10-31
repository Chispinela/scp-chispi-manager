'use strict';
const path = require('node:path');
const { fork } = require('node:child_process');

function createChild() {
  const script = path.join(__dirname, 'server-files-worker.js');
  if (process.versions.electron) return require('electron').utilityProcess.fork(script, [], { stdio: 'pipe', serviceName: 'SCP server folder setup' });
  return fork(script, [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
}

// A blocked Windows filesystem call must not occupy the manager's own I/O pool.
// Only the parent commits the profile, after this child has exited successfully.
function prepareServerFiles(plan, onProgress = () => {}, options = {}) {
  return new Promise((resolve, reject) => {
    let child, timeout, killDeadline, result, stopped = false, settled = false, lastOperation, stderr = '';
    const finish = error => { if (settled) return; settled = true; clearTimeout(timeout); clearTimeout(killDeadline); error ? reject(error) : resolve(); };
    try { child = (options.createChild || createChild)(); } catch (error) { finish(error); return; }
    const terminate = error => {
      if (stopped || settled) return; stopped = true; result = error;
      try { child.kill(); } catch (killError) { error.killError = killError.message; }
      // No late response can commit a profile after the deadline, even if the OS
      // cannot immediately release an outstanding device/filesystem request.
      killDeadline = setTimeout(() => finish(error), 3000);
    };
    timeout = setTimeout(() => terminate(Object.assign(new Error('Windows did not finish the folder operation within 30 seconds'), { code: 'folderTimeout', syscall: lastOperation?.operation, path: lastOperation?.path })), options.timeoutMs ?? 30000);
    child.stderr?.on('data', data => { stderr = (stderr + String(data)).slice(-2000); });
    child.on('error', error => terminate(error instanceof Error ? error : new Error(String(error))));
    child.on('message', message => {
      if (stopped || settled) return;
      if (message.type === 'ready') {
        if (child.postMessage) child.postMessage(plan); else child.send(plan);
      } else if (message.type === 'progress') { lastOperation = message; onProgress(message); }
      else if (message.type === 'complete' || message.type === 'failed') {
        result = message.type === 'complete' ? true : Object.assign(new Error(message.error.message), message.error);
        if (child.postMessage) child.postMessage({ type: 'shutdown' }); else child.send({ type: 'shutdown' });
      }
    });
    child.on('exit', code => {
      if (result instanceof Error) finish(result);
      else if (result === true && code === 0) finish();
      else finish(Object.assign(new Error(stderr || 'Server folder helper exited before finishing'), { code: 'folderWorkerFailed', exitCode: code }));
    });
  });
}
module.exports = { prepareServerFiles };
