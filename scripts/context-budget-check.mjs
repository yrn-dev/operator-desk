/** No model or server launches: cached tool metadata and temporary file fixtures only. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {createToolDiscovery} from '../electron/bridge/tool-discovery.mjs';
import {connectMcpServer} from '../electron/bridge/mcp.mjs';
import {createReadFullToolDefinition} from '../vendor/node_modules/pzero-operator/dist/core/tools/read-full.js';

const root=await fs.mkdtemp(join(tmpdir(),'operator-context-budget-035-'));
const tools=new Map();let active=[];
const api={registerTool:tool=>{tools.set(tool.name,tool);active.push(tool.name);},getAllTools:()=>[...tools.values()],
  getActiveTools:()=>active,setActiveTools:names=>{active=names;}};
const discovery=createToolDiscovery(api);
const config=join(homedir(),'.config/operator-desk');
let disabled=[];
try{disabled=JSON.parse(await fs.readFile(join(config,'plugins.json'),'utf8')).disabled??[];}catch{}
let files=[];try{files=await fs.readdir(join(config,'plugins-data/tools'));}catch{}
let previouslyEagerChars=0,previouslyEagerTools=0,totalTools=0;
for(const file of files.filter(file=>file.endsWith('.json')&&!disabled.includes(file.slice(0,-5)))){
  const name=file.slice(0,-5);
  const raw=JSON.parse(await fs.readFile(join(config,'plugins-data/tools',file),'utf8')).tools??[];
  const definitions=raw.map(tool=>({name:`${name}__${tool.name}`.replace(/[^a-zA-Z0-9_]/g,'_'),
    description:tool.description??tool.name,parameters:tool.inputSchema}));
  const size=JSON.stringify(raw).length;
  if(size<=24000){previouslyEagerChars+=size;previouslyEagerTools+=raw.length;}
  for(const definition of definitions)api.registerTool(definition);
  discovery.register(name,definitions);totalTools+=definitions.length;
}
// Also verify the actual MCP connector defers a tiny cached server and does not launch it.
const cacheFile=join(root,'fixture-tools.json');
const command='do-not-launch-fixture';
const fingerprint=crypto.createHash('sha256').update(JSON.stringify([command,[],[]])).digest('hex').slice(0,16);
await fs.writeFile(cacheFile,JSON.stringify({fingerprint,tools:[{name:'echo',description:'Small fixture',inputSchema:{type:'object',properties:{}}}]}));
const server=await connectMcpServer(api,'tiny',{command,args:[],cacheFile,discovery});
try{
  assert.equal(server.running,false);
  const catalog=discovery.beforePrompt();
  assert.ok(catalog.includes('tiny'));
  assert.deepEqual(active,['tool_search']);
  const search=tools.get('tool_search');
  await search.execute('fixture',{query:'tiny__echo'});
  assert.deepEqual(active,['tool_search','tiny__echo']);
  discovery.beforePrompt();assert.deepEqual(active,['tool_search','tiny__echo']);
  const fixture=join(root,'large.txt');
  const content=Array.from({length:6000},(_,index)=>`LINE_${String(index).padStart(5,'0')} ${'data '.repeat(18)}`).join('\n');
  await fs.writeFile(fixture,content);
  const reader=createReadFullToolDefinition(root);
  const first=await reader.execute('read',{path:fixture});
  assert.equal(first.details.truncation.maxBytes,65536);
  assert.ok(first.details.nextOffset>1);
  const next=await reader.execute('next',{path:fixture,offset:first.details.nextOffset});
  assert.ok(next.content[0].text.startsWith(`LINE_${String(first.details.nextOffset-1).padStart(5,'0')}`));
  const larger=await reader.execute('larger',{path:fixture,maxBytes:131072});
  assert.ok(larger.content[0].text.length>first.content[0].text.length);
  assert.equal(await fs.readFile(fixture,'utf8'),content);
  const evidence={version:'0.3.5',cachedMcpTools:totalTools,previouslyEagerTools,previouslyEagerSchemaCharacters:previouslyEagerChars,
    idleMcpSchemas:0,selectedSchemas:1,readFullDefaultBytes:65536,continuedReadVerified:true,originalFilesUnchanged:true};
  const evidenceFile=new URL('../outputs/context-budget-0.3.5.json',import.meta.url);
  await fs.mkdir(new URL('../outputs/',import.meta.url),{recursive:true});
  await fs.writeFile(evidenceFile,JSON.stringify(evidence,null,2));
  console.log('PASS',JSON.stringify(evidence));console.log('Evidence:',evidenceFile.pathname);
}finally{server.stop();await fs.rm(root,{recursive:true,force:true});}
