require('dotenv').config({quiet:true});
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const {spawnSync}=require('node:child_process');
const {createDatabase}=require('../../lib/db');
const {createApp}=require('../../server');
const {createGmailProvider,SEND_SCOPE,READ_SCOPE}=require('../../lib/gmail');
const {encrypt,decrypt}=require('../../lib/gmail-crypto');
const {fixtureSession}=require('../session-fixture.cjs');

const SCOPE_FULL='openid email '+SEND_SCOPE+' '+READ_SCOPE;
const calls={send:0,refresh:0,revoke:[],exchange:[]};
const gmailGoogle={
  authorizationUrl({state,codeChallenge}){calls.lastAuth={state,codeChallenge};return 'https://accounts.google.com/o/oauth2/v2/auth?state='+encodeURIComponent(state)+'&code_challenge='+encodeURIComponent(codeChallenge);},
  async exchange({code,codeVerifier}){
    calls.exchange.push({code,codeVerifier});
    if(code==='deny-exchange')throw Object.assign(new Error('bad'),{reason:'invalid_grant',status:400,oauth:true});
    if(code==='no-identity')throw Object.assign(new Error('id'),{reason:'identity',status:403,oauth:true});
    return {access_token:'access-'+code,refresh_token:code==='boom'?'refresh-boom':'refresh-'+code,expires_in:code==='short'||code==='dead'?0:3600,scope:SCOPE_FULL,email:code.startsWith('other')?'other@gmail.com':'owner@gmail.com',sub:code.startsWith('other')?'sub-other':'sub-'+code};
  },
  async refresh(refreshToken){calls.refresh++;if(refreshToken==='refresh-dead')throw Object.assign(new Error('dead'),{reason:'invalid_grant',status:400,oauth:true});return {access_token:'access-renewed',expires_in:3600};},
  async revoke(value){calls.revoke.push(value);if(value==='refresh-boom')throw Object.assign(new Error('revoke'),{reason:'revoke_failed',status:500,oauth:true});},
  async send({raw}){calls.send++;const text=Buffer.from(raw,'base64url').toString('utf8');calls.lastText=text;if(text.includes('Subject: QUOTA'))throw Object.assign(new Error('quota'),{reason:'rateLimitExceeded',status:429,oauth:true});if(text.includes('Subject: ECHEC'))throw Object.assign(new Error('fail'),{reason:'backendError',status:500,oauth:true});return {id:'gmail-'+calls.send};}
};

