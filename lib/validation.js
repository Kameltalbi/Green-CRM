const crypto=require('node:crypto');
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new HttpError(status,message);};
const uuid=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v))fail(400,'Identifiant invalide.');return v;};
const text=(v,name,max=150,required=true)=>{if(v===undefined&&!required)return '';if(typeof v!=='string'||v.length>max||required&&!v.trim())fail(400,`Champ ${name} invalide.`);return v.trim();};
const email=v=>{const s=text(v,'e-mail',254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))fail(400,'Adresse e-mail invalide.');return s;};
const allowed=(body,keys)=>{if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k)))fail(400,'Champs non autorisés.');};
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const token=()=>crypto.randomBytes(32).toString('base64url');
module.exports={HttpError,fail,uuid,text,email,allowed,hash,token};
