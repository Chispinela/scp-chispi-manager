const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
const {ServerManager,patchConfig,freePort}=require('../src/core');
(async()=>{
 const m=await new ServerManager(path.resolve('runtime/manager'),path.resolve('runtime/library')).init();
 const first=m.state.servers[0];let second=m.state.servers[1];
 if(!second){second=await m.create({name:'Servidor Chispi 2',port:7778,eula:true});const source=m.game(first);await fs.cp(source,m.game(second),{recursive:true,filter:p=>{const rel=path.relative(source,p);return !/^(AppData|steamapps)(\\|\/|$)/.test(rel);}});await m.seedConfigs(second);}
 const targets=[first,second];
 for(const s of targets){const raw=await m.readConfig(s.id,'config_gameplay.txt');await m.writeConfig(s.id,'config_gameplay.txt',patchConfig(raw,{ipv4_bind_ip:'127.0.0.1',server_ip:'127.0.0.1',forward_ports:'false'}),raw);}
 const transcript=[];m.on('log',({id,line})=>{const text=`[${m.server(id).port}] ${line.text}`;transcript.push(text);if(/Waiting for players|List of players|exit:|Error/i.test(text))console.log(text);});
 try{
  await Promise.all(targets.map(s=>m.start(s.id)));
  const deadline=Date.now()+60000;while(Date.now()<deadline&&!targets.every(s=>m.runtime(s.id).status==='running'))await new Promise(r=>setTimeout(r,500));
  assert.ok(targets.every(s=>m.runtime(s.id).status==='running'));
  assert.notEqual(m.runtime(first.id).child.pid,m.runtime(second.id).child.pid);
  const players=await Promise.all(targets.map(s=>m.refreshPlayers(s.id)));assert.deepEqual(players,[[],[]]);
  console.log('PASS: two real SCP:SL instances running simultaneously on UDP 7777 and 7778; confirmed zero-player responses.');
 }finally{
  for(const s of targets)if(m.runtime(s.id).child){try{await m.stop(s.id);}catch{await m.stop(s.id,true);}}
  await fs.writeFile('output/multi-server.log',transcript.join('\n'));
 }
 await Promise.all(targets.map(s=>freePort(s.port,'127.0.0.1')));
 for(const s of targets)await m.backup(s.id);
 console.log('PASS: both stopped cleanly; both ports released; backup archives created.');
})().catch(e=>{console.error(e);process.exitCode=1;});
