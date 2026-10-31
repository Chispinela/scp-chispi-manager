const path = require('node:path');
const fs = require('node:fs');
const { ServerManager } = require('./src/core');
(async () => {
 const manager = await new ServerManager(path.resolve('runtime/manager'), path.resolve('runtime/library')).init();
 const s = manager.state.servers[0] || await manager.create({ name: 'Servidor Chispi', port: 7777, eula: true });
 manager.on('log', ({line}) => console.log(line.text));
 manager.on('changed', () => { const job = manager.jobs.get(s.id); if (job) console.log(JSON.stringify(job)); });
 if (!fs.existsSync(path.join(manager.game(s),'LocalAdmin.exe'))) await manager.install(s.id);
 console.log('INSTALLED', JSON.stringify(s));
})().catch(e => { console.error(e); process.exitCode = 1; });