let admin,db,server,base,rootPool,testDb,orgA,orgB,userA,userB,memberA,secretA,secretB,secretMember,contactA,companyA;
const key=()=>crypto.randomBytes(16).toString('hex');
async function request(path,{method='GET',body,auth=secretA,cookie=false,headers={}}={}){const response=await fetch(base+path,{method,redirect:'manual',headers:{...(auth?cookie?{cookie:'ciblix.session_token='+auth}:{authorization:'Bearer '+auth}:{}),...(body!==undefined?{'content-type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});let data;try{data=await response.json();}catch{}return {status:response.status,data,headers:response.headers};}
const v=(path,opts)=>request('/api/v1'+path,opts);
async function connect(code,auth=secretA){const start=await v('/gmail/connect',{method:'POST',auth,body:{share_consent:true}});assert.equal(start.status,200,JSON.stringify(start.data));const state=new URL(start.data.url).searchParams.get('state');const callback=await v('/gmail/callback?code='+encodeURIComponent(code)+'&state='+encodeURIComponent(state),{auth,cookie:true});return {start,state,callback};}

test('URL OAuth Gmail : PKCE, hors ligne, choix du compte et URI exacte',()=>{
  const url=new URL(createGmailProvider({gmailClientId:'gmail-client',gmailClientSecret:'gmail-secret',gmailRedirectUri:'https://ciblix.com/api/v1/gmail/callback'}).authorizationUrl({state:'abc',codeChallenge:'challenge'}));
  assert.equal(url.origin+url.pathname,'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('client_id'),'gmail-client');
  assert.equal(url.searchParams.get('redirect_uri'),'https://ciblix.com/api/v1/gmail/callback');
  assert.equal(url.searchParams.get('code_challenge'),'challenge');
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(url.searchParams.get('access_type'),'offline');
  assert.match(url.searchParams.get('prompt'),/select_account/);
  assert.match(url.searchParams.get('prompt'),/consent/);
  assert.match(url.searchParams.get('scope'),/gmail\.send/);
  assert.match(url.searchParams.get('scope'),/gmail\.readonly/);
});

test('Chiffrement des jetons indépendant du texte en clair',()=>{
  const secret='x'.repeat(40);const hidden=encrypt(secret,'access-token-secret');
  assert.equal(hidden.includes('access-token-secret'),false);
  assert.equal(decrypt(secret,hidden),'access-token-secret');
  assert.throws(()=>decrypt('y'.repeat(40),hidden));
});

before(async()=>{
  assert.ok(process.env.MIGRATION_DATABASE_URL,'Configurez la base locale avant les tests.');
  assert.ok(process.env.BETTER_AUTH_SECRET&&process.env.BETTER_AUTH_SECRET.length>=32);
  const rootUrl=new URL(process.env.MIGRATION_DATABASE_URL);
  rootPool=new Pool({connectionString:rootUrl.toString()});
  testDb='ciblix_gmail_'+crypto.randomBytes(6).toString('hex');
  await rootPool.query('CREATE DATABASE '+testDb);
  rootUrl.pathname='/'+testDb;
  const migration=rootUrl.toString();
  const result=spawnSync(process.execPath,['scripts/migrate.js'],{env:{...process.env,MIGRATION_DATABASE_URL:migration},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  admin=new Pool({connectionString:migration});
  const appUrl=new URL(process.env.DATABASE_URL);appUrl.pathname='/'+testDb;
  db=createDatabase(appUrl.toString());await db.verify();
  orgA=(await admin.query("INSERT INTO organizations(name) VALUES('Organisation A') RETURNING id")).rows[0].id;
  orgB=(await admin.query("INSERT INTO organizations(name) VALUES('Organisation B') RETURNING id")).rows[0].id;
  const addUser=async(sub,address,name)=>(await admin.query('INSERT INTO users(google_sub,email,name,email_verified) VALUES($1,$2,$3,true) RETURNING id',[sub,address,name])).rows[0].id;
  userA=await addUser('gmail-a','admin-a@example.com','Admin A');
  userB=await addUser('gmail-b','admin-b@example.com','Admin B');
  memberA=await addUser('gmail-m','membre@example.com','Membre A');
  await admin.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'admin'),($3,$4,'admin'),($1,$5,'member')",[orgA,userA,orgB,userB,memberA]);
  ({secret:secretA}=await fixtureSession(admin,userA,orgA,process.env.BETTER_AUTH_SECRET));
  ({secret:secretB}=await fixtureSession(admin,userB,orgB,process.env.BETTER_AUTH_SECRET));
  ({secret:secretMember}=await fixtureSession(admin,memberA,orgA,process.env.BETTER_AUTH_SECRET));
  server=(await createApp(db,{appUrl:'http://localhost',authRateLimit:false,disableGmailSyncLoop:true,googleClientId:'better-auth-client',googleClientSecret:'better-auth-secret-value',gmailClientId:'gmail-client',gmailClientSecret:'gmail-secret-value',gmailRedirectUri:'https://ciblix.com/api/v1/gmail/callback',gmailGoogle,mailer:{configured:true,send:async()=>{}}})).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  base='http://127.0.0.1:'+server.address().port;
  companyA=(await v('/companies',{method:'POST',body:{name:'Atelier Gmail'}})).data.id;
  contactA=(await v('/contacts',{method:'POST',body:{name:'Inès',company_id:companyA,emails:['ines@example.com']}})).data.id;
});
after(async()=>{if(server)await new Promise(r=>server.close(r));if(db)await db.pool.end();if(admin)await admin.end();if(rootPool){if(testDb)await rootPool.query('DROP DATABASE '+testDb);await rootPool.end();}});

test('Better Auth conserve son client Google et ignore le client Gmail',async()=>{
  const social=await request('/api/auth/sign-in/social',{method:'POST',auth:null,headers:{origin:'http://localhost'},body:{provider:'google',callbackURL:'/app'}});
  assert.equal(social.status,200,JSON.stringify(social.data));
  assert.match(social.data.url,/client_id=better-auth-client/);
  assert.doesNotMatch(social.data.url,/gmail-client/);
  assert.doesNotMatch(social.data.url,/gmail\.send/);
  const note=await v('/notes',{method:'POST',body:{contact_id:contactA,body:'Note toujours possible'}});
  assert.equal(note.status,201);
});

test('Connexion Gmail, jetons chiffrés et absence d’exposition',async()=>{
  assert.equal((await v('/gmail/connect',{method:'POST',body:{}})).status,400);
  const started=await v('/gmail/connect',{method:'POST',body:{share_consent:true}});
  const state=new URL(started.data.url).searchParams.get('state');
  const stored=(await admin.query('SELECT verifier_enc FROM gmail_oauth_states WHERE state_hash=$1',[require('crypto').createHash('sha256').update(state).digest('hex')])).rows[0];
  const verifier=decrypt(process.env.BETTER_AUTH_SECRET,stored.verifier_enc);
  assert.equal(stored.verifier_enc.includes(verifier),false);
  assert.equal(calls.lastAuth.codeChallenge,crypto.createHash('sha256').update(verifier).digest('base64url'));
  const callback=await v('/gmail/callback?code=ok&state='+encodeURIComponent(state),{cookie:true});
  assert.equal(callback.status,302);
  assert.match(callback.headers.get('location'),/etat=connecte/);
  assert.doesNotMatch(callback.headers.get('location'),/access-|refresh-/);
  assert.equal(calls.exchange.at(-1).codeVerifier,verifier);
  const list=await v('/gmail/accounts');
  assert.equal(list.data.configured,true);
  assert.equal(list.data.accounts.length,1);
  assert.equal(list.data.accounts[0].email,'owner@gmail.com');
  assert.equal(list.data.accounts[0].status,'active');
  assert.equal(list.data.accounts[0].isDefault,true);
  assert.equal(JSON.stringify(list.data).includes('access-ok'),false);
  const row=(await admin.query('SELECT access_token_enc,refresh_token_enc FROM gmail_accounts WHERE user_id=$1',[userA])).rows[0];
  assert.equal(row.access_token_enc.includes('access-ok'),false);
  assert.equal(decrypt(process.env.BETTER_AUTH_SECRET,row.access_token_enc),'access-ok');
  assert.equal((await v('/me')).data.gmailConnected,true);
  assert.equal((await db.pool.query('SELECT * FROM gmail_accounts')).rowCount,0);
  assert.equal((await db.tenant(orgB,c=>c.query('SELECT * FROM gmail_accounts'))).rowCount,0);
});

test('Refus, callback invalide, état expiré et réutilisation du state',async()=>{
  assert.equal((await v('/gmail/callback?code=x&state='+'a'.repeat(43),{auth:null})).status,401);
  const pendingDenial=await v('/gmail/connect',{method:'POST',body:{share_consent:true}});
  const denialState=new URL(pendingDenial.data.url).searchParams.get('state');
  const beforeDenial=(await v('/gmail/accounts')).data.accounts.length;
  const refused=await v('/gmail/callback?error=access_denied&state='+encodeURIComponent(denialState),{cookie:true});
  assert.match(refused.headers.get('location'),/etat=refuse/);
  assert.equal((await v('/gmail/accounts')).data.accounts.length,beforeDenial);
  const bad=await v('/gmail/callback?code=ok&state='+'b'.repeat(43),{cookie:true});
  assert.match(bad.headers.get('location'),/etat=invalide/);
  const pending=await v('/gmail/connect',{method:'POST',body:{share_consent:true}});
  const state=new URL(pending.data.url).searchParams.get('state');
  await admin.query('UPDATE gmail_oauth_states SET expires_at=now()-interval \'1 minute\' WHERE state_hash=$1',[crypto.createHash('sha256').update(state).digest('hex')]);
  const exchanges=calls.exchange.length;
  assert.match((await v('/gmail/callback?code=late&state='+encodeURIComponent(state),{cookie:true})).headers.get('location'),/etat=invalide/);
  assert.equal(calls.exchange.length,exchanges);
  const again=await connect('replay');
  const count=(await v('/gmail/accounts')).data.accounts.length;
  const second=await v('/gmail/callback?code=replay&state='+encodeURIComponent(again.state),{cookie:true});
  assert.match(second.headers.get('location'),/etat=invalide/);
  assert.equal((await v('/gmail/accounts')).data.accounts.length,count);
  const identity=await connect('no-identity');
  assert.match(identity.callback.headers.get('location'),/etat=identite/);
  const broken=await connect('deny-exchange');
  assert.match(broken.callback.headers.get('location'),/etat=invalide/);
});

test('Un autre utilisateur de la même organisation ne peut pas terminer le flux',async()=>{
  const start=await v('/gmail/connect',{method:'POST',body:{share_consent:true}});
  const state=new URL(start.data.url).searchParams.get('state');
  const beforeCount=(await v('/gmail/accounts')).data.accounts.length;
  const stolen=await v('/gmail/callback?code=stolen&state='+encodeURIComponent(state),{auth:secretMember,cookie:true});
  assert.match(stolen.headers.get('location'),/etat=invalide/);
  const memberList=await v('/gmail/accounts',{auth:secretMember});
  assert.equal(memberList.data.accounts.length,beforeCount);
  assert.equal(memberList.data.mine.length,0);
  assert.equal((await v('/gmail/accounts')).data.accounts.length,beforeCount);
  assert.match((await v('/gmail/callback?code=stolen&state='+encodeURIComponent(state),{cookie:true})).headers.get('location'),/etat=invalide/);
});

test('Isolation des comptes et de l’envoi entre organisations et utilisateurs',async()=>{
  const owned=await v('/gmail/accounts');
  const account=owned.data.accounts[0];
  assert.ok(account);
  assert.equal((await v('/gmail/accounts',{auth:secretB})).data.accounts.length,0);
  const memberList=await v('/gmail/accounts',{auth:secretMember});
  assert.equal(memberList.data.accounts.length,owned.data.accounts.length);
  assert.equal(memberList.data.mine.length,0);
  const foreign=await v('/gmail/messages',{method:'POST',auth:secretB,body:{account_id:account.id,contact_id:contactA,to:'ines@example.com',subject:'Interdit',body:'Non',idempotency_key:key()}});
  assert.equal(foreign.status,404);
  const colleague=await v('/gmail/messages',{method:'POST',auth:secretMember,body:{account_id:account.id,contact_id:contactA,to:'ines@example.com',subject:'Interdit',body:'Non',idempotency_key:key()}});
  assert.equal(colleague.status,404);
  assert.equal((await v('/gmail/accounts/'+account.id,{method:'DELETE',auth:secretMember})).status,404);
  assert.equal((await v('/gmail/accounts')).data.accounts.length,owned.data.accounts.length);
});

test('Envoi confirmé, échec Gmail, quota et absence d’historique prématuré',async()=>{
  const account=(await v('/gmail/accounts')).data.accounts[0].id;
  const before=calls.send;
  const sent=await v('/gmail/messages',{method:'POST',body:{account_id:account,contact_id:contactA,to:'ines@example.com',subject:'Bonjour',body:'Le message',idempotency_key:key(),attachments:[{filename:'note.txt',mime_type:'text/plain',data:Buffer.from('bonjour').toString('base64')}]}});
  assert.equal(sent.status,201,JSON.stringify(sent.data));
  assert.equal(sent.data.status,'sent');
  assert.equal(sent.data.gmailMessageId,'gmail-'+(before+1));
  assert.match(calls.lastText,/ines@example.com/);
  assert.match(calls.lastText,/note\.txt/);
  assert.equal(JSON.stringify(sent.data).includes('access-'),false);
  const history=await v('/contacts/'+contactA+'/history');
  assert.ok(history.data.items.some(item=>item.action==='sent'&&item.summary.includes('ines@example.com')&&item.summary.includes('Bonjour')));
  const failed=await v('/gmail/messages',{method:'POST',body:{account_id:account,contact_id:contactA,to:'ines@example.com',subject:'ECHEC',body:'Pas parti',idempotency_key:key()}});
  assert.equal(failed.status,502);
  assert.match(failed.data.message,/Aucun message/);
  const quota=await v('/gmail/messages',{method:'POST',body:{account_id:account,contact_id:contactA,to:'ines@example.com',subject:'QUOTA',body:'Trop',idempotency_key:key()}});
  assert.equal(quota.status,429);
  const after=await v('/contacts/'+contactA+'/history');
  assert.equal(after.data.items.some(item=>item.summary.includes('ECHEC')||item.summary.includes('QUOTA')),false);
  const rows=await admin.query("SELECT status FROM gmail_messages WHERE subject IN ('ECHEC','QUOTA')");
  assert.deepEqual(rows.rows.map(row=>row.status).sort(),['failed','failed']);
});

test('Un double envoi avec la même clé n’appelle Gmail qu’une fois',async()=>{
  const account=(await v('/gmail/accounts')).data.accounts[0].id;
  const before=calls.send;
  const idempotency_key=key();
  const body={account_id:account,contact_id:contactA,to:'ines@example.com',subject:'Une fois',body:'Unique',idempotency_key};
  const [first,second]=await Promise.all([v('/gmail/messages',{method:'POST',body}),v('/gmail/messages',{method:'POST',body})]);
  assert.equal(calls.send,before+1);
  assert.ok([first.status,second.status].every(status=>status===200||status===201));
  assert.equal(first.data.gmailMessageId,second.data.gmailMessageId);
});

test('Renouvellement, jeton révoqué et second compte par défaut',async()=>{
  const beforeRefresh=calls.refresh;
  const {callback}=await connect('short');
  assert.match(callback.headers.get('location'),/etat=connecte/);
  const accounts=(await v('/gmail/accounts')).data.accounts;
  const renewed=accounts.find(account=>account.email==='owner@gmail.com'&&!account.isDefault)||accounts.find(account=>account.email==='owner@gmail.com');
  const short=(await admin.query("SELECT id FROM gmail_accounts WHERE user_id=$1 AND access_token_expires_at<=now()+interval '1 second' ORDER BY created_at DESC LIMIT 1",[userA])).rows[0];
  const sent=await v('/gmail/messages',{method:'POST',body:{account_id:short.id,company_id:companyA,to:'atelier@example.com',subject:'Renouvelé',body:'Après refresh',idempotency_key:key()}});
  assert.equal(sent.status,201,JSON.stringify(sent.data));
  assert.ok(calls.refresh>beforeRefresh);
  assert.equal(decrypt(process.env.BETTER_AUTH_SECRET,(await admin.query('SELECT access_token_enc FROM gmail_accounts WHERE id=$1',[short.id])).rows[0].access_token_enc),'access-renewed');
  const dead=await connect('dead');
  assert.match(dead.callback.headers.get('location'),/etat=connecte/);
  const deadId=(await admin.query("SELECT id FROM gmail_accounts WHERE google_sub='sub-dead'")).rows[0].id;
  const blocked=await v('/gmail/messages',{method:'POST',body:{account_id:deadId,contact_id:contactA,to:'ines@example.com',subject:'Mort',body:'Non',idempotency_key:key()}});
  assert.equal(blocked.status,409);
  assert.equal((await admin.query('SELECT status FROM gmail_accounts WHERE id=$1',[deadId])).rows[0].status,'expired');
  assert.equal((await v('/contacts/'+contactA+'/history')).data.items.some(item=>item.summary.includes('Mort')),false);
  const other=await connect('other');
  assert.match(other.callback.headers.get('location'),/etat=connecte/);
  const list=await v('/gmail/accounts');
  const second=list.data.accounts.find(account=>account.email==='other@gmail.com');
  assert.equal(second.isDefault,false);
  assert.equal((await v('/gmail/accounts/'+second.id+'/default',{method:'POST',body:{}})).status,200);
  const updated=await v('/gmail/accounts');
  assert.equal(updated.data.accounts.find(account=>account.email==='other@gmail.com').isDefault,true);
  assert.equal(updated.data.accounts.filter(account=>account.isDefault).length,1);
  assert.equal(renewed.email,'owner@gmail.com');
});

test('Déconnexion, révocation et révocation déjà impossible',async()=>{
  const boom=await connect('boom');
  assert.match(boom.callback.headers.get('location'),/etat=connecte/);
  const id=(await admin.query("SELECT id FROM gmail_accounts WHERE google_sub='sub-boom'")).rows[0].id;
  assert.equal((await v('/gmail/accounts/'+id,{method:'DELETE'})).status,204);
  assert.ok(calls.revoke.includes('refresh-boom'));
  assert.equal((await admin.query('SELECT id FROM gmail_accounts WHERE id=$1',[id])).rowCount,0);
  const current=(await v('/gmail/accounts')).data.accounts[0];
  const removed=await v('/gmail/accounts/'+current.id,{method:'DELETE'});
  assert.equal(removed.status,204);
  assert.ok(calls.revoke.length>=2);
  assert.equal((await v('/gmail/messages',{method:'POST',body:{account_id:current.id,contact_id:contactA,to:'ines@example.com',subject:'Après',body:'Non',idempotency_key:key()}})).status,404);
});

test('Sans identifiants Gmail, la connexion est refusée et le CRM reste utilisable',async()=>{
  const bare=(await createApp(db,{appUrl:'http://localhost',authRateLimit:false,gmailClientId:'',gmailClientSecret:'',googleClientId:'better-auth-client',googleClientSecret:'better-auth-secret-value',mailer:{configured:true,send:async()=>{}}})).listen(0,'127.0.0.1');
  await new Promise(r=>bare.once('listening',r));
  const origin='http://127.0.0.1:'+bare.address().port;
  try{
    const health=await fetch(origin+'/api/health');
    assert.equal(health.status,200);
    const connect=await fetch(origin+'/api/v1/gmail/connect',{method:'POST',headers:{authorization:'Bearer '+secretA,'content-type':'application/json'},body:JSON.stringify({share_consent:true})});
    assert.equal(connect.status,503);
    const accounts=await fetch(origin+'/api/v1/gmail/accounts',{headers:{authorization:'Bearer '+secretA}});
    assert.equal((await accounts.json()).configured,false);
    const social=await fetch(origin+'/api/auth/sign-in/social',{method:'POST',headers:{'content-type':'application/json',origin:'http://localhost'},body:JSON.stringify({provider:'google',callbackURL:'/app'})});
    const socialData=await social.json();
    assert.equal(social.status,200,JSON.stringify(socialData));
    assert.match(socialData.url,/client_id=better-auth-client/);
    assert.doesNotMatch(socialData.url,/gmail/);
    const company=await fetch(origin+'/api/v1/companies',{method:'POST',headers:{authorization:'Bearer '+secretA,'content-type':'application/json'},body:JSON.stringify({name:'Toujours là'})});
    assert.equal(company.status,201);
  }finally{await new Promise(r=>bare.close(r));}
});
