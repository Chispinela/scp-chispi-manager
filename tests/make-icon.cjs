const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.whenReady().then(()=>{
 const image=nativeImage.createFromPath(path.resolve('assets/logo.png')).resize({width:256,height:256}).toPNG();
 const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(image.length,14);header.writeUInt32LE(22,18);
 fs.writeFileSync('assets/icon.ico',Buffer.concat([header,image]));app.quit();
});
