const {_electron:electron}=require('playwright');const path=require('node:path');const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{
 const app=await electron.launch({executablePath:path.resolve('release/win-unpacked/SCP Chispi Manager.exe'),args:['--data-dir='+path.resolve('output/windows-package-state')]});
 const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.waitForSelector('#splash',{state:'detached'});await page.locator('[data-nav="preferences"]').click();
  await page.getByText('Compatibilidad de Windows',{exact:true}).waitFor();
  assert.ok((await page.locator('.windows-compatibility').innerText()).includes('Windows 10 y Windows 11'));
  await page.screenshot({path:'output/windows-compatibility-panel.png'});
  const report=await app.evaluate(async({app})=>{
   const nodeRequire=process.mainModule.require.bind(process.mainModule);
   const path=nodeRequire('node:path');const assert=nodeRequire('node:assert/strict');
   const {windowsCompatibility,spawnWindowsTerminal}=nodeRequire(path.join(app.getAppPath(),'src/windows-compatibility.js'));
   const actual=windowsCompatibility();const results=[];
   for(const backend of ['native','legacy','fallback']){
    let text='';const calls=[];
    const factory=backend==='fallback'?{spawn:(file,args,options)=>{calls.push(options.useConpty);if(options.useConpty)throw Error('Test native initialization failure');return nodeRequire(path.join(app.getAppPath(),'node_modules/node-pty')).spawn(file,args,options);}}:undefined;
    const result=await new Promise((resolve,reject)=>{
     let child;try{child=spawnWindowsTerminal('cmd.exe',['/d','/c','echo CHISPI_WINDOWS_PACKAGE_OK'],{cwd:app.getPath('userData'),cols:120,rows:20,env:process.env},{compatibility:{...actual,useConpty:backend!=='legacy'},factory});}catch(e){reject(e);return;}
     const timer=setTimeout(()=>{child.kill();reject(Error('Terminal timed out'));},15000);
     child.onData(data=>{text+=data;});child.onExit(({exitCode})=>{clearTimeout(timer);try{assert.equal(exitCode,0);assert.ok(text.includes('CHISPI_WINDOWS_PACKAGE_OK'));if(backend==='fallback')assert.deepEqual(calls,[true,false]);resolve({backend,passed:true});}catch(e){reject(e);}});
    });results.push(result);
   }
   return {actualHost:actual,realPackagedTerminalTests:results};
  });
  fs.writeFileSync('output/windows-package-compatibility.json',JSON.stringify(report,null,2));assert.deepEqual(errors,[]);
  console.log('WINDOWS PACKAGE PASS: compatibility panel and real native, legacy and fallback terminals.',JSON.stringify(report));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
