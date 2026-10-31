// Only launched by tests: simulate an OS call that blocks the helper event loop.
const send = message => process.parentPort ? process.parentPort.postMessage(message) : process.send(message);
const run = () => {
  send({ type: 'progress', stage: 'createDirectories', operation: 'mkdir', path: 'test-blocked-folder', status: 'start' });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};
if (process.parentPort) process.parentPort.on('message', run); else process.on('message', run);
send({ type: 'ready' });
