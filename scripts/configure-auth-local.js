const fs=require('node:fs');const crypto=require('node:crypto');const {spawnSync}=require('node:child_process');
if(!fs.existsSync('.env'))throw Error('Configurez PostgreSQL et .env avant cette commande.');
let env=fs.readFileSync('.env','utf8');const append=(key,value)=>{if(!new RegExp('^'+key+'=','m').test(env))env+='\n'+key+'='+value;};
append('BETTER_AUTH_SECRET',crypto.randomBytes(48).toString('base64url'));
append('SMTP_HOST','127.0.0.1');append('SMTP_PORT','1026');append('SMTP_SECURE','false');append('MAIL_FROM','Ciblix <bonjour@ciblix.local>');
fs.writeFileSync('.env',env+'\n',{mode:0o600});
const inspect=spawnSync('docker',['inspect','ciblix-auth-mailpit'],{stdio:'ignore'});
const result=inspect.status===0?spawnSync('docker',['start','ciblix-auth-mailpit'],{stdio:'inherit'}):spawnSync('docker',['run','-d','--name','ciblix-auth-mailpit','-p','127.0.0.1:1026:1025','-p','127.0.0.1:8026:8025','axllent/mailpit:latest'],{stdio:'inherit'});
if(result.status!==0)process.exitCode=1;else console.log('Boîte de test locale : http://localhost:8026. Aucun e-mail n’est envoyé sur Internet.');
