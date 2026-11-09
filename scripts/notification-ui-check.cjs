/* Production renderer + real media decoding, isolated mock agent and profile. */
const {app,BrowserWindow,protocol,net}=require('electron');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {pathToFileURL}=require('node:url');const assert=require('node:assert/strict');
const root=process.cwd();const work=fs.mkdtempSync(path.join(os.tmpdir(),'operator-notification-ui-'));
const checkOllama=process.argv.includes('--ollama');
app.setPath('userData',path.join(work,'profile'));
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
const preload=path.join(work,'preload.cjs');
fs.writeFileSync(preload,`const {contextBridge}=require('electron');const listeners={};let models=[{provider:'alem-ai',id:'qwen3-8',contextWindow:258000,reasoning:true},
{provider:'ollama',id:'gemma4:cloud',contextWindow:262144,reasoning:true,ollama:{source:'cloud',running:false,installed:true,capabilities:['vision','thinking']}},
{provider:'ollama',id:'qwen3:4b',contextWindow:32768,reasoning:true,ollama:{source:'local',running:false,installed:true,capabilities:['thinking']}}];const calls=[];
const sub=name=>callback=>{(listeners[name]??=new Set()).add(callback);return()=>listeners[name].delete(callback);};
contextBridge.exposeInMainWorld('notificationFixture',{emit:(name,event)=>{for(const cb of listeners[name]??[])cb(event);},setModels:value=>{models=value;},calls:()=>calls});
contextBridge.exposeInMainWorld('operator',{
platform:'linux',home:async()=>'/tmp/notification-fixture',open:async()=>({}),close:async()=>{},
send:async(id,command)=>{calls.push(command);return command==='get_state'?{model:{provider:'alem-ai',id:'qwen3-8',contextWindow:258000},thinkingLevel:'off'}:command==='get_available_models'?{models}:command==='get_commands'?{commands:[]}:null;},
listPlugins:async()=>[],listSessions:async()=>[],listKeys:async()=>[],getPolicy:async()=>({rules:[]}),checkReadiness:async()=>({items:[]}),usagePreference:async()=>({configured:false,enabled:false}),latestVersion:async()=>null,
initialPrompt:async()=>null,initialAttachments:async()=>[],markSession:async()=>{},respondUI:async()=>{},
onPluginIcons:sub('icons'),onBridgeAsk:sub('ask'),onBridgeSignal:sub('signal'),onEvent:sub('event'),onFatal:sub('fatal'),onExit:sub('exit')});`);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let win;
app.whenReady().then(async()=>{
 try{
  protocol.handle('app',async request=>{
   const target=path.join(root,'dist',new URL(request.url).pathname);
   const response=await net.fetch(pathToFileURL(target).href);const headers=new Headers(response.headers);
   headers.set('Content-Security-Policy',"default-src 'self' app:; style-src 'self' app: 'unsafe-inline'; img-src 'self' app: data:; font-src 'self' app: data:;");
   return new Response(response.body,{headers,status:response.status});
  });
  win=new BrowserWindow({width:1200,height:820,show:false,webPreferences:{preload,sandbox:false}});
  win.webContents.setAudioMuted(true);
  await win.loadURL('app://bundle/index.html');
  win.showInactive();
  const evaluate=code=>win.webContents.executeJavaScript(code,true).catch(error=>{console.error('Failed UI step:',code);throw error;});
  for(let i=0;i<80;i++){if(await evaluate("Boolean(document.querySelector('[title=\"Ещё\"]:not(:disabled)'))"))break;await delay(50);}
  if(checkOllama){
   const open=async()=>{await evaluate(`document.querySelector('[data-slot="model-selector-trigger"]').click()`);await delay(450);};
   await open();
   let rows=await evaluate(`Array.from(document.querySelectorAll('[role="option"]')).map(b=>({text:b.textContent,disabled:b.disabled}))`);
   assert.ok(rows.some(row=>row.text.includes('gemma4:cloud')&&row.text.includes('облачная')&&row.disabled));
   assert.ok(rows.some(row=>row.text.includes('qwen3:4b')&&row.text.includes('на устройстве')&&row.text.includes('выключен')));
   await evaluate(`document.querySelector('[data-slot="model-selector-trigger"]').click()`);await delay(250);
   await evaluate(`notificationFixture.setModels([{provider:'alem-ai',id:'qwen3-8',contextWindow:258000,reasoning:true},
    {provider:'ollama',id:'gemma4:cloud',contextWindow:262144,reasoning:true,ollama:{source:'cloud',running:true,installed:true,capabilities:['vision','thinking']}},
    {provider:'ollama',id:'new-local:latest',contextWindow:32768,reasoning:false,ollama:{source:'local',running:true,installed:true,capabilities:[]}}])`);
   await open();rows=await evaluate(`Array.from(document.querySelectorAll('[role="option"]')).map(b=>({text:b.textContent,disabled:b.disabled}))`);
   assert.ok(rows.some(row=>row.text.includes('gemma4:cloud')&&!row.disabled));assert.ok(rows.some(row=>row.text.includes('new-local:latest')&&!row.disabled));
   assert.ok(!rows.some(row=>row.text.includes('qwen3:4b')),'Removed model disappears without restarting');
   const logos=await evaluate(`Array.from(document.querySelectorAll('[data-provider-logo]')).map(el=>{const image=el.querySelector('img'),box=el.getBoundingClientRect(),draw=image.getBoundingClientRect();return {provider:el.dataset.providerLogo,loaded:image.complete&&image.naturalWidth>0,ratio:box.width/box.height,imageRatio:draw.width/draw.height,naturalRatio:image.naturalWidth/image.naturalHeight};})`);
   assert.ok(logos.some(logo=>logo.provider==='alem-ai'&&logo.loaded&&logo.ratio>4));
   assert.ok(logos.some(logo=>logo.provider==='ollama'&&logo.loaded&&logo.ratio>2.8));
   assert.ok(logos.every(logo=>Math.abs(logo.imageRatio-logo.naturalRatio)<.03),'Source images retain their natural proportions');
   fs.mkdirSync(path.join(root,'outputs'),{recursive:true});fs.writeFileSync(path.join(root,'outputs/ollama-models-preview.png'),(await win.webContents.capturePage()).toPNG());
   await evaluate(`Array.from(document.querySelectorAll('[role="option"]')).find(b=>b.textContent.includes('gemma4:cloud')).click()`);await delay(300);
   assert.ok((await evaluate(`document.querySelector('[data-slot="model-selector-trigger"]').textContent`)).includes('gemma4:cloud'));
   const calls=await evaluate('notificationFixture.calls()');assert.ok(calls.filter(c=>c==='get_available_models').length>=3);assert.ok(calls.includes('set_model'));
   await evaluate(`document.querySelector('[title="Ключи доступа"]').click()`);await delay(250);
   assert.equal(await evaluate(`document.querySelectorAll('.sheet [data-provider-logo]').length`),2);
   fs.writeFileSync(path.join(root,'outputs/provider-keys-preview.png'),(await win.webContents.capturePage()).toPNG());
   console.log('PASS Ollama picker and provider logos: separate brands, preserved proportions, refreshed models, selection and key dialog');
   win.destroy();app.exit(0);return;
  }
  await evaluate(`window.audioProof=[];const original=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){const record={src:this.src,volume:this.volume,started:false,ended:false};audioProof.push(record);this.addEventListener('ended',()=>record.ended=true,{once:true});return original.call(this).then(()=>{record.started=true;},error=>{record.error=String(error);throw error;});};void 0;`);
  const emit=async(name,event)=>{await evaluate(`notificationFixture.emit(${JSON.stringify(name)},${JSON.stringify(event)})`);await delay(70);};
  await emit('signal',{signal:{kind:'job',action:'start',id:'j1',name:'First job'}});
  await emit('signal',{signal:{kind:'job',action:'start',id:'j2',name:'Second job'}});
  assert.equal(await evaluate("document.querySelector('header').textContent.includes('2 в фоне')"),true);
  assert.equal(await evaluate("document.querySelectorAll('header animateTransform').length"),0);
  assert.equal(await evaluate("Boolean(document.querySelector('header [title*=\"First job\"] svg path[d^=\"M4.3\"]'))"),true);
  const settings=async()=>{await evaluate(`document.querySelector('[title="Ещё"]').click()`);await delay(50);await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Звуковые уведомления').click()`);await delay(80);};
  await settings();
  await evaluate(`document.querySelector('[aria-label="Прослушать: Работа завершена"]').click()`);
  await delay(1300);let proof=await evaluate('audioProof');
  assert.ok(proof[0].started&&proof[0].ended,JSON.stringify(proof));assert.match(proof[0].src,/complete.*\.wav$/);
  await evaluate(`document.querySelector('[role="dialog"] input[type=checkbox]').click()`);
  const run=async(text)=>{
    await emit('event',{id:'session-1',event:{type:'agent_start'}});
    await emit('event',{id:'session-1',event:{type:'message_start',message:{role:'assistant',content:[]}}});
    await emit('event',{id:'session-1',event:{type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text}]}}});
    await emit('event',{id:'session-1',event:{type:'agent_end',willRetry:false}});
  };
  await run('Синтетическая задача выполнена.');assert.equal((await evaluate('audioProof')).length,1,'Muted notifications stay silent');
  await evaluate(`document.querySelector('[role="dialog"] input[type=checkbox]').click()`);
  await run('Синтетическая задача выполнена.');
  await delay(1200);proof=await evaluate('audioProof');assert.equal(proof.length,2);assert.ok(proof[1].started&&proof[1].ended);
  await emit('event',{id:'session-1',event:{type:'agent_end',willRetry:false}});assert.equal((await evaluate('audioProof')).length,2);
  await run('Какой файл выбрать?');await delay(1400);proof=await evaluate('audioProof');assert.equal(proof.length,3);assert.match(proof[2].src,/attention.*\.wav$/);assert.ok(proof[2].started&&proof[2].ended);
  await evaluate(`const input=document.querySelector('#sound-volume');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'28');input.dispatchEvent(new Event('input',{bubbles:true}));`);await delay(80);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('operator.notification-sounds.v1')).volume`),.28);
  fs.mkdirSync(path.join(root,'outputs'),{recursive:true});
  fs.writeFileSync(path.join(root,'outputs/sound-settings-preview.png'),(await win.webContents.capturePage()).toPNG());
  await evaluate(`document.querySelector('[role="dialog"] input[type=checkbox]').click()`);
  await win.reload();await delay(400);await settings();
  assert.equal(await evaluate(`document.querySelector('[role="dialog"] input[type=checkbox]').checked`),false);
  assert.equal(await evaluate(`document.querySelector('#sound-volume').value`),'28');
  console.log('PASS production UI: background cloud icon, distinct decoded sounds, completion/question routing, mute, no duplicates, volume and persistence');
  console.log('Preview:',path.join(root,'outputs/sound-settings-preview.png'));
  win.destroy();app.exit(0);
 }catch(error){console.error(error);if(win&&!win.isDestroyed())win.destroy();app.exit(1);}
});
setTimeout(()=>{console.error('Notification UI check timed out');app.exit(1);},30000).unref();
