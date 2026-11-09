/** Verify a clean upstream package receives exactly the reviewed local fixes. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const archive=process.argv[2];
assert.ok(archive,'Pass an upstream pzero-operator-1.2.3.tgz path');
const cwd=await fs.mkdtemp(join(tmpdir(),'operator-core-overrides-'));
const pkg=join(cwd,'vendor/node_modules/pzero-operator');await fs.mkdir(pkg,{recursive:true});
execFileSync('tar',['-xzf',archive,'-C',pkg,'--strip-components=1']);
const script=fileURLToPath(new URL('./bundle-operator.mjs',import.meta.url));
const env={...process.env};delete env.OPERATOR_SOURCE;delete env.OPERATOR_VERSION;
const run=()=>execFileSync(process.execPath,[script],{cwd,env,stdio:'pipe'});
run();run();
const manifest=JSON.parse(await fs.readFile(new URL('../core-overrides/manifest.json',import.meta.url),'utf8'));
for(const entry of manifest.files){const bytes=await fs.readFile(join(pkg,'dist',entry.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);}
await fs.appendFile(join(pkg,'dist',manifest.files[0].path),'\n// Unreviewed change\n');
assert.throws(run,/reviewed patch/);
console.log(`PASS ${manifest.files.length} upstream overrides, repeatable builds, checksum validation and foreign-change rejection`);
