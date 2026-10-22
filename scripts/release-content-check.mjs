/** Ensure both distributables contain the reviewed core and Desktop runtime. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {extractFile} from '@electron/asar';
import yaml from 'js-yaml';

const version=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version;
const root=new URL(`../release/${version}/`,import.meta.url).pathname;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const coreFiles=['core/agent-session.js','core/model-registry.js','core/compaction/compaction.js',
  'core/compaction/recovery.js','core/tools/read-full.js'];
const bridgeFiles=['command-policy.mjs','tool-discovery.mjs','mcp.mjs','desk-bridge.mjs'];
const results=[];
for(const platform of ['linux','win']){
  const resources=join(root,`${platform}-unpacked/resources`);
  const asar=join(resources,'app.asar');
  const info=JSON.parse(extractFile(asar,'package.json').toString());
  assert.equal(info.version,version);
  for(const file of coreFiles){
    const actual=await readFile(join(resources,'operator/node_modules/pzero-operator/dist',file));
    const expected=await readFile(new URL(`../vendor/node_modules/pzero-operator/dist/${file}`,import.meta.url));
    assert.equal(hash(actual),hash(expected),`${platform}/${file}`);
  }
  for(const file of bridgeFiles){
    assert.equal(hash(await readFile(join(resources,'app.asar.unpacked/dist-electron/bridge',file))),
      hash(await readFile(new URL(`../electron/bridge/${file}`,import.meta.url))),`${platform}/${file}`);
  }
  for(const file of ['dist-electron/main.js','dist-electron/preload.cjs','dist/index.html']){
    assert.equal(hash(extractFile(asar,file)),hash(await readFile(new URL(`../${file}`,import.meta.url))),`${platform}/${file}`);
  }
  results.push({platform,version,reviewedCoreAndBridge:true,asarSha256:hash(await readFile(asar))});
}
const core=await readFile(new URL('../vendor/node_modules/pzero-operator/dist/core/agent-session.js',import.meta.url),'utf8');
assert.match(core,/Math\.ceil\(window \* 0\.2\)/,'Production must keep the 20% reserve');
for(const name of ['latest.yml','latest-linux.yml']){
  const feed=yaml.load(await readFile(join(root,name),'utf8'));assert.equal(feed.version,version);
  for(const file of feed.files){
    const bytes=await readFile(join(root,file.url));
    assert.equal(bytes.length,file.size);
    assert.equal(createHash('sha512').update(bytes).digest('base64'),file.sha512);
  }
}
await writeFile(new URL(`../outputs/release-content-${version}.json`,import.meta.url),JSON.stringify({passed:true,results},null,2));
console.log('PASS Linux/Windows reviewed core, 80% threshold, bridges, application version and feed checksums');
