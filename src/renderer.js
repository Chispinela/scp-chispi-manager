'use strict';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state, view = 'overview', selected = null, tab = 'overview', renderVersion = 0;
let configFile = 'config_gameplay.txt', configMode = 'form', configOriginal = '', configDraft = '', dirty = false;
let logs = [], logFilter = '', bans = new Map(), playerBusy = false, modalResolve = null, wizard = null;
let pendingDeletion = null, deletionInProgress = false;
let creationInProgress = false, creationSlow = false;
function report(event, message, stack = '') { window.chispi.report({ event, message, stack, view, step: wizard?.step }); }
window.addEventListener('error', e => report('ui.error', e.message, e.error?.stack));
window.addEventListener('unhandledrejection', e => report('ui.unhandledRejection', e.reason?.message || e.reason?.detail || String(e.reason), e.reason?.stack));
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M12 6.5h5M12 17.5h5"/>',
  settings: '<path d="m9 3-.5 3-2 1L4 6l-2 4 2.5 2v2L2 16l2 4 3-1 2 1 .5 2h5l.5-2 2-1 3 1 2-4-2.5-2v-2L22 10l-2-4-3 1-2-1-.5-3Z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="m8 4 13 8L8 20Z"/>', stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 13-2l2 3M4 16l2 3a8 8 0 0 0 13-2"/>',
  players: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 5"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  console: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m6 9 4 3-4 3M13 16h5"/>',
  network: '<rect x="8" y="2" width="8" height="6" rx="1"/><path d="M12 8v6M4 14h16M4 14v3M12 14v3M20 14v3"/><rect x="1" y="17" width="6" height="5" rx="1"/><rect x="9" y="17" width="6" height="5" rx="1"/><rect x="17" y="17" width="6" height="5" rx="1"/>',
  backup: '<path d="M4 10V5h16v5M5 10H3v11h18V10h-2M9 14h6M8 5V2h8v3"/>',
  folder: '<path d="M3 6V4h6l2 3h10v13H3Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M3 16v5h18v-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  key: '<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-4-4 3-3m-6 0 3-3"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.server}</svg>`;
