const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {ServerManager,patchConfig,assignAdmin,getAdmins,getRoles,within,parsePlayerLine,freePort}=require('../src/core');
const {parseSteamProgress}=require('../src/steam-progress');
const {windowsCompatibility,spawnWindowsTerminal}=require('../src/windows-compatibility');
const adminFixture=`# remote admin\nMembers:\n - 76561198000000000@steam: admin\n\nowner_badge: SERVER OWNER\nRoles:\n - owner\n - admin\nPermissions:\n - GivingItems: [owner, admin]\n`;
test('Windows compatibility accepts Windows 10 and every Windows 11 build without a maximum build',()=>{
 for(const build of [10240,14393,17763,18362,19045,22000,22621,22631,26100,26200,28000,99999]){
  const info=windowsCompatibility({platform:'win32',arch:'x64',release:`10.0.${build}`});
  assert.equal(info.supported,true,`build ${build}`);assert.equal(info.name,build>=22000?'Windows 11':'Windows 10');
  assert.equal(info.useConpty,build>=18309);
 }
 assert.equal(windowsCompatibility({platform:'win32',arch:'x64',release:'6.3.9600'}).supported,false);
 assert.equal(windowsCompatibility({platform:'win32',arch:'ia32',release:'10.0.19045'}).supported,false);
 assert.equal(windowsCompatibility({platform:'win32',arch:'arm64',release:'10.0.26100'}).supported,false);
});
test('Windows terminal falls back to legacy only after native initialization failure and preserves the command',()=>{
 const calls=[];const terminal={pid:123};const args=['+force_install_dir','C:\\Mis servidores\\SCP','+login','anonymous'];
 const factory={spawn:(file,received,options)=>{calls.push({file,args:received,options});if(options.useConpty)throw Error('API unavailable');return terminal;}};
 assert.equal(spawnWindowsTerminal('steamcmd.exe',args,{cwd:'C:\\SteamCMD'},{factory,compatibility:{useConpty:true}}),terminal);
 assert.deepEqual(calls.map(c=>c.options.useConpty),[true,false]);assert.deepEqual(calls[1].args,args);assert.equal(calls[1].file,'steamcmd.exe');assert.equal(calls[1].options.cwd,'C:\\SteamCMD');
 calls.length=0;spawnWindowsTerminal('steamcmd.exe',args,{cwd:'C:\\SteamCMD'},{factory,compatibility:{useConpty:false}});assert.equal(calls.length,1);
});
test('SteamCMD progress distinguishes download and verification without inventing an overall percent',()=>{
 const downloading=parseSteamProgress(' Update state (0x61) downloading, progress: 42.81 (316907314 / 740189146)');
 assert.deepEqual(downloading,{phase:'game',step:'downloadingGame',percent:42.8});
 const verifying=parseSteamProgress(' Update state (0x81) verifying update, progress: 9.50 (70296224 / 740189146)',downloading);
 assert.deepEqual(verifying,{phase:'game',step:'verifyingGame',percent:9.5});
 assert.deepEqual(parseSteamProgress(' Update state (0x0) unknown, progress: 0.00 (0 / 0)',verifying),verifying);
 assert.deepEqual(parseSteamProgress('Connecting anonymously to Steam Public...'),{phase:'steamcmd',step:'connectingSteam',percent:null});
 assert.equal(parseSteamProgress('[ 61%] Descargando archivos (18,304 de 29,961 KB)...').percent,61);
 assert.equal(parseSteamProgress('Success! App \'996560\' fully installed.').percent,100);
 assert.equal(parseSteamProgress('Unloading Steam API...OK',{phase:'game',step:'installFinished',percent:100}).percent,100);
 assert.equal(parseSteamProgress(' Update state (0x61) downloading, progress: 101.2').percent,100);
});
test('config patch preserves comments, multiline structures and unknown options',()=>{
 const text='# hi\nserver_name: old\ncustom: value: with colon\nlist:\n - test\nfriendly_fire: false\n';
 const updated=patchConfig(text,{server_name:'new',friendly_fire:'true'});
 assert.match(updated,/# hi/);assert.match(updated,/custom: value: with colon/);assert.match(updated,/list:\n - test/);assert.match(updated,/friendly_fire: true/);
 assert.throws(()=>patchConfig('a: 1\na: 2\n',{a:'3'}),{code:'duplicateKey'});
});
test('admin assignment uses existing roles and preserves permissions',()=>{
 const result=assignAdmin(adminFixture,'76561198000000000@steam','owner');
 assert.deepEqual(getAdmins(result),[{userId:'76561198000000000@steam',role:'owner'}]);
 assert.deepEqual(getRoles(result),['owner','admin']);assert.match(result,/GivingItems: \[owner, admin\]/);
 assert.throws(()=>assignAdmin(adminFixture,'abc','owner'),{code:'invalidId'});
 assert.throws(()=>assignAdmin(adminFixture,'76561198000000001@steam','god'),{code:'roleMissing'});
});
test('path confinement blocks traversal and absolute paths outside backup root',()=>{
 assert.equal(within('C:\\a','C:\\a\\b'),true);assert.equal(within('C:\\a','C:\\outside'),false);assert.equal(within('C:\\a','C:\\a2'),false);
});
test('player line parser extracts platform without assigning fabricated VAC data',()=>{
 const p=parsePlayerLine('Alice (2, 76561198000000000@steam)');assert.equal(p.steamId,'76561198000000000');assert.equal(p.name,'Alice');assert.equal(p.vacBanned,undefined);assert.equal(parsePlayerLine('Some text'),null);
});
test('six translations have complete string coverage',async()=>{
 const ctx={window:{}};vm.createContext(ctx);vm.runInContext(await fs.readFile(path.join(__dirname,'../src/i18n.js'),'utf8'),ctx);
 for(const group of [ctx.window.I18N.COPY,ctx.window.I18N.ERRORS])for(const [key,values]of Object.entries(group)){assert.equal(values.length,6,key);assert.ok(values.every(s=>typeof s==='string'&&s.length),key);}
});
test('profiles persist, reject duplicate ports, make real ZIP backups and restore files',async()=>{
 const testRoot=path.resolve(__dirname,'../output');await fs.mkdir(testRoot,{recursive:true});
 const root=await fs.mkdtemp(path.join(testRoot,'chispi-test-'));
 try{
 const m=await new ServerManager(path.join(root,'state'),path.join(root,'library')).init();
 const s=await m.create({name:'Test server',port:28777,eula:true});const s2=await m.create({name:'Test 2',port:28778,eula:true});
 assert.notEqual(s.directory,s2.directory);assert.equal(m.snapshot().servers[0].installed,false);
 await assert.rejects(m.create({name:'Dup',port:28777}),{code:'portBusy'});
 await fs.writeFile(path.join(m.config(s),'config_remoteadmin.txt'),adminFixture);
 await m.admin(s.id,'76561198000000001','owner');
 assert.match(await m.readConfig(s.id,'config_remoteadmin.txt'),/76561198000000001@steam: owner/);
 const backup=await m.backup(s.id);const original=await m.readConfig(s.id,'config_gameplay.txt');
 await m.writeConfig(s.id,'config_gameplay.txt',patchConfig(original,{friendly_fire:'true'}),original);
 await assert.rejects(m.writeConfig(s.id,'config_gameplay.txt','x',original),{code:'fileChanged'});
 await fs.writeFile(path.join(m.config(s),'added-after-snapshot.txt'),'remove on restore');
 await m.restore(s.id,backup);assert.equal(await m.readConfig(s.id,'config_gameplay.txt'),original);
 await assert.rejects(fs.access(path.join(m.config(s),'added-after-snapshot.txt')));
 await assert.rejects(m.readConfig(s.id,'../../bad'),{code:'invalidInput'});
 await assert.rejects(m.restore(s2.id,backup));
 const reopened=await new ServerManager(path.join(root,'state'),path.join(root,'library')).init();assert.equal(reopened.state.servers.length,2);
 await assert.rejects(m.steamBans(['76561198000000000'],''),{code:'steamKeyRequired'});
 }finally{assert.ok(root.startsWith(path.join(testRoot,'chispi-test-')));await fs.rm(root,{recursive:true,force:true});}
});
test('UDP collision is detected before server start',async()=>{
 const dgram=require('node:dgram');const socket=dgram.createSocket('udp4');
 await new Promise(r=>socket.bind(0,'127.0.0.1',r));
 try{await assert.rejects(freePort(socket.address().port,'127.0.0.1'),{code:'portBusy'});}finally{socket.close();}
});
test('server removal preserves files by default, recycles only the selected directory and persists',async()=>{
 const testRoot=path.resolve(__dirname,'../output');await fs.mkdir(testRoot,{recursive:true});
 const root=await fs.mkdtemp(path.join(testRoot,'chispi-remove-'));
 try{
  const m=await new ServerManager(path.join(root,'state'),path.join(root,'library')).init();
  const keep=await m.create({name:'Keep files',port:28801,eula:true});
  const trash=await m.create({name:'Recycle files',port:28802,eula:true});
  const sibling=await m.create({name:'Other server',port:28803,eula:true});
  const backup=await m.backup(keep.id);
  await fs.mkdir(path.join(m.state.library,'steamcmd'),{recursive:true});
  const shared=path.join(m.state.library,'steamcmd','keep.txt');await fs.writeFile(shared,'shared SteamCMD');
  let calls=0;
  await m.removeServer(keep.id,'keep',()=>{calls++;});
  assert.equal(calls,0);await fs.access(keep.directory);await fs.access(path.join(m.backupDir(keep),backup));
  assert.ok(!m.state.servers.some(s=>s.id===keep.id));
  const destination=path.join(root,'recycled-server');
  await m.removeServer(trash.id,'trash',async target=>{assert.equal(target,path.resolve(trash.directory));calls++;await fs.rename(target,destination);});
  assert.equal(calls,1);await assert.rejects(fs.access(trash.directory));await fs.access(destination);
  await fs.access(sibling.directory);assert.equal(await fs.readFile(shared,'utf8'),'shared SteamCMD');
  const reopened=await new ServerManager(path.join(root,'state'),path.join(root,'library')).init();
  assert.deepEqual(reopened.state.servers.map(s=>s.id),[sibling.id]);
  const replacement=await m.create({name:'Reused port',port:28801,eula:true});assert.notEqual(replacement.directory,keep.directory);
 }finally{assert.ok(root.startsWith(path.join(testRoot,'chispi-remove-')));await fs.rm(root,{recursive:true,force:true});}
});
test('server removal refuses active operations, unsafe roots and junctions, and keeps profile on recycling failure',async()=>{
 const testRoot=path.resolve(__dirname,'../output');await fs.mkdir(testRoot,{recursive:true});
 const root=await fs.mkdtemp(path.join(testRoot,'chispi-remove-guard-'));
 try{
  const m=await new ServerManager(path.join(root,'state'),path.join(root,'library')).init();
  const s=await m.create({name:'Guarded',port:28804,eula:true});
  let calls=0;const trash=async()=>{calls++;};
  m.runtime(s.id).child={pid:123};await assert.rejects(m.removeServer(s.id,'trash',trash),{code:'stopFirst'});m.runtime(s.id).child=null;
  m.jobs.set(s.id,{phase:'game'});await assert.rejects(m.removeServer(s.id,'keep'),{code:'stopFirst'});m.jobs.delete(s.id);
  const original=s.directory;s.directory=m.state.library;
  await assert.rejects(m.removeServer(s.id,'trash',trash),{code:'unsafeDeletePath'});s.directory=original;
  const link=path.join(path.dirname(original),'junction-'+s.id.slice(0,8));
  const linkedRoot=path.join(root,'outside-target');await fs.mkdir(linkedRoot);await fs.writeFile(path.join(linkedRoot,'protected.txt'),'safe');
  await fs.symlink(linkedRoot,link,'junction');s.directory=link;
  await assert.rejects(m.removeServer(s.id,'trash',trash),{code:'unsafeDeletePath'});s.directory=original;
  assert.equal(calls,0);assert.equal(await fs.readFile(path.join(linkedRoot,'protected.txt'),'utf8'),'safe');
  await assert.rejects(m.removeServer(s.id,'trash',async()=>{throw Error('Windows rejected recycle');}),{code:'trashFailed'});
  assert.ok(m.state.servers.some(row=>row.id===s.id));await fs.access(original);
  let release;const latch=new Promise(resolve=>{release=resolve;});let started;
  const entered=new Promise(resolve=>{started=resolve;});
  const pending=m.removeServer(s.id,'trash',async()=>{started();await latch;});
  await entered;await assert.rejects(m.start(s.id),{code:'stopFirst'});release();await pending;
  assert.equal(m.deleting.size,0);
 }finally{assert.ok(root.startsWith(path.join(testRoot,'chispi-remove-guard-')));await fs.rm(root,{recursive:true,force:true});}
});
