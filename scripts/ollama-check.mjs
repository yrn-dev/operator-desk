/** Isolated manifests + local HTTP fixtures, no downloads or model inference. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {installedOllamaModels,ollamaEndpoint,discoverOllamaModels} from '../vendor/node_modules/pzero-operator/dist/core/ollama-discovery.js';
import {ModelRegistry} from '../vendor/node_modules/pzero-operator/dist/core/model-registry.js';
import {AuthStorage} from '../vendor/node_modules/pzero-operator/dist/core/auth-storage.js';
import {streamSimple} from '../vendor/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js';

const root=await fs.mkdtemp(join(tmpdir(),'operator-ollama-check-'));
async function fixture(name,tag,config,namespace='library'){
  const bytes=JSON.stringify(config),digest=createHash('sha256').update(bytes).digest('hex');
  await fs.mkdir(join(root,'blobs'),{recursive:true});await fs.writeFile(join(root,'blobs',`sha256-${digest}`),bytes);
  const directory=join(root,'manifests/registry.ollama.ai',namespace,name);await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(join(directory,tag),JSON.stringify({config:{digest:`sha256:${digest}`},layers:[]}));
}
await fixture('qwen3','4b',{capabilities:['completion','thinking'],context_length:32768});
await fixture('gemma4','cloud',{capabilities:['completion','tools','vision','thinking'],context_length:262144,remote_host:'https://ollama.com'});
await fixture('custom','latest',{},'team');
const endpoint='http://127.0.0.1:11434';
const installed=installedOllamaModels(endpoint,[root]);
assert.deepEqual(installed.map(x=>x.name),['gemma4:cloud','qwen3:4b','team/custom:latest']);
assert.deepEqual(installedOllamaModels('https://remote.example',[root]),[],'Local files must not impersonate a remote server');
assert.equal(ollamaEndpoint('http://127.0.0.1:14567/v1/'),'http://127.0.0.1:14567');
assert.equal(ollamaEndpoint(undefined,{OLLAMA_HOST:'0.0.0.0:14567'}),'http://127.0.0.1:14567');
assert.throws(()=>ollamaEndpoint('https://user:password@example.com/v1'));
let mode='online';const requests=[];
const server=http.createServer(async(req,res)=>{
  requests.push(req.url);
  if(mode==='hang')return;
  if(mode==='failure'){res.writeHead(500);res.end('unavailable');return;}
  res.setHeader('content-type','application/json');
  if(req.url==='/api/tags'){
    res.end(JSON.stringify({models:mode==='empty'?[]:[{name:'gemma4:cloud'},{name:'qwen3:4b'},{name:'new-model:latest'}]}));return;
  }
  let body='';for await(const chunk of req)body+=chunk;const name=JSON.parse(body).model;
  res.end(JSON.stringify({capabilities:name==='gemma4:cloud'?['completion','tools','vision','thinking']:['completion','tools'],
    model_info:{'fixture.context_length':65536},parameters:'num_ctx 24576'}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=`http://127.0.0.1:${server.address().port}`;
const oldModels=process.env.OLLAMA_MODELS,oldHost=process.env.OLLAMA_HOST;
process.env.OLLAMA_MODELS=root;process.env.OLLAMA_HOST=address;
try{
  const registry=new ModelRegistry(AuthStorage.inMemory({}),join(root,'not-configured.json'));
  assert.equal(requests.length,0,'Startup scan must not invoke curl or block on a server');
  assert.equal(registry.getAvailable().filter(m=>m.provider==='ollama').length,3);
  assert.equal(registry.find('ollama','gemma4:cloud').ollama.running,false);
  await Promise.all([registry.refreshOllama({force:true}),registry.refreshOllama({force:true})]);
  assert.equal(requests.filter(p=>p==='/api/tags').length,1,'Concurrent refreshes coalesce');
  const cloud=registry.find('ollama','gemma4:cloud');assert.equal(cloud.ollama.running,true);assert.equal(cloud.ollama.source,'cloud');
  assert.deepEqual(cloud.input,['text','image']);assert.equal(cloud.contextWindow,24576);assert.equal(cloud.reasoning,true);
  assert.equal(cloud.baseUrl,`${address}/v1`);assert.equal(cloud.compat.maxTokensField,'max_tokens');
  let packet;
  const capture=streamSimple(cloud,{systemPrompt:'Fixture',messages:[{role:'user',content:[{type:'text',text:'test'}],timestamp:Date.now()}]},
    {apiKey:'ignored-local-fixture',maxTokens:1024,reasoning:'off',onPayload:p=>{packet=p;throw new Error('Offline payload capture');}});
  await capture.result();assert.equal(packet.reasoning_effort,'none');assert.equal(packet.max_tokens,1024);
  assert.equal(registry.find('ollama','qwen3:4b').ollama.source,'local');
  assert.ok(registry.find('ollama','new-model:latest'));assert.equal(registry.find('ollama','team/custom:latest'),undefined);
  mode='empty';await registry.refreshOllama({force:true});assert.equal(registry.getAll().filter(m=>m.provider==='ollama').length,0);
  mode='failure';await registry.refreshOllama({force:true});assert.equal(registry.getAll().filter(m=>m.provider==='ollama').length,3);
  assert.ok(registry.getAll().filter(m=>m.provider==='ollama').every(m=>m.ollama.running===false));
  mode='hang';const started=Date.now();const fallback=await discoverOllamaModels(address,[root]);
  assert.ok(Date.now()-started<2300,'An unresponsive server must not freeze model selection');assert.equal(fallback.length,3);
  assert.ok(requests.every(p=>p==='/api/tags'||p==='/api/show'),'Discovery must not download or run a model');
  console.log('PASS Ollama: installed names, local/cloud labels, native HTTP, metadata, deduplication, additions/removals, offline fallback and bounded wait');
}finally{
  if(oldModels===undefined)delete process.env.OLLAMA_MODELS;else process.env.OLLAMA_MODELS=oldModels;
  if(oldHost===undefined)delete process.env.OLLAMA_HOST;else process.env.OLLAMA_HOST=oldHost;
  server.closeAllConnections();server.close();
}
