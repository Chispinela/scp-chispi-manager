const fs = require('node:fs');
const path = require('node:path');
const { ServerManager, patchConfig } = require('../src/core');
(async()=>{
 const manager=await new ServerManager(path.resolve('runtime/manager'),path.resolve('runtime/library')).init();
 const s=manager.state.servers[0];
 manager.on('log',({line})=>{console.log(line.text);fs.appendFileSync('output/live-server.log',line.text+'\n');});
 const raw=await manager.readConfig(s.id,'config_gameplay.txt');
 await manager.writeConfig(s.id,'config_gameplay.txt',patchConfig(raw,{ipv4_bind_ip:'127.0.0.1',server_ip:'127.0.0.1',forward_ports:'false'}),raw);
 try{
   await manager.start(s.id);
   let waited=0;
   while(waited<90000 && manager.runtime(s.id).child && manager.runtime(s.id).status!=='running'){await new Promise(r=>setTimeout(r,1000));waited+=1000;}
   console.log('STATUS',manager.runtime(s.id).status);
   if(manager.runtime(s.id).status==='running'){
     const players=await manager.refreshPlayers(s.id);console.log('CONFIRMED PLAYERS',JSON.stringify(players));
     manager.command(s.id,'help');await new Promise(r=>setTimeout(r,1000));
   }else process.exitCode=2;
 }finally{
   if(manager.runtime(s.id).child){try{await manager.stop(s.id);}catch{await manager.stop(s.id,true);}}
 }
 console.log('CONFIG',manager.config(s));
})().catch(e=>{console.error(e);process.exitCode=1;});
