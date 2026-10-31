'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Diagnostics, systemInfo } = require('./diagnostics');
const { ServerManager, CONFIG_FILES, getAdmins, getRoles } = require('./core');
const dataArg = process.argv.find(x => x.startsWith('--data-dir='));
if (dataArg) app.setPath('userData', path.resolve(dataArg.slice(11)));
app.setName('SCP Chispi Manager');
const diagnostics = new Diagnostics(path.join(app.getPath('userData'), 'logs'), path.join(app.getPath('temp'), 'SCP-Chispi-Manager-logs'));
const system = systemInfo(app.getVersion());
diagnostics.write('info', 'system', system);
process.on('uncaughtException', error => { diagnostics.write('fatal', 'main.uncaughtException', { error }); app.exit(1); });
process.on('unhandledRejection', error => diagnostics.write('error', 'main.unhandledRejection', { error }));
app.on('child-process-gone', (_, details) => diagnostics.write('error', 'child-process-gone', details));
app.on('before-quit', () => diagnostics.write('info', 'session.quit'));
let win, manager, closing = false;
const serverMutations = new Set(['create', 'preferences', 'removeServer', 'install', 'start', 'stop', 'restart', 'configWrite', 'admin', 'network', 'backup', 'restore']);
const activeOperations = new Map();
let scheduledBackupRunning = false;
const links = {
  eula: 'https://link.scpslgame.com/eula', steamkey: 'https://steamcommunity.com/dev/apikey',
  radmin: 'https://www.radmin-vpn.com/', radminHelp: 'https://www.radmin-vpn.com/help/',
  config: 'https://techwiki.scpslgame.com/books/server-guides/page/2-gameplay-config-setup',
  admin: 'https://techwiki.scpslgame.com/books/server-guides/page/3-remote-admin-config-setup',
  net: 'https://techwiki.scpslgame.com/books/server-guides/page/1-how-to-create-a-dedicated-server',
  dotnet: 'https://dotnet.microsoft.com/en-us/download/dotnet-framework/net48',
  vcredist: 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
};
const API = {
  state: () => manager.snapshot(),
  create: p => manager.create(p),
  removeServer: p => manager.removeServer(p.id, p.mode, target => shell.trashItem(target)),
  install: p => manager.install(p.id),
  start: p => manager.start(p.id),
  stop: p => manager.stop(p.id, Boolean(p.force)),
  restart: async p => { await manager.stop(p.id); return manager.start(p.id); },
  logs: p => { manager.server(p.id); return manager.runtime(p.id).lines; },
  command: p => manager.command(p.id, p.command),
  players: p => manager.refreshPlayers(p.id),
  configRead: p => manager.readConfig(p.id, p.file),
  configWrite: p => manager.writeConfig(p.id, p.file, p.text, p.expected),
  adminInfo: async p => { const raw = await manager.readConfig(p.id, 'config_remoteadmin.txt'); return { members: getAdmins(raw), roles: getRoles(raw), raw }; },
  admin: p => manager.admin(p.id, p.userId, p.role, p.remove),
  network: p => manager.setNetwork(p.id, p.address, p.adapter),
  backups: p => manager.backups(p.id),
  backup: p => manager.backup(p.id),
  restore: p => manager.restore(p.id, p.name),
  preferences: async p => {
    if (Object.hasOwn(p, 'steamKey')) {
      diagnostics.secret(p.steamKey);
      if (p.steamKey && !/^[a-fA-F0-9]{32}$/.test(p.steamKey)) throw Object.assign(new Error(), { code: 'invalidKey' });
      if (p.steamKey && !safeStorage.isEncryptionAvailable()) throw Object.assign(new Error(), { code: 'encryptionUnavailable' });
      p.steamKey = p.steamKey ? safeStorage.encryptString(p.steamKey).toString('base64') : '';
    }
    return manager.setPreferences(p);
  },
  bans: async p => {
    let key = ''; try { if (manager.state.steamKey) key = safeStorage.decryptString(Buffer.from(manager.state.steamKey, 'base64')); } catch { throw Object.assign(new Error(), { code: 'steamKeyRequired' }); }
    return manager.steamBans(p.ids, key);
  },
  chooseFolder: async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: manager.state.library });
    return result.canceled ? null : result.filePaths[0];
  },
  localLibrary: () => path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'SCP Chispi Manager', 'Servers'),
  openFolder: async p => {
    const s = p.id ? manager.server(p.id) : null;
    const target = p.kind === 'backups' && s ? manager.backupDir(s) : p.kind === 'config' && s ? manager.config(s) : s ? s.directory : manager.state.library;
    await fs.promises.mkdir(target, { recursive: true }); const error = await shell.openPath(target); if (error) throw new Error(error);
  },
  openProfile: p => { if (!/^\d{17}$/.test(p.id)) throw Error('invalidId'); return shell.openExternal('https://steamcommunity.com/profiles/' + p.id); },
  link: p => { if (!links[p.key]) throw Error('invalidInput'); return shell.openExternal(links[p.key]); },
  copy: p => { if (typeof p.text !== 'string' || p.text.length > 5000) throw Error('invalidInput'); clipboard.writeText(p.text); },
  exportLogs: async p => {
    const s = manager.server(p.id); const result = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `SCP-${s.port}.log`), filters: [{ name: 'Logs', extensions: ['log','txt'] }] });
    if (!result.canceled) await fs.promises.writeFile(result.filePath, manager.runtime(p.id).lines.map(l => `[${l.time}] ${l.text}`).join('\n'), 'utf8');
  },
  exportDiagnostics: async () => {
    const result = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), 'SCP-Chispi-Diagnostico-' + new Date().toISOString().replace(/[:.]/g, '-') + '.zip'), filters: [{ name: 'Diagnóstico ZIP', extensions: ['zip'] }] });
    if (result.canceled || !result.filePath) return null;
    return diagnostics.exportTo(result.filePath, { system, gpu: gpuInfo, servers: manager.state.servers.map(s => ({ id: s.id, port: s.port, directory: s.directory, eula: s.eula, status: manager.runtime(s.id).status, job: manager.jobs.get(s.id)?.step })), library: manager.state.library, activeOperations: [...activeOperations.entries()] });
  },
  openDiagnostics: async () => { const error = await shell.openPath(diagnostics.directory); if (error) throw new Error(error); },
  window: p => { if (p.action === 'minimize') win.minimize(); else if (p.action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize(); else if (p.action === 'close') win.close(); }
};
let gpuInfo = {};
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    const dataDir = app.getPath('userData');
    manager = new ServerManager(dataDir, path.join(app.getPath('documents'), 'SCP Chispi Servers'));
    manager.on('diagnostic', entry => { diagnostics.write(entry.error ? 'error' : 'info', 'create.stage', entry); if (win && !win.isDestroyed()) win.webContents.send('manager-create-stage', entry.stage); });
    diagnostics.write('info', 'manager.init.start', { dataDir });
    await manager.init(); diagnostics.secret(manager.state.steamKey);
    diagnostics.write('info', 'manager.init.complete');
    app.getGPUInfo('basic').then(info => { gpuInfo = { basic: info, features: app.getGPUFeatureStatus() }; diagnostics.write('info', 'gpu', gpuInfo); }).catch(error => diagnostics.write('warn', 'gpu.failed', { error }));
    win = new BrowserWindow({ title: 'SCP Chispi Manager', width: 1440, height: 960, minWidth: 1080, minHeight: 740, backgroundColor: '#0d0b14', frame: false, show: false, icon: path.join(__dirname, '../assets/icon.ico'), webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', e => e.preventDefault());
    win.on('unresponsive', () => diagnostics.write('error', 'window.unresponsive'));
    win.on('responsive', () => diagnostics.write('info', 'window.responsive'));
    win.webContents.on('render-process-gone', (_, details) => diagnostics.write('fatal', 'renderer.gone', details));
    win.webContents.on('preload-error', (_, preloadPath, error) => diagnostics.write('error', 'preload.failed', { preloadPath, error }));
    win.webContents.on('did-fail-load', (_, code, description, url) => diagnostics.write('error', 'load.failed', { code, description, url }));
    ipcMain.on('diagnostic', (event, entry) => {
      if (event.sender !== win.webContents || !entry || !['ui.error','ui.unhandledRejection','ui.action','ui.slow','ui.ready'].includes(entry.event)) return;
      diagnostics.write(entry.event.includes('error') || entry.event.includes('Rejection') ? 'error' : 'info', entry.event, { message: String(entry.message || '').slice(0, 4000), stack: String(entry.stack || '').slice(0, 8000), view: String(entry.view || '').slice(0, 80), step: entry.step });
    });
    ipcMain.handle('manager', async (event, method, payload = {}) => {
      if (event.sender !== win.webContents || !Object.hasOwn(API, method)) return { ok: false, error: 'invalidInput' };
      const mutation = serverMutations.has(method);
      if (mutation && (scheduledBackupRunning || activeOperations.has(payload.id))) return { ok: false, error: 'jobBusy' };
      if (mutation) activeOperations.set(payload.id, method);
      const tracked = !['state','logs','window'].includes(method), operation = tracked ? diagnostics.begin(method, payload.id) : null;
      const watchdog = operation ? setTimeout(() => diagnostics.slow(operation), 15000) : null;
      try { const value = await API[method](payload); if (operation) diagnostics.end(operation); return { ok: true, value }; }
      catch (e) { if (operation) diagnostics.end(operation, e); else diagnostics.write('error', 'request.failed', { method, error: e }); return { ok: false, error: e.code || 'unexpected', detail: e.code ? e.message : String(e.message).slice(0, 400) }; }
      finally { clearTimeout(watchdog); if (mutation) activeOperations.delete(payload.id); }
    });
    manager.on('changed', () => { if (!win.isDestroyed()) win.webContents.send('manager-changed'); });
    manager.on('log', entry => { if (!entry.line.text.startsWith('>')) diagnostics.write('info', 'server.output', entry); if (!win.isDestroyed()) win.webContents.send('manager-log', entry); });
    win.on('close', async e => {
      const active = manager.state.servers.filter(s => manager.runtime(s.id).child);
      if (manager.steamBusy || manager.deleting.size || activeOperations.size || scheduledBackupRunning) { e.preventDefault(); win.webContents.send('manager-busy'); return; }
      if (active.length && !closing) {
        e.preventDefault();
        const lang = manager.state.language;
        const messages = {
          es: ['Hay servidores en ejecución. ¿Detenerlos y cerrar?', 'Detener y cerrar', 'Cancelar'],
          en: ['Servers are running. Stop them and close?', 'Stop and close', 'Cancel'],
          ru: ['Серверы запущены. Остановить и закрыть?', 'Остановить и закрыть', 'Отмена'],
          zh: ['服务器正在运行。停止并关闭？', '停止并关闭', '取消'],
          ja: ['サーバーが稼働中です。停止して閉じますか？', '停止して閉じる', 'キャンセル'],
          pt: ['Há servidores em execução. Parar e fechar?', 'Parar e fechar', 'Cancelar']
        }[lang];
        const choice = await dialog.showMessageBox(win, { type: 'question', message: messages[0], buttons: messages.slice(1), defaultId: 1, cancelId: 1 });
        if (choice.response === 0) {
          try { await Promise.all(active.map(s => manager.stop(s.id))); closing = true; app.quit(); }
          catch { win.webContents.send('manager-stop-failed'); }
        }
      }
    });
    await win.loadFile(path.join(__dirname, 'index.html'));
    win.show();
    const timer = setInterval(async () => {
      if (activeOperations.size || scheduledBackupRunning) return;
      scheduledBackupRunning = true;
      try { await manager.scheduledBackups(); } catch (error) { diagnostics.write('error', 'scheduledBackup.failed', { error }); } finally { scheduledBackupRunning = false; }
    }, 60000); timer.unref();
  }).catch(async e => { diagnostics.write('fatal', 'startup.failed', { error: e }); dialog.showErrorBox('SCP Chispi Manager', String(e.message) + '\n\nLogs: ' + diagnostics.directory); app.quit(); });
  app.on('window-all-closed', () => app.quit());
}
