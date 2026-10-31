const {_electron:electron}=require('playwright');
const path=require('node:path');const assert=require('node:assert/strict');const fs=require('node:fs');
const {ServerManager}=require('../src/core');
(async()=>{
 let dataDir=path.resolve('runtime/manager');
 if(process.argv.includes('--fresh')){
  const root=path.resolve('output/install-fresh-'+Date.now());dataDir=path.join(root,'state');
  const manager=await new ServerManager(dataDir,path.resolve('runtime/library')).init();
  await manager.create({name:'Instalación Chispi',port:28779,eula:true,library:path.join(root,'library')});
 }
 const executable=process.argv.includes('--packaged')?{executablePath:path.resolve('release/win-unpacked/SCP Chispi Manager.exe'),args:['--data-dir='+dataDir]}:{args:[path.resolve('.'),'--data-dir='+dataDir]};
 const app=await electron.launch(executable);const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let pending=false;
 try{
  await page.waitForSelector('#splash',{state:'detached'});await page.locator('[data-server]').first().click();
  await page.locator('[data-action="install"]').first().click();
  await page.waitForSelector('[data-tab="console"].active');await page.waitForSelector('.progress-panel');pending=true;
  const samples=[];let captured=false,liveLog=false;
  const deadline=Date.now()+180000;
  while(Date.now()<deadline){
   const snapshot=await page.evaluate(()=>window.chispi.call('state'));
   const s=snapshot.value.servers[0],job=s.job;
   if(!job){pending=false;break;}
   if(job.lines?.some(l=>/Connecting|Update state|Loading Steam|steamcmd.exe/.test(l.text)))liveLog=true;
   samples.push({step:job.step,percent:job.percent,lines:job.lines?.length});
   const known=await page.locator('.install-completed').getAttribute('data-progress');
   if(known!==''){
    const completed=await page.locator('.install-completed').innerText(),remaining=await page.locator('.install-remaining').innerText();
    const num=s=>Number(s.replace('%','').replace(',','.').trim());
    assert.ok(Math.abs(num(completed)+num(remaining)-100)<0.15,`${completed} + ${remaining}`);
    if(!captured&&job.phase==='game'&&job.percent>0&&job.percent<100){
     await page.screenshot({path:'output/installation-progress.png'});captured=true;
     // Keep the same live progress and CMD output available outside the console tab.
     await page.locator('[data-tab="overview"]').click();await page.waitForSelector('.install-output');
     assert.ok((await page.locator('.install-output').innerText()).includes('steamcmd.exe'));
     await page.screenshot({path:'output/installation-overview.png'});
     await page.locator('[data-tab="console"]').click();
    }
   }
   await page.waitForTimeout(150);
  }
  assert.equal(pending,false,'SteamCMD installation must finish');
  fs.writeFileSync('output/installation-progress-samples.json',JSON.stringify(samples,null,2));
  if(process.argv.includes('--fresh'))assert.ok(captured,'Fresh server download must show its real percentage before completion');
  assert.ok(samples.some(s=>Number.isFinite(s.percent)),'Real SteamCMD percentage must be displayed');assert.ok(liveLog,'Real command output should arrive during installation');
  await page.waitForSelector('.toast:not(.bad)');assert.deepEqual(errors,[]);
  fs.writeFileSync('output/installation-progress-samples.json',JSON.stringify(samples,null,2));
  console.log('INSTALL UI PASS: real SteamCMD progress, remaining percentage, automatic console and live output across tabs.',JSON.stringify(samples));
 }finally{
  if(pending){await page.waitForFunction(async()=>!(await window.chispi.call('state')).value.servers.some(s=>s.job),{timeout:180000}).catch(()=>{});}
  await app.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
