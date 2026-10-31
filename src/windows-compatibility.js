'use strict';
const os = require('node:os');

function windowsCompatibility({ platform = process.platform, arch = process.arch, release = os.release() } = {}) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(release);
  const major = match ? Number(match[1]) : 0;
  const build = match ? Number(match[3]) : 0;
  const supported = platform === 'win32' && arch === 'x64' && (major > 10 || (major === 10 && build >= 10240));
  // Windows 11 also reports kernel 10.0. Do not impose a maximum build or
  // an edition allowlist: Home, Pro, Enterprise and Education use the same APIs.
  return {
    supported, platform, arch, release, build,
    name: platform === 'win32' ? (major > 10 || (major === 10 && build >= 22000) ? 'Windows 11' : major === 10 ? 'Windows 10' : 'Windows') : os.type(),
    useConpty: platform === 'win32' && (major > 10 || (major === 10 && build >= 18309))
  };
}

function spawnWindowsTerminal(file, args, options, { factory, compatibility = windowsCompatibility() } = {}) {
  const pty = factory || require('node-pty');
  const terminalOptions = { ...options, useConpty: compatibility.useConpty, useConptyDll: false };
  try { return pty.spawn(file, args, terminalOptions); }
  catch (error) {
    if (!terminalOptions.useConpty) throw error;
    // Use the bundled legacy terminal if a Windows console API is unavailable.
    // Keep the same executable, arguments and working directory on retry.
    return pty.spawn(file, args, { ...terminalOptions, useConpty: false });
  }
}

module.exports = { windowsCompatibility, spawnWindowsTerminal };
