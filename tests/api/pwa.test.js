const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {spawnSync}=require('node:child_process');
const root=path.join(__dirname,'../..');
function pngSize(file){const buf=fs.readFileSync(file);assert.equal(buf.toString('ascii',1,4),'PNG');return {width:buf.readUInt32BE(16),height:buf.readUInt32BE(20)};}

test('PWA : manifeste, icônes et service worker sans cache des données privées',()=>{
  const result=spawnSync(process.execPath,['scripts/build-homepage.cjs'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
  assert.match(html,/rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html,/src="\/pwa\.js"/);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'public/manifest.webmanifest'),'utf8'));
  assert.equal(manifest.start_url,'/connexion');
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.theme_color,'#013BE5');
  assert.ok(manifest.icons.some(icon=>icon.sizes==='192x192'&&icon.purpose==='any'));
  assert.ok(manifest.icons.some(icon=>icon.sizes==='512x512'&&icon.purpose==='maskable'));
  for (const [file,size] of [['pwa-192.png',192],['pwa-512.png',512],['pwa-maskable-192.png',192],['pwa-maskable-512.png',512]]) {
    const dim=pngSize(path.join(root,'public/assets',file));
    assert.equal(dim.width,size);assert.equal(dim.height,size);
  }
  const worker=fs.readFileSync(path.join(root,'public/sw.js'),'utf8');
  assert.match(worker,/addEventListener\('fetch'/);
  assert.match(worker,/pathname\.startsWith\('\/api\/'\)/);
  const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
  assert.match(server,/\/manifest\.webmanifest/);
  assert.match(server,/application\/manifest\+json/);
});
