// Real runtime probe with public/synthetic fixtures. Never records the Mac mic.
// Usage: electron scripts/verify-voice.cjs --directory=/absolute/temp/path
//        --models=/absolute/installed/models --vad=/absolute/silero.bin
//        --audio=/absolute/16khz-mono-pcm16.wav
const { app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { MODELS } = require('../src/model.cjs');
const MODEL = MODELS.find((m) => m.filename === 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf');
const { Runtime } = require('../src/runtime.cjs');
const { Speech, DEFAULT_SPEECH, VAD } = require('../src/speech.cjs');
const { Voice } = require('../src/voice.cjs');
const { Vault } = require('../src/vault.cjs');
const { DeviceService, canonical, deviceId, fingerprint } = require('../src/device-service.cjs');
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split(/=(.*)/s).slice(0,2)));
if (!['directory','models','vad','audio'].every((k) => path.isAbsolute(args[k] || ''))) throw new Error('Supply absolute fixture paths');
app.setPath('userData', path.join(args.directory, 'electron'));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function wavPcm(wav) {
  if (wav.toString('ascii',0,4) !== 'RIFF' || wav.toString('ascii',8,12) !== 'WAVE') throw new Error('Expected WAV');
  let pcm, valid = false;
  for (let at=12; at+8<=wav.length;) {
    const name=wav.toString('ascii',at,at+4), size=wav.readUInt32LE(at+4), data=wav.subarray(at+8,at+8+size);
    if (name==='fmt ') valid = data.readUInt16LE(0) === 1 && data.readUInt16LE(2) === 1 && data.readUInt32LE(4) === 16000 && data.readUInt16LE(14) === 16;
    if (name==='data') pcm=data;
    at+=8+size+(size%2);
  }
  if (!valid || !pcm?.length) throw new Error('Require mono 16kHz PCM16 WAV'); return pcm;
}
app.whenReady().then(async () => {
  let runtime, voice, devices;
  const evidence = { checked: new Date().toISOString(), host: `${process.platform} ${process.arch}`, memoryGB: os.totalmem()/1024**3, sdk:'0.22.0', model:DEFAULT_SPEECH.id, vad:VAD.id, fixture:path.basename(args.audio), actualAndroidMicrophone:false, swahiliQualityMeasured:false, speechSynthesis:false };
  try {
    await fs.mkdir(path.join(args.directory,'models'), { recursive:true });
    for (const [source,name] of [[path.join(args.models,DEFAULT_SPEECH.filename),DEFAULT_SPEECH.filename],[args.vad,VAD.filename],[path.join(args.models,MODEL.filename),MODEL.filename]]) {
      try { await fs.symlink(source,path.join(args.directory,'models',name)); } catch(e) { if(e.code!=='EEXIST') throw e; }
    }
    runtime=new Runtime(args.directory); await runtime.initialize();
    const writingLoaded = await runtime.load(MODEL.id); if (!writingLoaded.ok) throw new Error('Writing model failed to load');
    const speech=new Speech(runtime), started=performance.now(); await speech.load(); evidence.loadMs=Math.round(performance.now()-started);
    evidence.combinedModels = [MODEL.id, DEFAULT_SPEECH.id, VAD.id];
    evidence.loadedResourceSample = (await runtime.sdk.getSystemResources({sample:true})).sample;
    const protector={ isEncryptionAvailable:()=>safeStorage.isAsyncEncryptionAvailable(), encryptString:(v)=>safeStorage.encryptStringAsync(v), decryptString:async(v)=>(await safeStorage.decryptStringAsync(v)).result };
    const vault=new Vault(args.directory,protector); await vault.initialize();
    const key=crypto.generateKeyPairSync('ed25519'), pub=Buffer.from(key.publicKey.export({format:'jwk'}).x,'base64url').toString('base64'), device=deviceId(pub);
    await vault.change((v)=> { v.devices[device]={id:device,publicKey:pub,name:'Public-audio verification client'}; });
    voice=new Voice(vault,speech); await voice.initialize();
    devices=new DeviceService(vault,{capability:()=>({id:'text',status:'unloaded'})},{forget:async()=>{}},{voice,port:0,host:'127.0.0.1',advertise:false}); await devices.initialize(); await devices.start();
    async function run(pcm,realtime) {
      const id=crypto.randomUUID(),route=`/v1/voice/live/${id}`,nonce=crypto.randomBytes(32).toString('base64url'); devices.nonces.set(nonce,Date.now()+30000);
      const signature=crypto.sign(null,Buffer.from(canonical(device,'GET',route,nonce,'')),key.privateKey).toString('base64');
      const ws=new WebSocket(`wss://127.0.0.1:${devices.port}${route}`,{rejectUnauthorized:false,agent:false,finishRequest:(req)=> { req.on('socket',(socket)=>socket.once('secureConnect',()=> { if(fingerprint(socket.getPeerCertificate().raw)!==devices.pin)req.destroy(new Error('Pin mismatch'));else req.end(); })); },headers:{'x-journal-version':'1','x-journal-device':device,'x-journal-nonce':nonce,'x-journal-signature':signature}});
      let ready=false,result,failed,firstTextMs; const begin=performance.now(),segments=[];
      ws.on('message',(raw)=> { const e=JSON.parse(raw); if(e.type==='ready')ready=true; if(e.type==='error')failed=e; if(e.type==='segment'){ firstTextMs??=Math.round(performance.now()-begin); segments.push({...e.segment,receivedMs:Math.round(performance.now()-begin)}); } if(e.type==='job')result=e.job; });
      await once(ws,'open'); while(!ready&&!failed)await delay(10); if(failed)throw new Error(JSON.stringify(failed));
      let seq=0;
      for(let at=0;at<pcm.length;at+=3200){ const chunk=pcm.subarray(at,at+3200),frame=Buffer.alloc(chunk.length+4);frame.writeUInt32BE(seq++);chunk.copy(frame,4);ws.send(frame);await delay(realtime?100:1); }
      const inputEndedMs=Math.round(performance.now()-begin);
      ws.send(JSON.stringify({type:'finish',frames:seq,bytes:pcm.length,sha256:crypto.createHash('sha256').update(pcm).digest('hex')}));
      const deadline=Date.now()+120000;while(!result&&!failed&&Date.now()<deadline)await delay(25);if(failed||!result)throw new Error(JSON.stringify(failed||'timeout'));
      await voice.ack(device,id);return {state:result.state,text:result.segments?.map((s)=>s.text.trim()).join(' '),audioSeconds:pcm.length/32000,firstTextMs,inputEndedMs,finishedMs:Math.round(performance.now()-begin),segments};
    }
    const pcm=wavPcm(await fs.readFile(args.audio)); evidence.realtimePublicSpeech=await run(Buffer.concat([pcm,Buffer.alloc(32000)]),true);
    const repeats = Number(args.repeat || 1);
    if (!Number.isInteger(repeats) || repeats < 1 || repeats > 6) throw new Error('repeat must be between 1 and 6');
    evidence.repeatedSpeechSessions = [evidence.realtimePublicSpeech];
    for (let n = 1; n < repeats; n++) {
      while(voice.connections.size)await delay(10);
      const repeated = await run(Buffer.concat([pcm,Buffer.alloc(32000)]),true);
      evidence.repeatedSpeechSessions.push(repeated);
      if (repeated.state !== 'completed' || !/country can do for you/i.test(repeated.text)) throw new Error(`Speech repetition ${n + 1} failed`);
      console.log(`Speech session ${n + 1}/${repeats} completed`);
    }
    while(voice.connections.size)await delay(10);
    evidence.silence=await run(Buffer.alloc(32000*2),false);
    if (repeats > 1) {
      await delay(12000);
      evidence.readinessAfterRepeatedSessionsAndIdle = {writing:runtime.state.status,speech:speech.capability().status};
      if(runtime.state.status !== 'ready' || speech.capability().status !== 'ready') throw new Error('Model readiness was lost after consecutive speech sessions');
    }
    evidence.diaryQuestion = await runtime.generate(JSON.stringify({action:'question', turns:[{speaker:'user',text:'I walked home through the market today. I felt calm.'}]}), {operation:'diary.conversation',job:true});
    evidence.diaryDraft = await runtime.generate(JSON.stringify({action:'draft', turns:[{speaker:'user',text:'I walked home through the market today. I felt calm.'},{speaker:'assistant',text:'Did you meet your sister at a party?'}]}), {operation:'diary.conversation',job:true});
    evidence.peakProcessRssMB=process.resourceUsage().maxRSS/1024;
    evidence.note='Real QVAC + TLS/WebSocket + macOS safeStorage with public speech. This is not physical Android microphone or mixed-language accuracy evidence.';
    if (!evidence.diaryDraft.ok || /sister|party/i.test(evidence.diaryDraft.text) || !evidence.diaryQuestion.ok) throw new Error('Conversation verification failed');
    if(evidence.realtimePublicSpeech.state!=='completed'||!evidence.realtimePublicSpeech.text?.match(/country can do for you/i)||evidence.silence.text)throw new Error('Real speech/silence verification failed');
    await fs.writeFile(path.join(args.directory,'evidence.json'),JSON.stringify(evidence,null,2)); console.log(JSON.stringify(evidence,null,2));
  } catch(e) { console.error(e.stack||e);process.exitCode=1; }
  finally { await devices?.stop();await voice?.shutdown();await runtime?.shutdown();app.exit(process.exitCode||0); }
});
