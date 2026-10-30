const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {spawnSync}=require('node:child_process');
const root=path.join(__dirname,'../..');

test('Pages juridiques publiques, liées dans le pied de page, sans authentification',()=>{
  const result=spawnSync(process.execPath,['scripts/build-homepage.cjs'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
  assert.match(html,/href="\/privacy"/);
  assert.match(html,/href="\/terms"/);
  assert.match(html,/src="\/legal\.js"/);
  assert.ok(!/gmail/i.test(html));
  const legal=fs.readFileSync(path.join(root,'public/legal.js'),'utf8');
  for(const phrase of ['Politique de confidentialité','Conditions générales d’utilisation','gmail.send','Limited Use','À compléter','openid','AES-256-GCM','DECARBOTECH SARL','1953399W','loi organique n° 2004-63','kameltalbi.tn@gmail.com'])assert.match(legal,new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  const live=fs.readFileSync(path.join(root,'public/live.js'),'utf8');
  assert.match(live,/legalPages\.has\(location\.pathname\)/);
  assert.match(live,/legalPages\.has\(path\)\)\{renderLegalPage\(path\);return;\}/);
  const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
  assert.match(server,/app\.get\(\/\^\\\/app\(\?:\\\/\|\$\)\//);
  assert.match(server,/app\.get\('\*',\(_req,res\)=>res\.sendFile/);
  const worker=fs.readFileSync(path.join(root,'public/sw.js'),'utf8');
  assert.match(worker,/\/legal\.js/);
});
