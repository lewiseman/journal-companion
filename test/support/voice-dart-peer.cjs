// Synthetic transport peer. Never imported or packaged by the application.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Vault } = require('../../src/vault.cjs');
const { Voice } = require('../../src/voice.cjs');
const { DeviceService, deviceId } = require('../../src/device-service.cjs');
class SyntheticSpeech extends EventEmitter {
  model = { id:'synthetic-transport-only' };
  capability() { return {id:'transcription',implemented:true,status:'ready',reason:'Synthetic transport peer'}; }
  release() {}
  async open() {
    let finish;
    const done = new Promise((resolve)=> {finish=resolve;});
    return { write() {}, end() { finish(); }, destroy() { finish(); }, async *[Symbol.asyncIterator]() { await done; yield {id:0,text:'Synthetic transport probe',startMs:0,endMs:100}; } };
  }
}
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'voice-dart-peer-'));
  const vault = new Vault(directory,{isEncryptionAvailable:()=>true,encryptString:(s)=>Buffer.from(s),decryptString:(b)=>b.toString()}); await vault.initialize();
  const key = crypto.generateKeyPairSync('ed25519'), priv = key.privateKey.export({format:'jwk'}), pub = Buffer.from(priv.x,'base64url').toString('base64'), device = deviceId(pub);
  await vault.change((v)=> {v.devices[device]={id:device,name:'Synthetic Dart peer',publicKey:pub};});
  const speech = new SyntheticSpeech(), voice = new Voice(vault,speech); await voice.initialize();
  const service = new DeviceService(vault,{capability:()=>({id:'text',status:'unloaded',implemented:true,reason:'Transport test'})},{forget:async()=>{}},{voice,port:0,host:'127.0.0.1',advertise:false});
  await service.initialize(); await service.start();
  process.stdout.write(JSON.stringify({id:service.identity.id,name:'Synthetic voice desktop',pin:service.pin,endpoint:`https://127.0.0.1:${service.port}`,seed:Buffer.from(priv.d,'base64url').toString('base64'),publicKey:pub,deviceId:device,enabled:true})+'\n');
  let stopping = false;
  const stop = async () => {if(stopping)return; stopping=true; await service.stop();await voice.shutdown();await fs.rm(directory,{recursive:true,force:true}); process.exit(0);};
  process.stdin.on('data',(d)=> {if(d.toString().trim()==='quit')stop();}); process.on('SIGTERM',stop);
})().catch((e)=> {console.error(e.stack);process.exit(1);});
