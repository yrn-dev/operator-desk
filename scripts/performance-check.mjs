/** Offline regression tests: requests, tool retention, context and recovery. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AuthStorage} from '../vendor/node_modules/pzero-operator/dist/core/auth-storage.js';
import {ModelRegistry} from '../vendor/node_modules/pzero-operator/dist/core/model-registry.js';
import {SettingsManager} from '../vendor/node_modules/pzero-operator/dist/core/settings-manager.js';
import {DefaultResourceLoader} from '../vendor/node_modules/pzero-operator/dist/core/resource-loader.js';
import {SessionManager} from '../vendor/node_modules/pzero-operator/dist/core/session-manager.js';
import {createAgentSession} from '../vendor/node_modules/pzero-operator/dist/core/sdk.js';
import {prepareRuntimeContext,inspectProgress} from '../vendor/node_modules/pzero-operator/dist/core/runtime-context.js';
import {registerApiProvider} from '../vendor/node_modules/@earendil-works/pi-ai/dist/compat.js';
import {createAssistantMessageEventStream} from '../vendor/node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js';
import {createToolDiscovery} from '../electron/bridge/tool-discovery.mjs';

const root=mkdtempSync(join(tmpdir(),'operator-performance-check-'));
const authStorage=AuthStorage.inMemory({'alem-ai':{type:'api_key',key:'fixture-only'}});
await fs.writeFile(join(root,'models.json'),JSON.stringify({providers:{'alem-ai':{
  baseUrl:'http://127.0.0.1:1/v1',compat:{supportsDeveloperRole:false},
  modelOverrides:{'qwen3-8':{name:'Override verified',maxTokens:8192}},
}}}));
const modelRegistry=new ModelRegistry(authStorage,join(root,'models.json'));
const model=modelRegistry.find('alem-ai','qwen3-8');
assert.equal(model.baseUrl,'http://127.0.0.1:1/v1');
assert.equal(model.name,'Override verified');assert.equal(model.maxTokens,8192);
assert.equal(model.reasoning,true);assert.equal(model.compat.thinkingFormat,'qwen-chat-template');
assert.equal(model.compat.supportsDeveloperRole,false);
async function create(customTools=[]){
  const settingsManager=SettingsManager.inMemory({retry:{enabled:false}});
  const resourceLoader=new DefaultResourceLoader({cwd:root,agentDir:root,settingsManager,noExtensions:true,noSkills:true,noContextFiles:true,noThemes:true,noPromptTemplates:true});
  await resourceLoader.reload();
  return (await createAgentSession({cwd:root,agentDir:root,settingsManager,resourceLoader,model,modelRegistry,authStorage,
    sessionManager:SessionManager.inMemory(root),...(customTools.length?{noTools:true}:{tools:[]}),customTools})).session;
}
const session=await create();
try{
  assert.equal(session.thinkingLevel,'off');
  for(const enabled of [false,true]){
    session.setThinkingLevel(enabled?'medium':'off');
    let packet;
    session.agent.onPayload=p=>{packet=p;throw new Error('Offline capture: do not send');};
    await session.prompt('Synthetic request only.');
    assert.equal(packet.chat_template_kwargs.enable_thinking,enabled);
    assert.equal(packet.max_completion_tokens??packet.max_tokens,8192);
  }
}finally{session.dispose();}
console.log('PASS real SDK packet: provider/model overrides, default Off, thinking On/Off, output cap');

const tools=new Map();let active=[];
const api={registerTool:t=>{tools.set(t.name,t);active.push(t.name);},getAllTools:()=>[...tools.values()],getActiveTools:()=>active,setActiveTools:n=>{active=n;}};
const discovery=createToolDiscovery(api);
const definitions=Array.from({length:12},(_,i)=>({name:`fixture__tool${i}`,description:'fixture',parameters:{type:'object',properties:{}}}));
for(const t of definitions)api.registerTool(t);
discovery.register('fixture',definitions);discovery.beforePrompt();assert.deepEqual(active,['tool_search']);
const search=tools.get('tool_search');
await search.execute('a',{query:'fixture__tool0'});await search.execute('b',{query:'fixture__tool1'});
assert.ok(active.includes('fixture__tool0')&&active.includes('fixture__tool1'));
await search.execute('none',{query:'not_found_xyz'});discovery.beforePrompt();assert.ok(active.includes('fixture__tool0'));
for(let i=2;i<12;i++)await search.execute('next',{query:`fixture__tool${i}`});
assert.ok(active.length<=7);assert.ok(!active.includes('fixture__tool0'));assert.ok(active.includes('fixture__tool11'));
console.log('PASS discovery: tools retained across searches/prompts, bounded eviction, misses preserve selection');

const messages=[{role:'user',content:[{type:'text',text:'Keep this goal and restriction.'}]}];
const huge='Important result.\n'+'line\n'.repeat(18000)+'END_OF_ORIGINAL';
for(let i=0;i<12;i++){
  messages.push({role:'assistant',content:[{type:'toolCall',id:`read-${i}`,name:'read',arguments:{path:`file${i}`}}]});
  messages.push({role:'toolResult',toolName:'read',toolCallId:`read-${i}`,content:[{type:'text',text:huge}],isError:false});
}
const original=JSON.stringify(messages);const view=prepareRuntimeContext({messages,tools:[],systemPrompt:'Rules'});
assert.equal(JSON.stringify(messages),original);assert.equal(view.context.messages.at(-1).content[0].text,huge);
const excerpt=view.context.messages[2].content[0].text;
assert.ok(excerpt.length<4000);const file=excerpt.match(/Full original: (.*); read/)[1];assert.equal(await fs.readFile(file,'utf8'),huge);
assert.ok(JSON.stringify(view.context.messages).length<original.length*.8);
assert.equal(view.context.messages[0].content[0].text,'Keep this goal and restriction.');
assert.equal(inspectProgress(messages).stalled,false,'Distinct file reads are useful progress');
const thoughtHistory=[{role:'assistant',content:[{type:'thinking',thinking:'old internal work'},{type:'text',text:'Verified result'}]}];
const lean=prepareRuntimeContext({messages:thoughtHistory,tools:[],systemPrompt:'Rules'},{omitThinking:true});
assert.equal(lean.context.messages[0].content.length,1);assert.equal(thoughtHistory[0].content.length,2);
assert.equal(prepareRuntimeContext({messages:thoughtHistory,tools:[],systemPrompt:'Rules'}).context.messages[0].content.length,2);
console.log('PASS context: old output bounded and retrievable, last eight full results and history preserved');

const stream=message=>{const result=createAssistantMessageEventStream();result.push({type:'done',reason:message.stopReason,message});return result;};
for(const fail of [true,false]){
  let count=0,requests=0,finalOnly=false;
  const probe={name:'probe',label:'Probe',description:'Synthetic regression tool',parameters:{type:'object',properties:{},additionalProperties:false},
    execute:async()=>{count++;return{content:[{type:'text',text:fail?'Same unavailable prerequisite':`Useful step ${count}`}],isError:fail};}};
  const s=await create([probe]);
  const mock=(_model,context)=>{
    requests++;
    if(context.tools.length===0){finalOnly=true;assert.match(context.systemPrompt,/no observable progress/);}
    const finished=finalOnly||count===30;
    return stream({role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),stopReason:finished?'stop':'toolUse',
      usage:{input:100,output:10,cacheRead:0,cacheWrite:0,totalTokens:110,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},
      content:finished?[{type:'text',text:fail?'Blocked by unavailable prerequisite; no completion claimed.':'All thirty useful steps complete.'}]:[{type:'toolCall',id:`probe-${requests}`,name:'probe',arguments:{}}]});
  };
  registerApiProvider({api:'openai-completions',stream:mock,streamSimple:mock},'performance-fixture');
  try{
    await s.prompt('Perform the synthetic workflow.');
    assert.equal(count,fail?6:30);assert.equal(finalOnly,fail);
    assert.equal(s.messages.at(-1).stopReason,'stop');
    if(fail){finalOnly=false;await s.prompt('New instruction: try again.');assert.equal(count,12,'New user input resumes tools');}
  }finally{s.dispose();}
}
console.log('PASS closed-loop recovery: repeated identical failures conclude honestly; 30 useful steps continue; new input resumes');
console.log('PASS performance regression suite');
