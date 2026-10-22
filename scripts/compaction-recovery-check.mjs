/** Isolated synthetic providers: no network, model credentials or user sessions. */
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAgentSession} from '../vendor/node_modules/pzero-operator/dist/core/sdk.js';
import {DefaultResourceLoader} from '../vendor/node_modules/pzero-operator/dist/core/resource-loader.js';
import {SettingsManager} from '../vendor/node_modules/pzero-operator/dist/core/settings-manager.js';
import {SessionManager} from '../vendor/node_modules/pzero-operator/dist/core/session-manager.js';
import {AuthStorage} from '../vendor/node_modules/pzero-operator/dist/core/auth-storage.js';
import {ModelRegistry} from '../vendor/node_modules/pzero-operator/dist/core/model-registry.js';
import {calculateContextTokens} from '../vendor/node_modules/pzero-operator/dist/core/compaction/index.js';
import {withSummaryDeadline} from '../vendor/node_modules/pzero-operator/dist/core/compaction/recovery.js';
import {createAssistantMessageEventStream} from '../vendor/node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js';

const cwd=await mkdtemp(join(tmpdir(),'operator-compaction-035-'));
const authStorage=AuthStorage.inMemory({'alem-ai':{type:'api_key',key:'fixture-only'}});
const modelRegistry=new ModelRegistry(authStorage,join(cwd,'models.json'));
const model=modelRegistry.find('alem-ai','qwen3-8');
assert.equal(model.contextWindow,258000);
assert.equal(calculateContextTokens({input:200000,output:100}),200100);
assert.equal(calculateContextTokens(undefined),0);
const text=value=>[{type:'text',text:value}];
const answer=(stopReason,content,input=1000)=>({role:'assistant',api:model.api,provider:model.provider,model:model.id,
  timestamp:Date.now(),stopReason,content,usage:{input,output:30,cacheRead:0,cacheWrite:0,totalTokens:input+30,
    cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});
const stream=message=>{const result=createAssistantMessageEventStream();
  result.push(message.stopReason==='error'||message.stopReason==='aborted'
    ?{type:'error',reason:message.stopReason,error:message}:{type:'done',reason:message.stopReason,message});return result;};

async function run(mode){
  let calls=0,summaries=0,requests=0;
  const settingsManager=SettingsManager.inMemory({compaction:{enabled:true},retry:{enabled:false}});
  const resourceLoader=new DefaultResourceLoader({cwd,agentDir:cwd,settingsManager,noExtensions:true,noSkills:true,
    noPromptTemplates:true,noThemes:true,noContextFiles:true,systemPrompt:'Finish the authorized task. Never repeat completed actions.'});
  await resourceLoader.reload();
  const manager=SessionManager.inMemory(cwd);
  const original=[];
  for(let i=0;i<12;i++){
    const user={role:'user',content:text(`OLD_GOAL_${i}: prepare the report. Never delete files.`),timestamp:Date.now()-10000+i*2};
    const response={...answer('stop',text('Historical completed work. '.repeat(1600)),170000),timestamp:Date.now()-9999+i*2};
    manager.appendMessage(user);manager.appendMessage(response);original.push(JSON.stringify(user),JSON.stringify(response));
  }
  const {session}=await createAgentSession({cwd,agentDir:cwd,settingsManager,resourceLoader,authStorage,modelRegistry,model,
    sessionManager:manager,noTools:true,customTools:[{name:'probe',label:'Probe',description:'Synthetic step only',
      parameters:{type:'object',properties:{},additionalProperties:false},execute:async()=>{calls++;return{content:text('STEP_DONE_'+calls)};}}]});
  const events=[];
  session.subscribe(event=>{events.push(event);if(event.type==='compaction_start'&&mode==='cancel')void session.abort();});
  session.agent.streamFn=(m,context,options)=>{
    if(!context.tools){
      summaries++;
      assert.equal(options.reasoning,'off');assert.ok(options.maxTokens<=4096);
      assert.ok(JSON.stringify(context).length<100000,'Summary input must be bounded');
      if(mode==='hang')return{result:()=>new Promise(()=>{})};
      if(mode==='empty')return stream(answer('stop',[]));
      if(mode==='length')return stream(answer('length',text('unfinished checkpoint')));
      if(mode==='failure')return stream({...answer('error',[]),errorMessage:'Connection error'});
      return stream(answer('stop',text('Goal: run exactly three probes. Never delete files. Resume from retained results.')));
    }
    requests++;
    if(requests<=3)return stream(answer('toolUse',[{type:'toolCall',id:`${mode}-${requests}`,name:'probe',arguments:{}}],requests===2?210000:1000));
    assert.ok(context.messages.some(message=>JSON.stringify(message).includes('compacted')),'Compacted state must reach next request');
    return stream(answer('stop',text('TASK_FINISHED')));
  };
  const started=Date.now();
  try{
    await session.prompt('Run exactly three probes, then answer TASK_FINISHED. Never delete files.');
    const ended=events.filter(e=>e.type==='compaction_end');
    if(mode==='cancel'){
      assert.ok(ended.some(e=>e.aborted));assert.ok(!ended.some(e=>e.result));assert.ok(calls<3);
    }else{
      assert.equal(calls,3,'Never replay completed tools');assert.equal(requests,4);assert.equal(summaries,1);
      assert.equal(ended.length,1);assert.ok(ended[0].result);assert.equal(ended[0].willRetry,true);
      assert.ok(ended[0].result.estimatedTokensAfter>0);assert.ok(ended[0].result.estimatedTokensAfter<model.contextWindow*.8);
      assert.equal(ended[0].result.details.recovery,mode==='normal'?undefined:'local');
      assert.match(JSON.stringify(session.messages.at(-1)),/TASK_FINISHED/);
      assert.ok(session.getContextUsage().tokens>0);
      const saved=manager.getEntries().filter(entry=>entry.type==='message').map(entry=>JSON.stringify(entry.message));
      for(const message of original)assert.ok(saved.includes(message),'Original history must be preserved');
      assert.equal(session.isCompacting,false);
    }
    console.log(`PASS ${mode}: early compaction at 210k/258k, ${calls} tools, ${summaries} summary request(s), ${Date.now()-started}ms`);
  }finally{session.dispose();}
}

await assert.rejects(withSummaryDeadline(()=>new Promise(()=>{}),undefined,20),/timed out/);
const abort=new AbortController();abort.abort();
await assert.rejects(withSummaryDeadline(()=>new Promise(()=>{}),abort.signal,20),e=>e.name==='AbortError');
console.log('PASS hard deadline and pre-aborted cancellation');
for(const mode of ['normal','empty','length','failure','cancel','hang'])await run(mode);
console.log('PASS compaction 0.3.5: deadline, recovery, automatic continuation, cancellation and preserved history');
