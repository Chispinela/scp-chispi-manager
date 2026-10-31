const {app}=require('electron');const os=require('node:os');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {windowsCompatibility,spawnWindowsTerminal}=require('../src/windows-compatibility');
app.setPath('userData',path.resolve('output/windows-runtime-state'));
app.whenReady().then(async()=>{
 const actual=windowsCompatibility();const results=[];
 for(const test of ['native','legacy','fallback']){
  const output=await new Promise((resolve,reject)=>{
   let text='',child,timer;const calls=[];
   const compatibility={...actual,useConpty:test!=='legacy'};
   const factory=test==='fallback'?{spawn:(file,args,options)=>{calls.push(options.useConpty);if(options.useConpty)throw Error('Test unavailable native API');return require('node-pty').spawn(file,args,options);}}:undefined;
   try{child=spawnWindowsTerminal('cmd.exe',['/d','/c','echo SCP_CHISPI_COMPAT_OK'],{cwd:path.resolve('.'),cols:120,rows:20,env:process.env},{compatibility,factory});}catch(e){reject(e);return;}
   timer=setTimeout(()=>{child.kill();reject(Error(`${test} terminal timed out`));},15000);
   child.onData(data=>{text+=data;});
   child.onExit(({exitCode})=>{clearTimeout(timer);try{assert.equal(exitCode,0);assert.ok(text.includes('SCP_CHISPI_COMPAT_OK'));if(test==='fallback')assert.deepEqual(calls,[true,false]);resolve(text);}catch(e){reject(e);}});
  });
  results.push({terminal:test,passed:true,output});
 }
 const policyCases=[10240,14393,17763,18362,19045,22000,22621,22631,26100,26200,28000,99999].map(build=>windowsCompatibility({platform:'win32',arch:'x64',release:`10.0.${build}`}));
 fs.writeFileSync('output/windows-compatibility.json',JSON.stringify({actualHost:{...actual,electron:process.versions.electron,node:process.versions.node},realTerminalTests:results,policyCases,note:'Policy cases check version-selection logic only; they are not tests on those Windows installations.'},null,2));
 console.log('WINDOWS TERMINAL PASS: native, legacy and fallback terminals on the actual host.',actual.release);
 app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