function t(key, params = {}) {
  const idx = I18N.LANGS.indexOf(state?.language || 'es');
  let value = I18N.COPY[key]?.[idx] || I18N.COPY[key]?.[0] || key;
  for (const [k,v] of Object.entries(params)) value = value.replaceAll('{' + k + '}', String(v));
  return value;
}
function errorText(error) { return I18N.ERRORS[error.code]?.[I18N.LANGS.indexOf(state?.language || 'es')] || t('error') + ': ' + (error.detail || error.message || error.code); }
async function rpc(method, payload = {}) {
  const result = await window.chispi.call(method, payload);
  if (!result.ok) throw { code: result.error, detail: result.detail };
  return result.value;
}
function toast(message, bad = false, detail = '') {
  const el = document.createElement('div'); el.className = 'toast' + (bad ? ' bad' : '');
  el.innerHTML = esc(message) + (detail && bad ? `<small>${esc(detail)}</small>` : '');
  $('#toasts').append(el); setTimeout(() => el.remove(), bad ? 12000 : 4500);
}
const handleError = e => { report('ui.error', errorText(e), e.stack); toast(errorText(e), true, I18N.ERRORS[e.code] ? '' : e.detail); };
const current = () => state.servers.find(s => s.id === selected);
const active = s => Boolean(s?.pid);
const busy = s => Boolean(s?.job || s?.pid);
const fmtDate = value => value ? new Date(value).toLocaleString(({es:'es-ES',en:'en-GB',ru:'ru-RU',zh:'zh-CN',ja:'ja-JP',pt:'pt-PT'})[state.language], { dateStyle: 'short', timeStyle:'short' }) : t('notYet');
const statusKey = s => s.job ? 'installing' : !s.installed ? 'notInstalled' : s.status;
const badge = s => `<span class="badge ${esc(statusKey(s))}"><span class="status-dot ${s.status==='running'?'green':s.pid||s.job?'amber':''}"></span>${t(statusKey(s))}</span>`;
const button = (label, action, ico, kind = '', extra = '') => `<button class="button ${kind}" data-action="${action}" ${extra}>${ico?icon(ico):''}${t(label)}</button>`;
function heading(title, subtitle, right = '') { return `<div class="page-heading"><div><div class="eyebrow">${t('commandCenter')}</div><h1>${t(title)}</h1><p>${t(subtitle)}</p></div>${right}</div>`; }
function notice(text, info = false) { return `<div class="notice ${info?'info':''}">${icon('info')}<div>${t(text)}</div></div>`; }
const address = s => `${s.bindIp === '0.0.0.0' ? (state.adapters.find(a => !a.internal && !a.vpn && !a.virtual)?.address || state.adapters.find(a=>!a.internal)?.address || '127.0.0.1') : s.bindIp}:${s.port}`;
function stat(label, value, ico, foot = '', isText = false) { return `<div class="stat-card"><div class="stat-label">${t(label)}${icon(ico)}</div><div class="stat-value ${isText?'text':''}">${esc(value)}</div>${foot?`<div class="stat-foot">${esc(foot)}</div>`:''}</div>`; }
function updateChrome() {
  document.documentElement.lang = state.language; $('#language').value = state.language;
  $$('[data-i18n]').forEach(el => el.textContent = t(el.dataset.i18n));
  if($('#loading-text'))$('#loading-text').textContent = t('loading');
  $('#main-nav').innerHTML = [['overview','grid'],['allServers','server'],['preferences','settings']].map(([key,ico]) => `<button class="nav-button ${view===key?'active':''}" data-nav="${key}">${icon(ico)}<span>${t(key)}</span>${key==='allServers'?`<span class="nav-count">${state.servers.length}</span>`:''}</button>`).join('');
  $('#server-list').innerHTML = state.servers.map(s => `<button class="server-side ${view==='server'&&selected===s.id?'active':''}" data-server="${s.id}"><span class="status-dot ${s.status==='running'?'green':s.pid||s.job?'amber':''}"></span><span>${esc(s.name)}</span><small>${s.port}</small></button>`).join('');
  $('#breadcrumb').textContent = view === 'server' ? current()?.name || '' : t(view);
}
function serverCards() {
  return `<div class="server-grid">${state.servers.map(s => `<article class="server-card"><div class="server-card-top"><div class="server-symbol">${icon('server')}</div>${badge(s)}</div><h3>${esc(s.name)}</h3><p>${esc(address(s))}</p><div class="server-card-bottom"><small>${s.playersAt?s.players.length:'—'} ${t('players').toLowerCase()}</small><div class="inline-buttons"><button class="button small ghost" data-server="${s.id}">${t('manageServers')}${icon('arrow')}</button><button class="button small danger" data-remove-server="${s.id}" aria-label="${t('deleteServer')}: ${esc(s.name)}" title="${t(busy(s)?'deleteStopFirst':'deleteServer')}" ${busy(s)?'disabled':''}>${icon('trash')}</button></div></div></article>`).join('')}</div>`;
}
function emptyServers() { return `<div class="empty-state"><div class="empty-icon">${icon('server')}</div><div><h3>${t('noServers')}</h3><p>${t('noServersSub')}</p></div>${button('newServer','new','plus','ghost')}</div>`; }
function renderDashboard() {
  const latest = state.servers.map(s=>s.lastBackup).filter(Boolean).sort().at(-1);
  const countsKnown = state.servers.filter(s=>s.pid).every(s=>s.playersAt && Date.now()-Date.parse(s.playersAt)<30000);
  return heading('welcome','dashboardSub',button('newServer','new','plus','primary')) +
    `<div class="stats-grid">${stat('totalServers',state.servers.length,'server','SCP: Secret Laboratory')}${stat('onlineServers',state.servers.filter(s=>s.status==='running').length,'play','LocalAdmin')}${stat('connectedPlayers',countsKnown?state.servers.reduce((a,s)=>a+(s.pid?s.players.length:0),0):'—','players',countsKnown?'':t('unknown'))}${stat('lastBackup',latest?fmtDate(latest):t('notYet'),'backup','ZIP · AppData · Plugins',true)}</div>` +
    `<div class="hero"><div class="hero-copy"><div class="eyebrow">SCP: SECRET LABORATORY</div><h2>${t('heroTitle')}</h2><p>${t('heroSub')}</p>${button(state.servers.length?'manageServers':'newServer',state.servers.length?'all':'new',state.servers.length?'arrow':'plus','primary')}</div><img src="../assets/logo.png" alt="SCP Chispi Manager"></div>` +
    `<div class="section-heading"><h2>${t('myServers')} <small>(${state.servers.length})</small></h2><small>LOCAL · MULTI-SERVER</small></div>${state.servers.length?serverCards():emptyServers()}` +
    `<div class="bottom-grid"><div class="panel"><h2>${t('activity')}</h2>${state.activity.length?state.activity.slice(0,4).map(a=>`<div class="activity-row">${icon(a.key.includes('backup')?'backup':'check')}<div>${t(a.key)}<small>${esc(state.servers.find(s=>s.id===a.id)?.name||'')}</small></div><time>${new Date(a.time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time></div>`).join(''):`<div class="activity-empty">${icon('clock')}${t('noActivity')}</div>`}</div><div class="panel"><h2>${t('quickGuide')}</h2>${[['guideInstall','guideInstallSub'],['guideAdmin','guideAdminSub'],['guideNetwork','guideNetworkSub']].map(([a,b],i)=>`<div class="guide-row"><span>0${i+1}</span><div><h3>${t(a)}</h3><p>${t(b)}</p></div></div>`).join('')}</div></div>`;
}
function progress(s) {
  const job = s.job, known = Number.isFinite(job?.percent);
  const percent = known ? Math.min(100, Math.max(0, job.percent)) : null;
  const format = n => new Intl.NumberFormat(state.language, { maximumFractionDigits: 1 }).format(n) + '%';
  return `<div class="progress-panel"><div class="progress-title"><strong>${t('installing')} · ${job?.phase==='steamcmd'?'SteamCMD':'SCP: Secret Laboratory'}</strong><span class="install-step">${t(job?.step || 'connectingSteam')}</span></div><div class="install-percentages"><div><span class="install-completed" data-progress="${percent??''}">${known?format(percent):'—'}</span><small>${t('phaseCompleted')}</small></div><div><span class="install-remaining">${known?format(Math.round((100-percent)*10)/10):'—'}</span><small>${t('phaseRemaining')}</small></div>${!known?`<p>${t('calculatingProgress')}</p>`:''}</div><div class="progress-track ${known?'':'indeterminate'}" role="progressbar" aria-label="${t('phaseCompleted')}" aria-valuemin="0" aria-valuemax="100" ${known?`aria-valuenow="${percent}"`:''}><span style="width:${known?percent:35}%"></span></div><small>${t('phaseProgressNote')}</small>${job?.detail?`<div class="install-detail">${esc(job.detail)}</div>`:''}${tab!=='console'?`<div class="install-output-title">${t('liveSteamOutput')}</div><pre class="install-output">${esc((job?.lines||[]).map(l=>l.text).join('\n'))}</pre>${button('console','go-console','console','small ghost')}`:''}</div>`;
}
function serverTop(s) {
  const tabs = [['overview','grid'],['settings','settings'],['admin','shield'],['players','players'],['console','console'],['network','network'],['backups','backup']];
  return `<div class="page-heading"><div><div class="eyebrow">SCP: SECRET LABORATORY · ${s.port}/UDP</div><div class="server-top-title"><h1>${esc(s.name)}</h1>${badge(s)}</div></div><div class="server-actions">${active(s)?button('stop','stop','stop','ghost',s.status==='stopping'?'disabled':'')+button('restart','restart','refresh','ghost',s.status==='stopping'?'disabled':''):button(s.installed?'start':'install',s.installed?'start':'install',s.installed?'play':'download','primary',s.job?'disabled':'')}${button('openFolder','folder','folder','ghost')}${button('deleteServer','delete-server','trash','danger',busy(s)?'disabled title="'+esc(t('deleteStopFirst'))+'"':'title="'+t('deleteServer')+'"')}</div></div><div class="tabs">${tabs.map(([key,ico])=>`<button class="tab ${tab===key?'active':''}" data-tab="${key}">${icon(ico)}${t(key)}</button>`).join('')}</div><div id="job-progress">${s.job?progress(s):''}</div><div id="server-view"></div>`;
}
function serverOverview(s) {
  const elapsed = s.started ? Math.max(0,Math.floor((Date.now()-Date.parse(s.started))/60000)) + ' min' : '—';
  return `<div class="stats-grid">${stat('port',s.port,'network','UDP')}${stat('connectedPlayers',s.playersAt?s.players.length:'—','players',s.playersAt?fmtDate(s.playersAt):t('unknown'))}${stat('uptime',elapsed,'clock')}${stat('process',s.pid||'—','server','LocalAdmin PID')}</div><div class="connection-card"><div class="empty-icon">${icon('network')}</div><div><div class="eyebrow">${t('connection')}</div><div class="address">${esc(address(s))}</div><p>${t(s.pid?'autoIpNote':'offlineNote')}</p></div>${button('copy','copy-address','copy','ghost')}</div><div class="info-grid"><div class="panel"><h2>${t('installation')}</h2><p class="caption">${t('installNote')}</p><div class="field"><label>${t('serverFiles')}</label><small class="mono">${esc(s.directory)}</small></div><p class="caption">${t('firstStart')}</p><div class="inline-buttons">${button(s.installed?'update':'install','install','download','ghost',busy(s)?'disabled':'')}${button('console','go-console','console','ghost')}${s.pid?button('forceStop','force-stop','stop','danger'):''}</div></div><div class="panel"><h2>${t('requirements')}</h2><p class="caption">${t('requirementsSub')}</p><div class="link-row"><button class="text-button" data-link="dotnet">.NET Framework 4.8 ${icon('external')}</button><button class="text-button" data-link="vcredist">Visual C++ x64 ${icon('external')}</button></div></div></div>`;
}
function parseConfig(raw) { return raw.split(/\r?\n/).map(l=>l.match(/^([\w]+):(?: |$)(.*)$/)).filter(Boolean).map(m=>({key:m[1],value:m[2]})); }
function setConfigValue(raw,key,value) { const lines=raw.split('\n');const index=lines.findIndex(l=>l.startsWith(key+':')); if(index>=0) lines[index]=key+': '+String(value).replace(/[\r\n]/g,' ');return lines.join('\n'); }
const FRIENDLY_CONFIG = {server_name:'name',max_players:'maxPlayers',server_tickrate:'tickrate',friendly_fire:'friendlyFire',server_ip:'publicIp',ipv4_bind_ip:'bindIp',online_mode:'onlineAuth',enable_whitelist:'whitelist',forward_ports:'upnp',lobby_waiting_time:'lobbyWait',afk_time:'afkTime',warhead_tminus_start_duration:'warheadTime',intercom_cooldown:'intercomCooldown',intercom_max_speech_time:'intercomSpeech',spawn_protect_enabled:'spawnProtection',disable_decontamination:'disableDecon',auto_round_restart_time:'roundRestart'};
function configControls(search='') {
  const values = parseConfig(configDraft).filter(p=>p.value!==''&&p.key.toLowerCase().includes(search.toLowerCase()));
  if(!values.length) return `<p class="caption">${t(configDraft?'noMatches':'missingConfig')}</p>`;
  return `<div class="config-fields">${values.map(p=>`<div class="config-field"><label for="cfg-${p.key}">${esc(FRIENDLY_CONFIG[p.key]?t(FRIENDLY_CONFIG[p.key]):p.key.replace(/_/g,' '))}<br><small class="mono">${esc(p.key)}</small></label><input id="cfg-${p.key}" data-config-key="${p.key}" ${/^(true|false)$/.test(p.value)?`type="checkbox" ${p.value==='true'?'checked':''}`:`type="text" value="${esc(p.value)}"`} ${busy(current())?'disabled':''}></div>`).join('')}</div>`;
}
function renderConfig(s, raw) {
  configOriginal=raw;configDraft=raw;dirty=false;
  return `<div class="section-heading"><div><h2>${t('settings')}</h2><p class="caption">${t('configSub')}</p></div><button class="text-button" data-link="config">${t('docs')}${icon('external')}</button></div>${busy(s)?notice('stopToEdit'):''}<div class="toolbar"><select id="config-file" aria-label="${t('serverFiles')}">${['config_gameplay.txt','config_remoteadmin.txt','config_localadmin.txt','config_sharing.txt','UserIDBans.txt','IPBans.txt','UserIDWhitelist.txt','UserIDReservedSlots.txt'].map(f=>`<option ${f===configFile?'selected':''}>${f}</option>`).join('')}</select><div class="toolbar-group"><input id="config-search" placeholder="${t('searchSettings')}" ${configMode==='raw'?'hidden':''}><div class="segmented"><button data-config-mode="form" class="${configMode==='form'?'active':''}">${t('form')}</button><button data-config-mode="raw" class="${configMode==='raw'?'active':''}">${t('raw')}</button></div></div></div><div class="panel"><div id="config-editor">${configMode==='raw'?`<textarea id="config-raw" class="code-editor" spellcheck="false" ${busy(s)?'disabled':''}>${esc(raw)}</textarea>`:configControls()}</div><div class="save-row"><p>${t('rawHelp')}</p>${button('save','save-config','check','primary',busy(s)?'disabled':'')}</div></div>`;
}
function renderAdmins(s, info) {
  return `<div class="section-heading"><div><h2>${t('admin')}</h2><p class="caption">${t('adminSub')}</p></div><button class="text-button" data-link="admin">${t('docs')}${icon('external')}</button></div>${busy(s)?notice('stopToEdit'):''}${!info.roles.length?notice('firstStart',true):''}<div class="panel"><h2>${t('makeAdmin')}</h2><form id="admin-form" class="admin-form"><div class="field"><label for="admin-id">${t('userId')}</label><input id="admin-id" placeholder="7656119••••••••••" required maxlength="32" ${busy(s)||!info.roles.length?'disabled':''}></div><div class="field"><label for="admin-role">${t('role')}</label><select id="admin-role" ${busy(s)?'disabled':''}>${info.roles.map(r=>`<option ${r==='owner'?'selected':''}>${esc(r)}</option>`).join('')}</select></div><button class="button primary" ${busy(s)||!info.roles.length?'disabled':''}>${icon('shield')}${t('makeAdmin')}</button></form><p class="caption">${t('adminHint')}</p></div><div class="spacer"></div><div class="section-heading"><h2>${t('members')}</h2></div><div class="table-wrap"><table><thead><tr><th>${t('userId')}</th><th>${t('role')}</th><th></th></tr></thead><tbody>${info.members.length?info.members.map(m=>`<tr><td><code>${esc(m.userId)}</code></td><td><span class="badge">${esc(m.role)}</span></td><td><button class="button small ghost" data-remove-admin="${esc(m.userId)}" ${busy(s)?'disabled':''}>${t('remove')}</button></td></tr>`).join(''):`<tr><td colspan="3" class="empty-cell">${t('noAdmins')}</td></tr>`}</tbody></table></div>`;
}
function vacBadge(b) { return b?`<span class="badge ${b.vacBanned?'error':'running'}">${b.vacBanned?`${t('vacBan')}: ${b.vacBans}`:t('vacClear')}</span>`:`<span class="muted">${t('unknown')}</span>`; }
function renderPlayers(s) {
  return `<div class="section-heading"><div><h2>${t('connectedPlayers')}</h2><p class="caption">${t('playersSub')}</p></div><div class="inline-buttons">${button('vacCheck','vac-all','shield','ghost',!s.players.some(p=>p.steamId)?'disabled':'')}${button('refreshPlayers','refresh-players','refresh','primary',s.status!=='running'||playerBusy?'disabled':'')}</div></div>${notice('vacNote',true)}<div class="inline-meta">${t('checkedAt')}: ${s.playersAt?fmtDate(s.playersAt):t('unknown')}</div><div class="table-wrap"><table><thead><tr><th>${t('playerName')}</th><th>${t('userId')}</th><th>VAC</th><th>${t('gameBans')}</th><th></th></tr></thead><tbody>${s.playersAt?(s.players.length?s.players.map(p=>`<tr><td>${esc(p.name)}${p.playerId?` <small>#${esc(p.playerId)}</small>`:''}</td><td><code>${esc(p.userId)}</code></td><td>${vacBadge(bans.get(p.steamId))}</td><td>${bans.has(p.steamId)?bans.get(p.steamId).gameBans:'—'}</td><td>${p.steamId?`<button class="button small ghost" data-profile="${esc(p.steamId)}">${t('profile')}${icon('external')}</button>`:''}</td></tr>`).join(''):`<tr><td class="empty-cell" colspan="5">${t('emptyPlayers')}</td></tr>`):`<tr><td class="empty-cell" colspan="5"><h3>${t('noPlayers')}</h3><p>${t('noPlayersSub')}</p></td></tr>`}</tbody></table></div><div class="spacer"></div><div class="panel"><h2>${t('manualLookup')}</h2><form id="lookup-form" class="lookup-row"><input id="lookup-id" placeholder="SteamID64" pattern="[0-9]{17}" required maxlength="17" aria-label="SteamID64"><button class="button ghost">${icon('shield')}${t('vacCheck')}</button></form><div id="lookup-result"></div></div>`;
}
function renderConsole(s) {
  return `<div class="section-heading"><div><h2>${t('console')}</h2><p class="caption">${t(s.job?'liveSteamOutput':'consoleSub')}</p></div>${button('export','export-log','download','ghost')}</div><div class="toolbar"><input id="log-filter" placeholder="${t('filter')}" value="${esc(logFilter)}"><div class="inline-buttons">${button('refreshPlayers','console-players','players','ghost',!s.pid?'disabled':'')}${s.pid?button('forceStop','force-stop','stop','danger'):''}</div></div><div class="console-box"><div class="console-title"><span class="status-dot ${s.pid?'green':''}"></span>${s.job?'STEAMCMD':'LOCALADMIN'} · ${s.port}/UDP · ${s.pid?'PID '+s.pid:'—'}</div><div id="console-output" class="console-body" role="log"></div><form id="console-form" class="console-input"><span>❯</span><input id="command" placeholder="${t('commandPlaceholder')}" autocomplete="off" ${!s.pid?'disabled':''}><button class="button primary" ${!s.pid?'disabled':''}>${t('send')}${icon('arrow')}</button></form></div>`;
}
function updateLogs() {
  const output = $('#console-output'); if(!output)return;
  const atBottom=output.scrollHeight-output.scrollTop-output.clientHeight<70;
  const filtered=logs.filter(l=>l.text.toLowerCase().includes(logFilter.toLowerCase()));
  output.innerHTML=filtered.length?filtered.slice(-1000).map(l=>`<div class="${/error|exception|failed/i.test(l.text)?'log-error':l.text.startsWith('>')?'log-command':''}"><span class="log-time">${new Date(l.time).toLocaleTimeString([], {hour12:false})}</span>  ${esc(l.text)}</div>`).join(''):`<span class="muted">${t('noLogs')}</span>`;
  if(atBottom)output.scrollTop=output.scrollHeight;
}
function renderNetwork(s) {
  const options=[{name:t('allAdapters'),address:'0.0.0.0',description:t('allAdaptersSub'),adapter:''},...state.adapters.map(a=>({...a,description:a.address+(a.internal?' · '+t('loopback'):''),adapter:a.name}))];
  return `<div class="section-heading"><div><h2>${t('network')}</h2><p class="caption">${t('networkSub')}</p></div>${button('refresh','refresh-network','refresh','ghost')}</div>${busy(s)?notice('stopToEdit'):''}<div class="info-grid"><div class="panel"><h2>${t('adapters')}</h2><div class="spacer"></div>${options.map((a,i)=>`<label class="network-option"><input type="radio" name="adapter" value="${esc(a.address)}" data-name="${esc(a.adapter)}" ${s.bindIp===a.address?'checked':''} ${busy(s)?'disabled':''}><div><strong>${esc(a.name)}</strong><small>${esc(a.description)}</small></div>${a.vpn?'<span class="badge running">VPN</span>':''}</label>`).join('')}<div class="save-row">${button('applyNetwork','apply-network','check','primary',busy(s)?'disabled':'')}</div><p class="caption">${t('publicNote')}</p></div><div><div class="panel radmin-panel"><div class="empty-icon">${icon('network')}</div><div class="spacer"></div><h2>${t('radminTitle')}</h2><p>${t('radminNote')}</p><div class="link-row"><button class="button ghost small" data-link="radmin">${icon('download')}${t('radminDownload')}</button><button class="text-button" data-link="radminHelp">${t('help')}${icon('external')}</button></div></div>${!state.adapters.some(a=>a.radmin)?`<div class="spacer"></div>${notice('radminMissing',true)}`:''}<div class="connection-card" style="margin-top:20px;display:block"><div class="eyebrow">${t('connection')}</div><div class="address" style="font-size:20px">${esc(address(s))}</div>${button('copy','copy-address','copy','small ghost')}</div></div></div>`;
}
function renderBackups(s, entries) {
  return `<div class="section-heading"><div><h2>${t('backups')}</h2><p class="caption">${t('backupSub')}</p></div><div class="inline-buttons">${button('openFolder','backup-folder','folder','ghost')}${button('createBackup','backup','backup','primary',busy(s)?'disabled':'')}</div></div>${notice('backupNote',true)}<div class="panel">${entries.length?entries.map(e=>`<div class="backup-entry">${icon('backup')}<div><strong>${esc(e.name)}</strong><small>${(e.size/1024/1024).toFixed(2)} MB · ZIP</small></div><button class="button ghost small" data-restore="${esc(e.name)}" ${busy(s)?'disabled':''}>${icon('refresh')}${t('restore')}</button></div>`).join(''):`<div class="activity-empty">${icon('backup')}${t('noBackups')}</div>`}</div><p class="caption">${t('backupScheduleNote')}</p>`;
}
function windowsPanel() {
  const system=state.windows;
  return `<div class="panel windows-compatibility"><h2>${t('windowsCompatibility')}</h2><p>${t('windowsTarget')}</p>${system?`<div class="caption">${t('detectedWindows')}: <strong>${esc(system.name)} · ${esc(system.arch)}</strong> <span class="mono">(${esc(system.release)})</span></div>`:''}</div>`;
}
function diagnosticsPanel() { return '<div class="panel diagnostics-panel"><h2>'+t('diagnosticsTitle')+'</h2><p class="caption">'+t('diagnosticsNote')+'</p><div class="inline-buttons">'+button('exportDiagnostics','export-diagnostics','download','primary')+button('openDiagnostics','open-diagnostics','folder','ghost')+'</div></div>'; }
function renderPreferences() {
  return heading('preferences','settingsSub')+diagnosticsPanel()+windowsPanel()+`<div class="preferences-grid"><div><div class="panel"><h2>${t('folder')}</h2><p class="caption">${t('libraryChangeNote')}</p><div class="input-with-button"><input id="pref-library" value="${esc(state.library)}" readonly><button class="button ghost" data-action="pref-folder">${icon('folder')}</button></div><div class="save-row">${button('save','save-library','check','primary')}</div></div><div class="spacer"></div><div class="panel"><h2>${t('automaticBackups')}</h2><p class="caption">${t('backupScheduleNote')}</p><div class="field"><label for="backup-hours">${t('automaticBackups')}</label><select id="backup-hours">${[0,1,6,12,24].map(n=>`<option value="${n}" ${state.backupHours===n?'selected':''}>${n?t('everyHours',{n}):t('disabled')}</option>`).join('')}</select></div><div class="field"><label for="retention">${t('retention')}</label><input id="retention" type="number" min="1" max="100" value="${state.retention}"></div>${button('save','save-backup-prefs','check','primary')}</div></div><div class="panel"><div class="empty-icon">${icon('key')}</div><div class="spacer"></div><h2>${t('steamKey')}</h2><p class="caption">${t('keyNote')}</p><div class="notice info">${icon('shield')}${t(state.hasSteamKey?'keyStored':'keyMissing')}</div><div class="field"><label for="steam-key">${t('steamKey')}</label><input id="steam-key" type="password" maxlength="32" autocomplete="off" placeholder="••••••••••••••••••••••••••••••••"></div><div class="inline-buttons">${button('saveKey','save-key','check','primary')}${state.hasSteamKey?button('deleteKey','delete-key',null,'ghost'):''}</div><div class="spacer"></div><button class="text-button" data-link="steamkey">${t('getKey')}${icon('external')}</button><p class="caption">${t('vacNote')}</p></div></div>`;
}
async function render() {
  const version=++renderVersion;updateChrome();
  const content=$('#content');
  if(view==='overview')content.innerHTML=renderDashboard();
  else if(view==='allServers')content.innerHTML=heading('myServers','multiServer',button('newServer','new','plus','primary'))+(state.servers.length?serverCards():emptyServers());
  else if(view==='preferences')content.innerHTML=renderPreferences();
  else if(view==='server') {
    const s=current();if(!s){view='allServers';return render();}
    content.innerHTML=serverTop(s);const body=$('#server-view');
    if(tab==='overview')body.innerHTML=serverOverview(s);
    else if(tab==='players')body.innerHTML=renderPlayers(s);
    else if(tab==='network')body.innerHTML=renderNetwork(s);
    else {
      body.innerHTML=`<p class="caption">${t('working')}</p>`;
      try {
        if(tab==='settings'){const raw=await rpc('configRead',{id:s.id,file:configFile});if(version===renderVersion)body.innerHTML=renderConfig(s,raw);}
        else if(tab==='admin'){const info=await rpc('adminInfo',{id:s.id});if(version===renderVersion)body.innerHTML=renderAdmins(s,info);}
        else if(tab==='backups'){const entries=await rpc('backups',{id:s.id});if(version===renderVersion)body.innerHTML=renderBackups(s,entries);}
        else if(tab==='console'){logs=await rpc('logs',{id:s.id});if(version===renderVersion){body.innerHTML=renderConsole(s);updateLogs();}}
      }catch(e){if(version===renderVersion)body.innerHTML=notice('error');handleError(e);}
    }
  }
}
async function sync(rerender=true) { state=await rpc('state');if(rerender)await render();else updateChrome(); }
function modalClose(value=false) { if(deletionInProgress||creationInProgress)return; $('#modal-root').innerHTML=''; if(modalResolve){modalResolve(value);modalResolve=null;} wizard=null; pendingDeletion=null; }
function deleteDialog(id) {
  const s=state.servers.find(server=>server.id===id);if(!s)return;
  if(busy(s))return toast(t('deleteStopFirst'),true);
  pendingDeletion=id;
  $('#modal-root').innerHTML=`<div class="modal-overlay"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><div class="modal-header"><div><h2 id="delete-title">${t('deleteServer')}</h2><p>${esc(t('deleteServerPrompt',{name:s.name}))}</p></div><button class="icon-button" data-action="modal-cancel" aria-label="${t('cancel')}">×</button></div><div class="modal-body"><label class="network-option"><input type="radio" name="delete-mode" value="keep" checked><div><strong>${t('keepServerFiles')}</strong><p>${t('keepServerFilesNote')}</p></div></label><label class="network-option"><input type="radio" name="delete-mode" value="trash"><div><strong>${t('deleteServerFiles')}</strong><p>${t('deleteServerFilesNote')}</p></div></label><div class="field delete-directory"><label>${t('folder')}</label><small class="mono">${esc(s.directory)}</small></div></div><div class="modal-footer">${button('cancel','modal-cancel',null,'ghost')}${button('deleteServer','confirm-delete-server','trash','danger')}</div></div></div>`;
  $('[data-action="modal-cancel"]',$('#modal-root')).focus();
}
function confirmDialog(message) {
  return new Promise(resolve=>{modalResolve=resolve;$('#modal-root').innerHTML=`<div class="modal-overlay"><div class="modal" role="dialog" aria-modal="true"><div class="modal-header"><h2>${t('notice')}</h2></div><div class="modal-body"><p>${t(message)}</p></div><div class="modal-footer">${button('cancel','modal-cancel',null,'ghost')}${button('confirm','modal-confirm','check','primary')}</div></div></div>`;});
}
async function navigate(nextView, id=null, nextTab='overview') {
  if(dirty&&!await confirmDialog('pendingChanges'))return;
  dirty=false;view=nextView;selected=id;tab=nextTab;await render();
  if(view==='server'&&tab==='players'&&current()?.status==='running')refreshPlayers(false);
}
function wizardOpen() {
  if(creationInProgress)return;report('ui.action','wizard.open');
  let port=7777;while(state.servers.some(s=>s.port===port))port++;
  wizard={step:1,name:'Servidor Chispi',port,library:state.library,installNow:true,eula:false};wizardRender();
}
function wizardCapture() {
  if(!wizard)return;
  if(wizard.step===1){wizard.name=$('#wizard-name').value;wizard.port=Number($('#wizard-port').value);}
  if(wizard.step===2)wizard.library=$('#wizard-folder').value;
  if(wizard.step===3){wizard.installNow=$('#wizard-install').checked;wizard.eula=$('#wizard-eula').checked;}
}
function wizardRender(error='') {
  const w=wizard;report('ui.action','wizard.step.'+w.step);
  const body=w.step===1?`<div class="field"><label for="wizard-name">${t('name')}</label><input id="wizard-name" value="${esc(w.name)}" maxlength="100" required></div><div class="field"><label for="wizard-port">${t('port')}</label><input id="wizard-port" value="${w.port}" type="number" min="1024" max="65535" required><small>${t('uniquePort')}</small></div>`:w.step===2?`<div class="field"><label for="wizard-folder">${t('folder')}</label><div class="input-with-button"><input id="wizard-folder" value="${esc(w.library)}" readonly><button class="button ghost" data-action="wizard-folder">${icon('folder')}${t('chooseFolder')}</button></div><small>${t('folderNote')}</small></div>${notice('requirementsSub',true)}<p class="caption">${t('localFolderNote')}</p>${button('useLocalFolder','wizard-local','folder','ghost small')}`:`<div class="summary-row"><span>${t('name')}</span><strong>${esc(w.name)}</strong></div><div class="summary-row"><span>${t('port')}</span><strong>${w.port}/UDP</strong></div><div class="summary-row"><span>${t('folder')}</span><strong>${esc(w.library)}</strong></div><label class="check-row"><input type="checkbox" id="wizard-install" ${w.installNow?'checked':''}>${t('installNow')}</label><label class="check-row"><input type="checkbox" id="wizard-eula" ${w.eula?'checked':''}>${t('eulaAccept')}</label><button class="text-button" data-link="eula">${t('readEula')}${icon('external')}</button>`;
  $('#modal-root').innerHTML=`<div class="modal-overlay"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="wizard-title"><div class="modal-header"><div><h2 id="wizard-title">${t('newServer')}</h2><p>${t('wizardSub')}</p></div><button class="icon-button" data-action="modal-cancel" aria-label="${t('cancel')}">×</button></div><div class="modal-body"><div class="steps">${['stepIdentity','stepLocation','stepReady'].map((k,i)=>`<div class="step ${w.step===i+1?'active':''}"><b>${i+1}</b>${t(k)}</div>`).join('')}</div>${body}<div id="creation-status" class="caption" role="status" aria-live="polite"></div><div class="modal-error">${esc(error)}</div>${w.step===3&&error?button('useLocalFolder','wizard-local','folder','ghost small'):''}</div><div class="modal-footer">${button('exportDiagnostics','export-diagnostics','download','ghost small')}${button(w.step===1?'cancel':'back',w.step===1?'modal-cancel':'wizard-back',null,'ghost')}${button(w.step===3?'create':'next',w.step===3?'wizard-create':'wizard-next',w.step===3?'plus':'arrow','primary')}</div></div></div>`;
  $('#wizard-name')?.focus();
}
async function refreshPlayers(showError=true) {
  if(playerBusy||!current())return;
  const id=selected;playerBusy=true;
  try{await rpc('players',{id});await sync(false);if(view==='server'&&selected===id&&tab==='players')await render();}
  catch(e){if(showError)handleError(e);}
  finally{playerBusy=false;}
}
async function runAction(el, fn, message='') {
  el.disabled=true;try{await fn();if(message)toast(t(message));}catch(e){handleError(e);}finally{if(el.isConnected)el.disabled=false;}
}
const actions={
  new:()=>wizardOpen(), all:()=>navigate('allServers'), 'go-console':()=>navigate('server',selected,'console'),
  'modal-cancel':()=>modalClose(false), 'modal-confirm':()=>modalClose(true),
  'delete-server':()=>deleteDialog(selected),
  'confirm-delete-server':async el=>{
    const id=pendingDeletion;if(!id||deletionInProgress)return;
    const mode=$('input[name="delete-mode"]:checked').value;
    deletionInProgress=true;$$('button,input',$('#modal-root')).forEach(item=>item.disabled=true);
    el.textContent=t('deletingServer');
    try{
      await rpc('removeServer',{id,mode});
      deletionInProgress=false;modalClose();
      if(selected===id){selected=null;view='allServers';tab='overview';dirty=false;logs=[];}
      await sync();toast(t('serverDeleted'));
    }catch(e){deletionInProgress=false;$$('button,input',$('#modal-root')).forEach(item=>item.disabled=false);el.innerHTML=icon('trash')+t('deleteServer');handleError(e);}
  },
  'wizard-next':()=>{wizardCapture();if(wizard.step===1){if(!wizard.name.trim())return wizardRender(I18N.ERRORS.invalidInput[I18N.LANGS.indexOf(state.language)]);if(!Number.isInteger(wizard.port)||wizard.port<1024||wizard.port>65535)return wizardRender(I18N.ERRORS.invalidPort[I18N.LANGS.indexOf(state.language)]);if(state.servers.some(s=>s.port===wizard.port))return wizardRender(I18N.ERRORS.portBusy[I18N.LANGS.indexOf(state.language)]);}wizard.step++;wizardRender();},
  'wizard-back':()=>{wizardCapture();wizard.step--;wizardRender();},
  'wizard-local':async()=>{if(creationInProgress)return;wizardCapture();wizard.library=await rpc('localLibrary');wizard.step=2;wizardRender();},
  'wizard-folder':async()=>{const folder=await rpc('chooseFolder');if(folder){wizard.library=folder;$('#wizard-folder').value=folder;}},
  'wizard-create':async el=>{
    if(creationInProgress)return;
    wizardCapture();report('ui.action','wizard.create.eula.'+wizard.eula);
    if(!wizard.eula)return wizardRender(I18N.ERRORS.eulaRequired[I18N.LANGS.indexOf(state.language)]);
    const w={...wizard};creationInProgress=true;creationSlow=false;
    $('.modal-error',$('#modal-root')).textContent='';
    $$('#modal-root button,#modal-root input').forEach(item=>{if(item.dataset.action!=='export-diagnostics')item.disabled=true;});
    el.textContent=t('working');$('#creation-status').textContent=t('createDirectories');
    const watchdog=setTimeout(()=>{creationSlow=true;report('ui.slow','wizard.create.pending');if($('#creation-status'))$('#creation-status').textContent=t('createSlow');},15000);
    try{
      const s=await rpc('create',w);
      creationInProgress=false;modalClose();await sync(false);
      await navigate('server',s.id,w.installNow?'console':'overview');toast(t('created'));
      if(w.installNow)installServer().catch(handleError);
    }catch(e){
      creationInProgress=false;handleError(e);
      if(wizard){wizardRender(errorText(e));$('#creation-status').textContent=t('createFailed');}
    }finally{clearTimeout(watchdog);creationInProgress=false;}
  },
  'export-diagnostics':async el=>runAction(el,async()=>{const file=await rpc('exportDiagnostics');if(file)toast(t('diagnosticsSaved')+' '+file);}),
  'open-diagnostics':()=>rpc('openDiagnostics'),
  start:async el=>runAction(el,async()=>{await rpc('start',{id:selected});await sync();},'started'),
  stop:async el=>runAction(el,async()=>{await rpc('stop',{id:selected});await sync();}),
  restart:async el=>runAction(el,async()=>{await rpc('restart',{id:selected});await sync();},'started'),
  'force-stop':async el=>{if(await confirmDialog('forceConfirm'))await runAction(el,async()=>{await rpc('stop',{id:selected,force:true});await sync();});},
  install:()=>installServer(),
  folder:()=>rpc('openFolder',{id:selected}),
  'backup-folder':()=>rpc('openFolder',{id:selected,kind:'backups'}),
  'copy-address':async()=>{await rpc('copy',{text:address(current())});toast(t('copied'));},
  'save-config':async el=>runAction(el,async()=>{await rpc('configWrite',{id:selected,file:configFile,text:configDraft,expected:configOriginal});dirty=false;await sync();},'saved'),
  'refresh-players':()=>refreshPlayers(true),
  'vac-all':async el=>runAction(el,async()=>{const result=await rpc('bans',{ids:current().players.map(p=>p.steamId).filter(Boolean)});result.forEach(b=>bans.set(b.steamId,b));await render();}),
  'refresh-network':async()=>{await sync();},
  'apply-network':async el=>runAction(el,async()=>{const radio=$('input[name=adapter]:checked');if(!radio)throw{code:'adapterMissing'};await rpc('network',{id:selected,address:radio.value,adapter:radio.dataset.name});await sync();},'saved'),
  backup:async el=>runAction(el,async()=>{await rpc('backup',{id:selected});await sync();},'backupCreated'),
  'export-log':()=>rpc('exportLogs',{id:selected}),
  'console-players':()=>rpc('command',{id:selected,command:'players'}),
  'pref-folder':async()=>{const p=await rpc('chooseFolder');if(p)$('#pref-library').value=p;},
  'save-library':async el=>runAction(el,async()=>{await rpc('preferences',{library:$('#pref-library').value});await sync();},'saved'),
  'save-backup-prefs':async el=>runAction(el,async()=>{await rpc('preferences',{backupHours:Number($('#backup-hours').value),retention:Number($('#retention').value)});await sync();},'saved'),
  'save-key':async el=>runAction(el,async()=>{await rpc('preferences',{steamKey:$('#steam-key').value.trim()});$('#steam-key').value='';await sync();},'saved'),
  'delete-key':async el=>runAction(el,async()=>{await rpc('preferences',{steamKey:''});await sync();},'saved')
};
async function installServer(){const id=selected;try{await navigate('server',id,'console');await rpc('install',{id});await sync();toast(t('installed'));}catch(e){handleError(e);await sync();}}
document.addEventListener('click',async e=>{
  const el=e.target.closest('button,[data-nav],[data-server]');if(!el||el.disabled)return;
  try{
    if(el.dataset.window)return await rpc('window',{action:el.dataset.window});
    if(el.dataset.link)return await rpc('link',{key:el.dataset.link});
    if(el.dataset.nav)return await navigate(el.dataset.nav);
    if(el.dataset.server)return await navigate('server',el.dataset.server);
    if(el.dataset.tab)return await navigate('server',selected,el.dataset.tab);
    if(el.dataset.profile)return await rpc('openProfile',{id:el.dataset.profile});
    if(el.dataset.removeServer)return deleteDialog(el.dataset.removeServer);
    if(el.dataset.removeAdmin)return await runAction(el,async()=>{await rpc('admin',{id:selected,userId:el.dataset.removeAdmin,remove:true});await sync();},'saved');
    if(el.dataset.restore){if(await confirmDialog('restoreConfirm'))await runAction(el,async()=>{await rpc('restore',{id:selected,name:el.dataset.restore});await sync();},'backupRestored');return;}
    if(el.dataset.configMode){configMode=el.dataset.configMode;$$('[data-config-mode]').forEach(b=>b.classList.toggle('active',b.dataset.configMode===configMode));$('#config-search').hidden=configMode==='raw';$('#config-editor').innerHTML=configMode==='raw'?`<textarea id="config-raw" class="code-editor" spellcheck="false" ${busy(current())?'disabled':''}>${esc(configDraft)}</textarea>`:configControls($('#config-search').value);return;}
    if(el.dataset.action&&actions[el.dataset.action])await actions[el.dataset.action](el);
    if(el.id==='side-add')wizardOpen();
  }catch(err){handleError(err);}
});
document.addEventListener('input',e=>{
  if(e.target.id==='config-raw'){configDraft=e.target.value;dirty=configDraft!==configOriginal;}
  if(e.target.dataset.configKey){configDraft=setConfigValue(configDraft,e.target.dataset.configKey,e.target.type==='checkbox'?e.target.checked:e.target.value);dirty=configDraft!==configOriginal;}
  if(e.target.id==='config-search')$('#config-editor').innerHTML=configControls(e.target.value);
  if(e.target.id==='log-filter'){logFilter=e.target.value;updateLogs();}
});
document.addEventListener('change',async e=>{
  try{
    if(e.target.id==='language'){
      if(dirty&&!await confirmDialog('pendingChanges')){e.target.value=state.language;return;}
      dirty=false;await rpc('preferences',{language:e.target.value});await sync();
    }
    if(e.target.id==='config-file'){
      const next=e.target.value;if(dirty&&!await confirmDialog('pendingChanges')){e.target.value=configFile;return;}
      dirty=false;configFile=next;await render();
    }
  }catch(err){handleError(err);}
});
document.addEventListener('submit',async e=>{
  e.preventDefault();const btn=$('button',e.target);
  if(e.target.id==='admin-form')await runAction(btn,async()=>{await rpc('admin',{id:selected,userId:$('#admin-id').value.trim(),role:$('#admin-role').value});await sync();},'saved');
  if(e.target.id==='console-form')await runAction(btn,async()=>{const command=$('#command').value;await rpc('command',{id:selected,command});$('#command').value='';});
  if(e.target.id==='lookup-form')await runAction(btn,async()=>{const id=$('#lookup-id').value.trim();const [b]=await rpc('bans',{ids:[id]});bans.set(id,b);$('#lookup-result').innerHTML=`<div class="lookup-result"><code>${esc(id)}</code> · ${vacBadge(b)} · ${t('gameBans')}: ${b.gameBans}<p class="caption">${t('checkedAt')}: ${fmtDate(b.checkedAt)}</p></div>`;});
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#modal-root').children.length)modalClose(false);});
let changeTimer;
window.chispi.onChanged(()=>{
  if(changeTimer)return;
  changeTimer=setTimeout(async()=>{
    changeTimer=null;
    try{
      const previous=current();const next=await rpc('state');state=next;updateChrome();
      if(view==='server'){const el=$('#job-progress');if(el){el.innerHTML=current()?.job?progress(current()):'';const output=$('.install-output',el);if(output)output.scrollTop=output.scrollHeight;}}
      if(dirty)return;
      if(view==='server'&&['settings','admin','network'].includes(tab)&&previous?.status===current()?.status)return;
      if(view==='preferences')return;
      if(view==='server'&&tab==='console'&&previous?.pid===current()?.pid&&Boolean(previous?.job)===Boolean(current()?.job))return;
      await render();
    }catch(e){handleError(e);}
  },150);
});
window.chispi.onLog(({id,line})=>{if(id===selected&&view==='server'&&tab==='console'){logs.push(line);if(logs.length>1500)logs.shift();updateLogs();}});
window.chispi.onCreateStage(stage=>{if(creationInProgress&&$('#creation-status'))$('#creation-status').textContent=t(stage)+(creationSlow?' · '+t('createSlow'):'');});
window.chispi.onBusy(()=>toast(t('working')));
window.chispi.onStopFailed(()=>handleError({code:'stopTimeout'}));
setInterval(()=>{if(view==='server'&&tab==='players'&&current()?.status==='running'&&!playerBusy)refreshPlayers(false);},15000);
(async()=>{try{await sync();report('ui.ready','startup.complete');setTimeout(()=>{$('#splash').style.opacity='0';setTimeout(()=>$('#splash').remove(),650);},1700);}catch(e){report('ui.error',errorText(e),e.stack);$('#loading-text').textContent=errorText(e);const exportButton=document.createElement('button');exportButton.className='button ghost';exportButton.textContent=t('exportDiagnostics');exportButton.addEventListener('click',()=>rpc('exportDiagnostics').catch(handleError));$('#splash').append(exportButton);}})();
