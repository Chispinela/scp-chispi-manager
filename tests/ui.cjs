const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async()=>{
 const run=Date.now();const dir=path.resolve('output/ui-state-'+run);fs.mkdirSync(dir,{recursive:true});
 const instance=await electron.launch({args:[path.resolve('.'),'--data-dir='+dir],env:{...process.env,ELECTRON_ENABLE_LOGGING:'0'}});
 const page=await instance.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.waitForSelector('#splash',{state:'detached'});
  await page.screenshot({path:'output/dashboard-empty.png'});
  await page.getByRole('button',{name:'Nuevo servidor',exact:true}).first().click();
  await page.locator('#wizard-name').fill('Chispi UI Test');
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.locator('#wizard-install').uncheck();await page.locator('#wizard-eula').check();
  await page.screenshot({path:'output/wizard.png'});
  // Keep test artifacts in the workspace even when the picker is not used.
  await page.evaluate(()=>{document.querySelector('[data-action="wizard-back"]').click();});
  await page.locator('#wizard-folder').evaluate((el,p)=>el.value=p,path.resolve('output/ui-library-'+run));
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.getByRole('button',{name:'Crear servidor',exact:true}).click();
  try{await page.waitForSelector('.server-top-title',{timeout:5000});}catch(e){await page.screenshot({path:'output/ui-failure.png'});console.log('FAIL CONTENT',await page.locator('#toasts').innerText(),await page.locator('.modal-error').allTextContents(),errors);throw e;}
  assert.equal(await page.locator('.server-top-title h1').textContent(),'Chispi UI Test');
  for(const key of ['settings','admin','players','console','network','backups']){
    await page.locator(`[data-tab="${key}"]`).click();await page.waitForTimeout(150);
    assert.ok(await page.locator('#server-view').textContent());
    if(['network','settings'].includes(key))await page.screenshot({path:`output/${key}.png`});
  }
  await page.locator('[data-tab="settings"]').click();await page.waitForSelector('[data-config-key="max_players"]');
  await page.locator('[data-config-key="max_players"]').fill('24');
  await page.locator('[data-action="save-config"]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-config-key="max_players"]').inputValue(),'24');
  await page.locator('[data-tab="backups"]').click();await page.waitForSelector('[data-action="backup"]');
  await page.locator('[data-action="backup"]').click();await page.waitForSelector('.backup-entry');
  await page.locator('[data-nav="preferences"]').click();
  await page.locator('#steam-key').fill('bad');await page.locator('[data-action="save-key"]').click();
  await page.waitForSelector('.toast.bad');
  for(const lang of ['en','ru','zh','ja','pt','es']){
    await page.locator('#language').selectOption(lang);await page.waitForTimeout(250);
    assert.equal(await page.locator('html').getAttribute('lang'),lang);
    await page.screenshot({path:`output/language-${lang}.png`});
  }
  await page.locator('[data-nav="overview"]').click();await page.screenshot({path:'output/dashboard.png'});
  assert.deepEqual(errors,[]);console.log('UI PASS: wizard, six tabs, saved configuration, ZIP backup, invalid key handling, six languages.');
 }finally{await instance.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
