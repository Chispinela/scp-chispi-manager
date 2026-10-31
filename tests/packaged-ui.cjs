const {_electron:electron}=require('playwright');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{
 const app=await electron.launch({executablePath:path.resolve('release/win-unpacked/SCP Chispi Manager.exe'),args:['--data-dir='+path.resolve('runtime/manager')]});
 const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.screenshot({path:'output/splash.png'});await page.waitForSelector('#splash',{state:'detached'});
  await page.locator('[data-server]').first().click();
  await page.locator('[data-tab="settings"]').click();await page.waitForSelector('[data-config-key="max_players"]');
  assert.ok(await page.locator('[data-config-key]').count()>100);
  await page.screenshot({path:'output/real-configuration.png'});
  await page.locator('[data-tab="admin"]').click();await page.waitForSelector('#admin-role');
  assert.ok(await page.locator('#admin-role option').count()>=3);
  await page.locator('[data-tab="overview"]').click();
  await page.locator('[data-action="start"]').click();
  await page.waitForSelector('.server-top-title .badge.running',{timeout:45000});
  await page.screenshot({path:'output/server-running.png'});
  await page.locator('[data-tab="players"]').click();await page.locator('[data-action="refresh-players"]').click();
  await page.getByText('No hay jugadores conectados.',{exact:true}).waitFor({timeout:12000});
  await page.locator('[data-tab="console"]').click();await page.waitForSelector('#command');
  await page.locator('#command').fill('hello');await page.locator('#console-form button').click();
  await page.waitForTimeout(500);await page.screenshot({path:'output/real-console.png'});
  await page.locator('[data-action="stop"]').click();await page.waitForSelector('.server-top-title .badge.stopped',{timeout:30000});
  assert.deepEqual(errors,[]);console.log('PACKAGED UI PASS: complete config, original roles, real server start, player response, command and graceful stop.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
