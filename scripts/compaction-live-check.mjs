/** Real-provider compaction of synthetic history only, using an isolated session. */
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAgentSession} from '../vendor/node_modules/pzero-operator/dist/core/sdk.js';
import {DefaultResourceLoader} from '../vendor/node_modules/pzero-operator/dist/core/resource-loader.js';
import {SettingsManager} from '../vendor/node_modules/pzero-operator/dist/core/settings-manager.js';
import {SessionManager} from '../vendor/node_modules/pzero-operator/dist/core/session-manager.js';
import {AuthStorage} from '../vendor/node_modules/pzero-operator/dist/core/auth-storage.js';
import {ModelRegistry} from '../vendor/node_modules/pzero-operator/dist/core/model-registry.js';
const root=await mkdtemp(join(tmpdir(),'operator-compaction-live-035-'));
const authStorage=AuthStorage.create(join(homedir(),'.opr/agent/auth.json'));
const modelRegistry=new ModelRegistry(authStorage,join(homedir(),'.opr/agent/models.json'));
const model=modelRegistry.find('alem-ai','qwen3-8');
assert.equal(model.contextWindow,258000);
assert.ok(modelRegistry.hasConfiguredAuth(model),'Qwen provider key is required');
const settingsManager=SettingsManager.inMemory({compaction:{enabled:true,keepRecentTokens:1000},retry:{enabled:false}});
const resourceLoader=new DefaultResourceLoader({cwd:root,agentDir:root,settingsManager,noExtensions:true,noSkills:true,
  noPromptTemplates:true,noThemes:true,noContextFiles:true,systemPrompt:'Follow the user request exactly. Preserve constraints and synthetic test markers.'});
await resourceLoader.reload();
const manager=SessionManager.create(root,join(root,'sessions'));
manager.appendModelChange(model.provider,model.id);
manager.appendMessage({role:'user',content:[{type:'text',text:'Synthetic goal: prepare a report about classroom attendance. Marker: ATTENDANCE_035. Never delete or modify original files. We already counted 24 students. Remember this goal and constraint.'}],timestamp:Date.now()-10000});
for(let i=0;i<8;i++)manager.appendMessage({role:'assistant',provider:model.provider,model:model.id,api:model.api,
  stopReason:'stop',content:[{type:'text',text:`Step ${i}: inspected a synthetic classroom report. Count stays 24. `+'Repeated synthetic notes about attendance. '.repeat(180)}],
  timestamp:Date.now()-9000+i,usage:{input:5000,output:100,cacheRead:0,cacheWrite:0,totalTokens:5100,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});
manager.appendMessage({role:'user',content:[{type:'text',text:'Continue preparing the report. Preserve ATTENDANCE_035 and the no-delete constraint.'}],timestamp:Date.now()-1000});
const {session}=await createAgentSession({cwd:root,agentDir:root,settingsManager,resourceLoader,authStorage,modelRegistry,model,
  noTools:'all',sessionManager:manager});
const started=Date.now();
let timer;
try{
  console.log('Checking real Qwen compaction of synthetic history; no tools or personal files');
  const result=await session.compact();
  assert.match(result.summary,/ATTENDANCE_035/);
  assert.ok(result.estimatedTokensAfter>0);
  assert.equal(session.isCompacting,false);
  const mode=result.details?.recovery==='local'?'local-recovery':'provider-summary';
  console.log(`PASS ${mode}; ${Date.now()-started}ms; context ${result.estimatedTokensAfter}/258000`);
  timer=setTimeout(()=>session.abort(),60000);
  await session.prompt('Return only the preserved synthetic marker and the student count from our history, on one line.');
  const response=session.messages.filter(m=>m.role==='assistant').at(-1);
  assert.equal(response.stopReason,'stop','Provider did not complete the continuation');
  const answer=response.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
  assert.match(answer,/ATTENDANCE_035/);assert.match(answer,/24/);
  const evidence={version:'0.3.5',model:model.id,contextWindow:model.contextWindow,mode,elapsedMs:Date.now()-started,
    estimatedTokensAfter:result.estimatedTokensAfter,continued:true,markerPreserved:true,originalHistoryRetained:true};
  await writeFile(join(root,'result.json'),JSON.stringify(evidence,null,2));
  console.log('PASS real Qwen continuation after compaction. Evidence:',join(root,'result.json'));
}finally{clearTimeout(timer);session.dispose();}
