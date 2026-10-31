const {_electron:electron}=require('playwright');
const path=require('node:path');const fs=require('node:fs/promises');const assert=require('node:assert/strict');
const {ServerManager}=require('../src/core');
(async()=>{
 const root=path.resolve('output/delete-ui-'+Date.now());const dataDir=path.join(root,'state');
 const manager=await new ServerManager(dataDir,path.join(root,'library')).init();
 const keep=await manager.create({name:'Conservar mis archivos',port:28811,eula:true});
 const trash=await manager.create({name:'Eliminar este servidor',port:28812,eula:true});
 await manager.backup(keep.id);await manager.backup(trash.id);
 await fs.mkdir(path.join(manager.state.library,'steamcmd'),{recursive:true});
 const shared=path.join(manager.state.library,'steamcmd','shared.txt');await fs.writeFile(shared,'keep SteamCMD');
 const options=process.argv.includes('--packaged')?{executablePath:path.resolve('release/win-unpacked/SCP Chispi Manager.exe'),args:['--data-dir='+dataDir]}:{args:[path.resolve('.'),'--data-dir='+dataDir]};
 const app=await electron.launch(options);const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.waitForSelector('#splash',{state:'detached'});await page.locator('[data-nav="allServers"]').click();
  await page.locator(`[data-remove-server="${keep.id}"]`).click();
  assert.equal(await page.locator('input[name="delete-mode"][value="keep"]').isChecked(),true);
  await page.locator('[data-action="modal-cancel"]').last().click();
  assert.equal((await page.evaluate(()=>window.chispi.call('state'))).value.servers.length,2);await fs.access(keep.directory);
  await page.locator(`[data-server="${keep.id}"]`).last().click();
  await page.locator('[data-action="delete-server"]').click();await page.locator('[data-action="confirm-delete-server"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('.server-card').length===1);
  await fs.access(keep.directory);assert.ok((await fs.readdir(manager.backupDir(keep))).some(n=>n.endsWith('.zip')));
  await page.locator(`[data-remove-server="${trash.id}"]`).click();await page.locator('input[name="delete-mode"][value="trash"]').check();
  await page.screenshot({path:'output/delete-server-dialog.png'});
  await page.locator('[data-action="confirm-delete-server"]').click();
  await page.waitForFunction(async()=>!(await window.chispi.call('state')).value.servers.length,null,{timeout:20000});
  await page.waitForSelector('.empty-state');
  await assert.rejects(fs.access(trash.directory));await fs.access(keep.directory);assert.equal(await fs.readFile(shared,'utf8'),'keep SteamCMD');
  const saved=JSON.parse(await fs.readFile(path.join(dataDir,'manager.json'),'utf8'));assert.equal(saved.servers.length,0);
  await page.screenshot({path:'output/delete-server-complete.png'});assert.deepEqual(errors,[]);
  console.log('DELETE UI PASS: cancel, preserve files and backups, Windows Recycle Bin, persistent removal, shared SteamCMD untouched.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
