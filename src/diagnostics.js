'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');

// No request payloads, configuration files or manager.json are collected.
class Diagnostics {
  constructor(directory, fallback, options = {}) {
    this.session = crypto.randomUUID(); this.pending = new Map(); this.secrets = new Set();
    this.limit = options.limit || 2 * 1024 * 1024; this.count = 5;
    this.directory = directory; this.failure = null;
    try { this.open(directory); }
    catch (error) {
      this.failure = error.message; this.directory = fallback;
      try { this.open(fallback); } catch (e) { this.failure += '; ' + e.message; this.file = null; }
    }
    this.write('info', 'session.start', { fallback: this.failure });
  }
  open(directory) {
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, 'application.jsonl');
    fs.appendFileSync(this.file, '');
  }
  secret(value) { if (typeof value === 'string' && value.length >= 8) this.secrets.add(value); }
  clean(value) {
    let text = String(value ?? '');
    for (const secret of this.secrets) text = text.split(secret).join('[REDACTED]');
    return text.replace(/\b[a-f\d]{32}\b/gi, '[REDACTED-KEY]')
      .replace(/((?:api[_-]?key|steamKey|token|password|authorization|secret)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]');
  }
  serialize(value) {
    return JSON.stringify(value, (key, item) => {
      if (/^(steamKey|apiKey|token|password|authorization|secret)$/i.test(key)) return '[REDACTED]';
      if (item instanceof Error) return { name: item.name, message: item.message, code: item.code, stack: item.stack, syscall: item.syscall, path: item.path, dest: item.dest, errno: item.errno };
      return typeof item === 'string' ? this.clean(item).slice(0, 12000) : item;
    });
  }
  write(level, event, data = {}) {
    try {
      if (!this.file) return;
      const line = this.serialize({ time: new Date().toISOString(), session: this.session, level, event, data }) + '\n';
      if (fs.statSync(this.file).size + Buffer.byteLength(line) > this.limit) {
        for (let i = this.count - 1; i >= 1; i--) {
          const from = i === 1 ? this.file : this.file + '.' + (i - 1), to = this.file + '.' + i;
          if (fs.existsSync(to)) fs.unlinkSync(to);
          if (fs.existsSync(from)) fs.renameSync(from, to);
        }
      }
      fs.appendFileSync(this.file, line, 'utf8');
    } catch (error) { this.failure = error.message; }
  }
  begin(method, serverId) {
    const id = crypto.randomUUID(), operation = { id, method, serverId, started: Date.now() };
    this.pending.set(id, operation); this.write('info', 'operation.start', operation); return id;
  }
  end(id, error) {
    const operation = this.pending.get(id); this.pending.delete(id);
    this.write(error ? 'error' : 'info', error ? 'operation.failed' : 'operation.complete', { ...operation, elapsedMs: Date.now() - operation?.started, error });
  }
  slow(id) { const operation = this.pending.get(id); if (operation) this.write('warn', 'operation.slow', { ...operation, elapsedMs: Date.now() - operation.started }); }
  async exportTo(file, summary) {
    this.write('info', 'diagnostics.export');
    const zip = new AdmZip();
    zip.addFile('summary.json', Buffer.from(this.serialize({ format: 1, exported: new Date().toISOString(), session: this.session, logDirectory: this.directory, logWriteError: this.failure, pending: [...this.pending.values()].map(p => ({ ...p, elapsedMs: Date.now() - p.started })), ...summary })));
    for (let i = 0; i < this.count; i++) {
      const name = 'application.jsonl' + (i ? '.' + i : '');
      try {
        const raw = await fs.promises.readFile(path.join(this.directory, name), 'utf8');
        const records = raw.split('\n').filter(Boolean).map(line => {
          try { return this.serialize(JSON.parse(line)); }
          catch { return this.serialize({ event: 'log.unparsed', text: line }); }
        }).join('\n') + '\n';
        zip.addFile('logs/' + name, Buffer.from(records));
      }
      catch (e) { if (e.code !== 'ENOENT') zip.addFile('log-read-error-' + i + '.txt', Buffer.from(this.clean(e.message))); }
    }
    zip.addFile('LEEME.txt', Buffer.from('SCP Chispi Manager diagnostic report.\nContains system/CPU/GPU details, paths, operation timings, errors and recent server/SteamCMD output.\nMay contain Windows user names, IP addresses and player identifiers. Review before sharing.\nDoes not include manager.json, configurations, backups or Steam API keys. Nothing is sent automatically.\n'));
    await new Promise((resolve, reject) => zip.writeZip(file, e => e ? reject(e) : resolve()));
    return file;
  }
}
function systemInfo(version) {
  return { appVersion: version, platform: process.platform, arch: process.arch, windowsRelease: os.release(), osVersion: os.version(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGB: Math.round(os.totalmem() / 1024 ** 3), versions: process.versions };
}
module.exports = { Diagnostics, systemInfo };
