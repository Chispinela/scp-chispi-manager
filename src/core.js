'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const dgram = require('node:dgram');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const AdmZip = require('adm-zip');
const { parseSteamProgress } = require('./steam-progress');
const { windowsCompatibility, spawnWindowsTerminal } = require('./windows-compatibility');
const { prepareServerFiles } = require('./server-files');

class ManagerError extends Error {
  constructor(code, detail = '') { super(detail || code); this.code = code; }
}
const fail = (code, detail) => { throw new ManagerError(code, detail); };
const CONFIG_FILES = ['config_gameplay.txt', 'config_remoteadmin.txt', 'config_localadmin.txt', 'config_sharing.txt', 'UserIDBans.txt', 'IPBans.txt', 'UserIDWhitelist.txt', 'UserIDReservedSlots.txt'];
const exists = p => fs.existsSync(p);
const cleanLine = s => String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '').replace(/[\x00-\x08\x0b-\x1f]/g, '');
function assertText(v, max = 5000) { if (typeof v !== 'string' || v.length > max || /\0/.test(v)) fail('invalidInput'); return v; }
function scalar(v) { return assertText(v, 5000).replace(/[\r\n]/g, ' '); }
function configValues(text) {
  return Object.fromEntries(text.split(/\r?\n/).map(l => l.match(/^([A-Za-z0-9_]+):(?: |$)(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]));
}
function patchConfig(text, values) {
  let lines = text.replace(/\r\n/g, '\n').split('\n');
  for (const [key, v] of Object.entries(values)) {
    if (!/^[A-Za-z0-9_]+$/.test(key)) fail('invalidInput');
    const value = scalar(String(v));
    const matches = lines.map((l, i) => l.startsWith(key + ':') ? i : -1).filter(i => i >= 0);
    if (matches.length > 1) fail('duplicateKey', key);
    if (matches.length) lines[matches[0]] = `${key}: ${value}`;
    else lines.push(`${key}: ${value}`);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
function assignAdmin(text, userId, role) {
  if (!/^\d{17}@steam$/.test(userId) && !/^\d{17,20}@discord$/.test(userId)) fail('invalidId');
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(role)) fail('invalidInput');
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => !/^\s*-\s+(?:SomeSteamId64|SomeOtherSteamId64|AnotherSteamId64|SomeDiscordUserId)@(?:steam|discord):/.test(l));
  // Roles must already be defined by the installed game; never guess permission nodes.
  const rolesStart = lines.findIndex(l => /^Roles:\s*(?:#.*)?$/.test(l));
  let available = [];
  if (rolesStart >= 0) {
    for (let i = rolesStart + 1; i < lines.length; i++) {
      if (/^[\w]+:/.test(lines[i])) break;
      const m = lines[i].match(/^\s*-\s+([\w-]+)\s*(?:#.*)?$/); if (m) available.push(m[1]);
    }
  }
  if (!available.includes(role)) fail('roleMissing', role);
  const start = lines.findIndex(l => /^Members:\s*(?:#.*)?$/.test(l));
  if (start < 0) fail('membersMissing');
  let end = start + 1;
  while (end < lines.length && !/^[\w]+:/.test(lines[end])) end++;
  const existing = lines.findIndex((l, i) => i > start && i < end && l.match(/^\s*-\s+([^:]+):/)?.[1] === userId);
  if (existing >= 0) lines[existing] = ` - ${userId}: ${role}`;
  else lines.splice(start + 1, 0, ` - ${userId}: ${role}`);
  return lines.join('\n');
}
function getAdmins(text) {
  const section = text.match(/^Members:\s*\r?\n([\s\S]*?)(?=^\w+:|(?![\s\S]))/m)?.[1] || '';
  return [...section.matchAll(/^\s*-\s+([^:\s]+):\s*([\w-]+)/gm)].filter(m => !/^(?:SomeSteamId64|SomeOtherSteamId64|AnotherSteamId64|SomeDiscordUserId)@/.test(m[1])).map(m => ({ userId: m[1], role: m[2] }));
}
function getRoles(text) {
  const section = text.match(/^Roles:\s*\r?\n([\s\S]*?)(?=^\w+:|(?![\s\S]))/m)?.[1] || '';
  return [...section.matchAll(/^\s*-\s+([\w-]+)\s*$/gm)].map(m => m[1]);
}
function parsePlayerLine(line) {
  const id = line.match(/(\d{17,20})@(steam|discord)/);
  if (!id) return null;
  // Vanilla `players` prints `Nickname (ID, UserID)`; accept labelled formats too.
  let name = line.replace(/^\[[^\]]+\]\s*/g, '').replace(/^\s*[-*]\s*/, '').trim();
  name = name.split(id[0])[0].replace(/[\s,(|:]+$/, '');
  const numeric = name.match(/(?:^|\b)(?:Player\s*ID\s*[:=]\s*)?(\d{1,5})[)\]:|,\s]+/i);
  name = name.replace(/\s*\(\s*\d+\s*[,;:]?\s*$/, '').replace(/^\d{1,5}\s*[:|)-]\s*/, '').trim();
  return { userId: id[0], steamId: id[2] === 'steam' ? id[1] : null, name: name || id[0], playerId: numeric?.[1] || null };
}
function networkAdapters() {
  const rows = [];
  for (const [name, interfaces] of Object.entries(os.networkInterfaces())) {
    for (const n of interfaces || []) if (n.family === 'IPv4') rows.push({ name, address: n.address, internal: n.internal, vpn: /radmin|tailscale|hamachi|zerotier|wireguard|openvpn/i.test(name), radmin: /radmin/i.test(name), virtual: /vEthernet|Hyper-V|VMware|VirtualBox/i.test(name), cidr: n.cidr });
  }
  return rows;
}
async function atomicWrite(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  await fsp.writeFile(temp, data, 'utf8');
  await fsp.rename(temp, file);
}
async function freePort(port, address = '0.0.0.0') {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    s.once('error', err => { s.close(); reject(new ManagerError('portBusy', err.message)); });
    s.bind(port, address, () => s.close(() => resolve(true)));
  });
}
function within(parent, target) {
  const rel = path.relative(path.resolve(parent), path.resolve(target));
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
async function download(url, file, onProgress = () => {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) fail('downloadFailed', `HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length')) || 0;
  const { Readable, Transform } = require('node:stream');
  const { pipeline } = require('node:stream/promises');
  let received = 0;
  const stream = Readable.fromWeb(response.body);
  const progress = new Transform({ transform(d, encoding, callback) { received += d.length; onProgress(length ? Math.round(received / length * 100) : null); callback(null, d); } });
  await fsp.mkdir(path.dirname(file), { recursive: true });
  try { await pipeline(stream, progress, fs.createWriteStream(file + '.part')); if (length && received !== length) fail('downloadFailed'); await fsp.rename(file + '.part', file); }
  catch (e) { await fsp.rm(file + '.part', { force: true }); throw e; }
}

class ServerManager extends EventEmitter {
  constructor(dataDir, defaultLibrary) {
    super(); this.dataDir = dataDir; this.defaultLibrary = defaultLibrary;
    this.state = { version: 1, language: 'es', library: defaultLibrary, servers: [], steamKey: '', backupHours: 0, retention: 10 };
    this.runtimes = new Map(); this.jobs = new Map(); this.deleting = new Set(); this.steamBusy = false; this.activity = [];
  }
  async init() {
    await fsp.mkdir(this.dataDir, { recursive: true });
    const stateFile = path.join(this.dataDir, 'manager.json');
    if (exists(stateFile)) {
      try { const saved = JSON.parse(await fsp.readFile(stateFile, 'utf8')); if (!Array.isArray(saved.servers) || saved.version !== 1) throw Error(); Object.assign(this.state, saved); }
      catch { fail('stateCorrupt', stateFile); }
    }
    return this;
  }
  async save() { await atomicWrite(path.join(this.dataDir, 'manager.json'), JSON.stringify(this.state, null, 2)); this.emit('changed'); }
  server(id) { return this.state.servers.find(s => s.id === id) || fail('serverMissing'); }
  root(s) { return s.directory; }
  game(s) { return path.join(s.directory, 'game'); }
  config(s) { return path.join(this.game(s), 'AppData', 'config', String(s.port)); }
  backupDir(s) { return path.join(s.directory, 'backups'); }
  runtime(id) { if (!this.runtimes.has(id)) this.runtimes.set(id, { status: 'stopped', lines: [], players: [], playersAt: null, started: null, child: null }); return this.runtimes.get(id); }
  log(id, text) {
    const rt = this.runtime(id);
    for (const line of cleanLine(text).split('\n').filter(Boolean)) {
      rt.lines.push({ time: new Date().toISOString(), text: line }); if (rt.lines.length > 1500) rt.lines.shift();
      this.emit('log', { id, line: rt.lines.at(-1) });
      if (/Waiting for players|Server (?:is )?(?:now )?running|Round started/i.test(line) && rt.child && rt.status === 'starting') { rt.status = 'running'; this.emit('changed'); }
      if (rt.collect) {
        if (/List of players\s*\((\d+)\)/i.test(line)) { rt.collect.header = true; rt.collect.expected = Number(line.match(/List of players\s*\((\d+)\)/i)[1]); }
        else if (rt.collect.header) { const p = parsePlayerLine(line); if (p && !rt.collect.rows.some(x => x.userId === p.userId)) rt.collect.rows.push(p); }
      }
    }
  }
  note(id, key) { this.activity.unshift({ id, key, time: new Date().toISOString() }); this.activity = this.activity.slice(0, 50); this.emit('changed'); }
  snapshot() {
    return {
      ...this.state, steamKey: undefined, hasSteamKey: Boolean(this.state.steamKey), windows: windowsCompatibility(), adapters: networkAdapters(), steamInstalled: exists(path.join(this.state.library, 'steamcmd', 'steamcmd.exe')), activity: this.activity,
      servers: this.state.servers.map(s => { const r = this.runtime(s.id); return { ...s, installed: exists(path.join(this.game(s), 'LocalAdmin.exe')), configDir: this.config(s), status: r.status, pid: r.child?.pid || null, started: r.started, players: r.players, playersAt: r.playersAt, job: this.jobs.get(s.id) || null }; })
    };
  }
  async create(input) {
    const name = scalar(input.name).trim(); if (!name || name.length > 100) fail('invalidInput');
    const port = Number(input.port); if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('invalidPort');
    if (this.state.servers.some(s => s.port === port)) fail('portBusy');
    const library = input.library || this.state.library;
    if (!path.isAbsolute(library) || /[\r\n"\0]/.test(library)) fail('invalidPath');
    const id = crypto.randomUUID();
    const slug = name.normalize('NFKD').replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 32) || 'server';
    const s = { id, name, port, directory: path.join(library, 'servers', slug + '-' + id.slice(0, 8)), bindIp: '0.0.0.0', adapter: '', created: new Date().toISOString(), lastBackup: null, eula: Boolean(input.eula) };
    let stage = 'createDirectories';
    const trace = value => { stage = value; this.emit('diagnostic', { stage, id, port, directory: s.directory }); };
    try {
      trace('createDirectories');
      await prepareServerFiles({ directories: [this.game(s), this.backupDir(s)], files: [
        { stage: 'createPolicy', path: path.join(this.game(s), 'hoster_policy.txt'), text: 'gamedir_for_configs: true\n' },
        { stage: 'createConfig', path: path.join(this.config(s), 'config_gameplay.txt'), text: `# SCP Chispi Manager\nserver_name: ${name}\nmax_players: 20\nserver_ip: auto\nipv4_bind_ip: 0.0.0.0\nforward_ports: false\nonline_mode: true\nfriendly_fire: false\n` }
      ] }, entry => { stage = entry.stage; this.emit('diagnostic', { ...entry, id, port, directory: s.directory }); });
      trace('createSave');
      const previousLibrary = this.state.library;
      this.state.servers.push(s); this.state.library = library;
      try { await this.save(); } catch (error) { this.state.servers = this.state.servers.filter(server => server.id !== id); this.state.library = previousLibrary; throw error; }
      trace('createComplete'); this.note(id, 'created'); return s;
    } catch (error) { this.emit('diagnostic', { stage, id, port, directory: s.directory, error }); throw error; }
  }
  idle(s) { if (this.runtime(s.id).child || this.jobs.has(s.id) || this.deleting.has(s.id)) fail('stopFirst'); }
  async removeServer(id, mode = 'keep', trashItem) {
    const s = this.server(id); this.idle(s);
    if (!['keep', 'trash'].includes(mode) || (mode === 'trash' && typeof trashItem !== 'function')) fail('invalidInput');
    this.deleting.add(id);
    try {
      if (mode === 'trash') {
        // Only the dedicated directory generated for this profile may be moved.
        // Never remove a library root, shared SteamCMD, another profile or a junction target.
        const target = path.resolve(s.directory);
        const protectedPaths = [this.dataDir, this.state.library, ...this.state.servers.filter(other => other.id !== id).map(other => other.directory)];
        if (!path.isAbsolute(s.directory) || !/^[a-f\d-]{36}$/i.test(id) || path.basename(path.dirname(target)).toLowerCase() !== 'servers' || !path.basename(target).toLowerCase().endsWith('-' + id.slice(0, 8).toLowerCase()) || protectedPaths.some(p => within(target, p))) fail('unsafeDeletePath');
        let stat;
        try { stat = await fsp.lstat(target); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        if (stat) {
          const actual = await fsp.realpath(target);
          const normal = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
          if (!stat.isDirectory() || stat.isSymbolicLink() || normal(actual) !== normal(target)) fail('unsafeDeletePath');
          // Failure to recycle must never silently fall back to permanent deletion.
          try { await trashItem(actual); } catch { fail('trashFailed'); }
        }
      }
      const previous = this.state.servers;
      this.state.servers = previous.filter(server => server.id !== id);
      try { await this.save(); } catch (e) { this.state.servers = previous; throw e; }
      this.runtimes.delete(id);
      this.activity = this.activity.filter(entry => entry.id !== id);
      this.emit('changed');
    } finally { this.deleting.delete(id); }
  }
  async setPreferences(p) {
    if (p.language !== undefined) { if (!['es','en','ru','zh','ja','pt'].includes(p.language)) fail('invalidInput'); this.state.language = p.language; }
    if (p.library !== undefined) { if (!path.isAbsolute(p.library) || /[\r\n"\0]/.test(p.library)) fail('invalidPath'); if (this.steamBusy) fail('jobBusy'); this.state.library = p.library; }
    if (p.backupHours !== undefined) { if (![0,1,6,12,24].includes(Number(p.backupHours))) fail('invalidInput'); this.state.backupHours = Number(p.backupHours); }
    if (p.retention !== undefined) { if (!Number.isInteger(+p.retention) || +p.retention < 1 || +p.retention > 100) fail('invalidInput'); this.state.retention = Number(p.retention); }
    if (p.steamKey !== undefined) this.state.steamKey = p.steamKey;
    await this.save();
  }
  async readConfig(id, file) {
    const s = this.server(id); if (!CONFIG_FILES.includes(file)) fail('invalidInput');
    const target = path.join(this.config(s), file);
    return exists(target) ? await fsp.readFile(target, 'utf8') : '';
  }
  async writeConfig(id, file, text, expected) {
    const s = this.server(id); this.idle(s); assertText(text, 2_000_000);
    if (!CONFIG_FILES.includes(file)) fail('invalidInput');
    const target = path.join(this.config(s), file);
    const current = await this.readConfig(id, file);
    if (expected !== undefined && expected !== current) fail('fileChanged');
    if (exists(target)) await this.backup(id, 'before-edit');
    await atomicWrite(target, text);
    if (file === 'config_gameplay.txt') { const v = configValues(text); s.bindIp = v.ipv4_bind_ip || '0.0.0.0'; s.name = v.server_name?.replace(/<[^>]*>/g, '').slice(0,100) || s.name; }
    await this.save(); this.note(id, 'configSaved');
  }
  async admin(id, userId, role, remove = false) {
    const raw = await this.readConfig(id, 'config_remoteadmin.txt');
    let updated;
    if (remove) {
      if (!/^[\w@.-]+$/.test(userId)) fail('invalidId');
      updated = raw.split(/\r?\n/).filter(l => l.match(/^\s*-\s+([^:]+):/)?.[1] !== userId).join('\n');
    } else updated = assignAdmin(raw, userId.includes('@') ? userId : userId + '@steam', role);
    await this.writeConfig(id, 'config_remoteadmin.txt', updated, raw);
  }
  async setNetwork(id, address, adapter) {
    const s = this.server(id); this.idle(s);
    if (address !== '0.0.0.0' && !networkAdapters().some(n => n.address === address && n.name === adapter)) fail('adapterMissing');
    const raw = await this.readConfig(id, 'config_gameplay.txt');
    await this.writeConfig(id, 'config_gameplay.txt', patchConfig(raw, { ipv4_bind_ip: address, forward_ports: 'false' }), raw);
    s.adapter = adapter || ''; s.bindIp = address; await this.save();
  }
  async backup(id, reason = 'manual') {
    const s = this.server(id); if (this.jobs.has(id) || this.deleting.has(id)) fail('jobBusy');
    if (this.runtime(id).child) fail('stopFirst');
    const zip = new AdmZip();
    const appData = path.join(this.game(s), 'AppData');
    if (exists(appData)) zip.addLocalFolder(appData, 'AppData');
    for (const folder of ['LabAPI', 'Plugins']) if (exists(path.join(this.game(s), folder))) zip.addLocalFolder(path.join(this.game(s), folder), folder);
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({ format: 1, serverId: id, port: s.port, reason, created: new Date().toISOString() })));
    const filename = new Date().toISOString().replace(/[:.]/g, '-') + '-' + reason + '.zip';
    await fsp.mkdir(this.backupDir(s), { recursive: true });
    await new Promise((resolve, reject) => zip.writeZip(path.join(this.backupDir(s), filename), e => e ? reject(e) : resolve()));
    s.lastBackup = new Date().toISOString(); await this.save();
    const list = await this.backups(id);
    for (const old of list.slice(this.state.retention)) await fsp.unlink(path.join(this.backupDir(s), old.name));
    this.note(id, 'backupCreated'); return filename;
  }
  async backups(id) {
    const s = this.server(id); if (!exists(this.backupDir(s))) return [];
    const list = await fsp.readdir(this.backupDir(s));
    return Promise.all(list.filter(x => /^[\w.-]+\.zip$/.test(x)).sort().reverse().map(async name => ({ name, size: (await fsp.stat(path.join(this.backupDir(s), name))).size })));
  }
  async restore(id, name) {
    const s = this.server(id); this.idle(s);
    if (!/^[\w.-]+\.zip$/.test(name)) fail('invalidInput');
    const zip = new AdmZip(path.join(this.backupDir(s), name));
    const manifest = JSON.parse(zip.readAsText('manifest.json'));
    if (manifest.format !== 1 || manifest.serverId !== id || manifest.port !== s.port) fail('invalidBackup');
    const entries = zip.getEntries(); let total = 0;
    for (const e of entries) {
      total += e.header.size;
      if (total > 2_000_000_000 || e.entryName.includes('\\') || !within(this.game(s), path.join(this.game(s), e.entryName)) || (e.entryName !== 'manifest.json' && !/^(AppData|LabAPI|Plugins)\//.test(e.entryName))) fail('invalidBackup');
    }
    // Read and CRC-check all entries before changing any server files.
    const files = entries.filter(e => !e.isDirectory && e.entryName !== 'manifest.json').map(e => ({ name: e.entryName, data: e.getData() }));
    const roots = ['AppData', 'LabAPI', 'Plugins'];
    for (const root of roots) { const target = path.join(this.game(s), root); if (exists(target) && (await fsp.lstat(target)).isSymbolicLink()) fail('invalidBackup'); }
    await this.backup(id, 'before-restore');
    const staging = path.join(s.directory, '.restore-' + crypto.randomUUID());
    const staged = path.join(staging, 'new'); const rollback = path.join(staging, 'old');
    if (!within(s.directory, staging) || path.dirname(staging) !== path.resolve(s.directory)) fail('invalidBackup');
    await fsp.mkdir(staged, { recursive: true }); await fsp.mkdir(rollback, { recursive: true });
    const swapped = []; let safeCleanup = true;
    try {
      for (const e of files) { const target = path.join(staged, e.name); await fsp.mkdir(path.dirname(target), { recursive: true }); await fsp.writeFile(target, e.data); }
      // Swap complete trees so files added after the snapshot do not survive a restore.
      for (const root of roots) {
        const dest = path.join(this.game(s), root), old = path.join(rollback, root), incoming = path.join(staged, root);
        const item = { dest, old, incoming, movedOld: false, movedNew: false }; swapped.push(item);
        if (exists(dest)) { await fsp.rename(dest, old); item.movedOld = true; }
        if (exists(incoming)) { await fsp.rename(incoming, dest); item.movedNew = true; }
      }
    } catch (e) {
      try {
        for (const item of swapped.reverse()) {
          if (item.movedNew) await fsp.rename(item.dest, item.incoming);
          if (item.movedOld) await fsp.rename(item.old, item.dest);
        }
      } catch (recoveryError) { safeCleanup = false; this.log(id, 'Restore recovery files: ' + staging); throw recoveryError; }
      throw e;
    } finally { if (safeCleanup && within(s.directory, staging) && path.basename(staging).startsWith('.restore-')) await fsp.rm(staging, { recursive: true, force: true }); }
    const v = configValues(await this.readConfig(id, 'config_gameplay.txt')); s.bindIp = v.ipv4_bind_ip || '0.0.0.0';
    await this.save(); this.note(id, 'backupRestored');
  }
  async install(id) {
    const s = this.server(id); this.idle(s); if (this.steamBusy) fail('jobBusy'); if (!s.eula) fail('eulaRequired');
    if (exists(path.join(this.game(s), 'LocalAdmin.exe'))) await this.backup(id, 'before-update');
    const updateJob = update => {
      const before = this.jobs.get(id) || { lines: [] };
      this.jobs.set(id, { ...before, ...update }); this.emit('changed');
    };
    const installLog = line => {
      this.log(id, line);
      const job = this.jobs.get(id);
      if (!job) return;
      job.lines.push({ time: new Date().toISOString(), text: line });
      if (job.lines.length > 100) job.lines.shift();
      updateJob({ ...parseSteamProgress(line, job), detail: line });
    };
    this.steamBusy = true; updateJob({ phase: 'steamcmd', step: 'steamcmdDownload', percent: null, lines: [], detail: '' });
    try {
      const dir = path.join(this.state.library, 'steamcmd');
      const exe = path.join(dir, 'steamcmd.exe');
      if (!exists(exe)) {
        const archive = path.join(dir, 'steamcmd.zip');
        installLog('[SteamCMD] Download: https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip');
        if (!exists(archive)) await download('https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip', archive, percent => updateJob({ phase: 'steamcmd', step: 'steamcmdDownload', percent }));
        updateJob({ phase: 'steamcmd', step: 'steamcmdExtract', percent: null });
        installLog('[SteamCMD] Extracting steamcmd.zip');
        try { new AdmZip(archive).extractAllTo(dir, true); }
        catch (e) { await fsp.rm(archive, { force: true }); throw new ManagerError('downloadFailed'); }
      }
      updateJob({ phase: 'steamcmd', step: 'connectingSteam', percent: null });
      const attempt = () => new Promise((resolve, reject) => {
        installLog(`> steamcmd.exe +force_install_dir "${this.game(s)}" +login anonymous +app_update 996560 validate +quit`);
        // SteamCMD buffers redirected output. ConPTY gives it a real terminal so
        // download percentages and command output arrive while it is working.
        const child = spawnWindowsTerminal(exe, ['+force_install_dir', this.game(s), '+login', 'anonymous', '+app_update', '996560', 'validate', '+quit'], { cwd: dir, name: 'xterm', cols: 240, rows: 30, env: process.env });
        let successful = false;
        let pending = '', flushTimer;
        const { stripVTControlCharacters } = require('node:util');
        const timer = setTimeout(() => { child.kill(); reject(new ManagerError('installTimeout')); }, 45 * 60 * 1000);
        const lineOutput = raw => {
          const line = cleanLine(stripVTControlCharacters(raw)).trimEnd(); if (!line.trim()) return;
          if (/Success! App '996560' fully installed/i.test(line)) successful = true;
          installLog(line);
        };
        const flush = () => { clearTimeout(flushTimer); if (pending) { lineOutput(pending); pending = ''; } };
        child.onData(data => {
          clearTimeout(flushTimer);
          pending += data.replace(/\x1b\[\d+;\d+H/g, '\n');
          const lines = pending.split(/\r\n|\r|\n/); pending = lines.pop();
          for (const line of lines) lineOutput(line);
          if (pending) flushTimer = setTimeout(flush, 100);
        });
        child.onExit(({ exitCode }) => {
          clearTimeout(timer); flush();
          exitCode === 0 && successful && exists(path.join(this.game(s), 'LocalAdmin.exe')) ? resolve() : reject(new ManagerError('installFailed', `SteamCMD: ${exitCode}`));
        });
      });
      try { await attempt(); }
      catch (e) {
        if (e.code !== 'installFailed') throw e;
        updateJob({ step: 'connectingSteam', percent: null });
        installLog('[Manager] SteamCMD initialization failed. Retrying once with the updated client.');
        await new Promise(resolve => setTimeout(resolve, 1500)); await attempt();
      }
      updateJob({ phase: 'game', step: 'configuringServer', percent: null });
      await atomicWrite(path.join(this.game(s), 'hoster_policy.txt'), 'gamedir_for_configs: true\n');
      await this.seedConfigs(s);
      updateJob({ step: 'installFinished', percent: 100 });
      this.note(id, 'installed'); return true;
    } catch (e) { this.log(id, e.message); throw e; }
    finally { this.steamBusy = false; this.jobs.delete(id); this.emit('changed'); }
  }
  async seedConfigs(s) {
    const templates = path.join(this.game(s), 'ConfigTemplates');
    if (!exists(templates)) return;
    for (const name of ['gameplay', 'remoteadmin', 'sharing']) {
      const source = path.join(templates, `config_${name}.template.txt`);
      const target = path.join(this.config(s), `config_${name}.txt`);
      if (!exists(source)) continue;
      let text = await fsp.readFile(source, 'utf8');
      if (name === 'remoteadmin') text = text.split(/\r?\n/).filter(l => !/^\s*-\s+(?:SomeSteamId64|SomeOtherSteamId64|AnotherSteamId64|SomeDiscordUserId)@(?:steam|discord):/.test(l)).join('\n');
      if (!exists(target)) await atomicWrite(target, text);
      else if (name === 'gameplay' && !s.configInitialized) {
        const previous = await fsp.readFile(target, 'utf8');
        // Initial profile only contains scalar overrides; take the complete template from this game version.
        if (previous.length < 2000 && previous.startsWith('# SCP Chispi Manager')) await atomicWrite(target, patchConfig(text, configValues(previous)));
      }
    }
    s.configInitialized = true; await this.save();
  }
  async start(id) {
    const s = this.server(id); this.idle(s); if (!s.eula) fail('eulaRequired');
    const exe = path.join(this.game(s), 'LocalAdmin.exe'); if (!exists(exe)) fail('installFirst');
    const v = configValues(await this.readConfig(id, 'config_gameplay.txt'));
    const address = v.ipv4_bind_ip || '0.0.0.0';
    if (address !== '0.0.0.0' && !networkAdapters().some(n => n.address === address)) fail('adapterMissing');
    await freePort(s.port, address);
    await atomicWrite(path.join(this.game(s), 'hoster_policy.txt'), 'gamedir_for_configs: true\n');
    const rt = this.runtime(id); rt.status = 'starting'; rt.players = []; rt.playersAt = null; rt.started = new Date().toISOString();
    const child = spawn(exe, [String(s.port), '--useDefault', '--skipHomeCheck', '--noSetCursor', '--noTerminalTitle', '--noAlign', '--disableTrueColor', '--acceptEULA', '--restartsLimit', '0'], { cwd: this.game(s), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    rt.child = child;
    const buffers = { out: '', err: '' };
    const append = (kind, data) => { buffers[kind] += data.toString(); const parts = buffers[kind].split(/\r?\n/); buffers[kind] = parts.pop(); for (const p of parts) this.log(id, p); if (buffers[kind].length > 16384) { this.log(id, buffers[kind]); buffers[kind] = ''; } };
    child.stdout.on('data', d => append('out', d)); child.stderr.on('data', d => append('err', d));
    child.stdin.on('error', e => this.log(id, e.message));
    child.once('error', e => { this.log(id, e.message); rt.status = 'error'; });
    child.once('close', code => {
      for (const b of Object.values(buffers)) if (b) this.log(id, b);
      const expected = rt.status === 'stopping'; rt.child = null; rt.status = expected || code === 0 ? 'stopped' : 'error'; rt.players = []; rt.playersAt = null; rt.started = null; this.log(id, `LocalAdmin exit: ${code}`); this.emit('changed');
    });
    this.note(id, 'started'); this.emit('changed'); return child.pid;
  }
  command(id, command) {
    assertText(command, 2000); if (/[\r\n\0]/.test(command) || !command.trim()) fail('invalidInput');
    const rt = this.runtime(id); if (!rt.child?.stdin.writable || rt.status === 'stopping') fail('notRunning');
    rt.child.stdin.write(command + '\n'); this.log(id, '> ' + command);
  }
  async stop(id, force = false) {
    const rt = this.runtime(id); if (!rt.child) return;
    const child = rt.child; rt.status = 'stopping'; this.emit('changed');
    if (force) {
      await new Promise((resolve, reject) => { const p = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); p.once('error', reject); p.once('close', code => code === 0 ? resolve() : reject(new ManagerError('stopFailed'))); });
      return;
    }
    const closed = new Promise(resolve => child.once('close', resolve));
    child.stdin.write('exit\n');
    let timer; const result = await Promise.race([closed.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 20000); })]); clearTimeout(timer);
    if (!result && rt.child) { rt.status = 'stopTimeout'; this.emit('changed'); fail('stopTimeout'); }
    this.note(id, 'stopped');
  }
  async refreshPlayers(id) {
    const rt = this.runtime(id); if (!rt.child || rt.status !== 'running') fail('notRunning');
    if (rt.collect) fail('jobBusy');
    rt.collect = { header: false, rows: [], expected: null };
    try {
      this.command(id, 'players');
      // An authoritative response must include its header and the expected row count.
      const started = Date.now();
      while (Date.now() - started < 7000) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (rt.collect.header && rt.collect.rows.length === rt.collect.expected) {
          rt.players = rt.collect.rows; rt.playersAt = new Date().toISOString(); this.emit('changed'); return rt.players;
        }
      }
      fail('playersUnavailable');
    } finally { rt.collect = null; }
  }
  async steamBans(ids, apiKey) {
    if (!apiKey) fail('steamKeyRequired');
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || ids.some(id => !/^\d{17}$/.test(id))) fail('invalidId');
    const url = new URL('https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/');
    url.searchParams.set('key', apiKey); url.searchParams.set('steamids', [...new Set(ids)].join(','));
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) fail('steamFailed', `Steam HTTP ${response.status}`);
      const data = await response.json(); if (!Array.isArray(data.players)) fail('steamFailed');
      return data.players.map(p => ({ steamId: p.SteamId, vacBanned: p.VACBanned, vacBans: p.NumberOfVACBans, gameBans: p.NumberOfGameBans, communityBanned: p.CommunityBanned, daysSinceLastBan: p.DaysSinceLastBan, checkedAt: new Date().toISOString() }));
    } catch (e) { if (e instanceof ManagerError) throw e; fail('steamFailed'); }
  }
  async scheduledBackups() {
    if (!this.state.backupHours) return;
    for (const s of this.state.servers) if (!this.runtime(s.id).child && !this.jobs.has(s.id) && (!s.lastBackup || Date.now() - Date.parse(s.lastBackup) >= this.state.backupHours * 3600000)) {
      try { await this.backup(s.id, 'scheduled'); } catch (e) { this.log(s.id, e.message); }
    }
  }
}
module.exports = { ServerManager, ManagerError, CONFIG_FILES, configValues, patchConfig, assignAdmin, getAdmins, getRoles, parsePlayerLine, networkAdapters, within, freePort };
