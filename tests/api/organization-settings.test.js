const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {installApi}=require('../../lib/api');
async function update(role,body){
  const app=express();let write;
  app.use(express.json());
  app.use((req,_res,next)=>{req.auth={organization_id:'tenant-a',user_id:'user-a'};next();});
  const db={tenant:async(id,fn)=>{assert.equal(id,'tenant-a');return fn({query:async(sql,args)=>{if(sql.startsWith('SELECT role'))return {rows:[{role}]};write={sql,args};return {rows:[{id:args[0],name:args[1]}]};}});}};
  installApi(app,db,{});
  app.use((error,_req,res,_next)=>res.status(error.status||500).json({message:error.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/organization`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json(),write};}finally{await new Promise(resolve=>server.close(resolve));}
}
test('Organisation : seul un administrateur peut renommer son espace',async()=>{
  const saved=await update('admin',{name:' Nouvelle entreprise '});assert.equal(saved.status,200);assert.equal(saved.data.name,'Nouvelle entreprise');assert.deepEqual(saved.write.args,['tenant-a','Nouvelle entreprise','{}']);assert.match(saved.write.sql,/WHERE id=\$1/);
  const denied=await update('member',{name:'Autre nom'});assert.equal(denied.status,403);assert.doesNotMatch(denied.write.sql,/^\s*UPDATE/);
});
test('Organisation : refuse les noms vides et les propriétés inattendues',async()=>{
  for(const body of [{name:' '},{name:'Entreprise',id:'tenant-b'},{name:'x'.repeat(151)}]){const result=await update('admin',body);assert.equal(result.status,400);assert.doesNotMatch(result.write.sql,/^\s*UPDATE/);}
});

test('Organisation : enregistre les coordonnées et refuse les logos invalides',async()=>{
  const result=await update('admin',{name:'Entreprise',country:'Tunisie',email:'contact@example.com',phone:'+216 123',website:'https://example.com',address:'Tunis',tax_id:'ABC'});assert.equal(result.status,200);assert.equal(JSON.parse(result.write.args[2]).country,'Tunisie');
  for(const body of [{logo:'data:image/svg+xml;base64,PHN2Zz4='},{logo:'data:image/png;base64,YWJj'},{website:'javascript:alert(1)'},{email:'incorrect'}]){const invalid=await update('admin',{name:'Entreprise',...body});assert.equal(invalid.status,400);assert.doesNotMatch(invalid.write.sql,/^\s*UPDATE/);}
});
