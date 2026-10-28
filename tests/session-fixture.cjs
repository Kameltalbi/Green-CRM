// Sessions uniquement pour les fixtures de test ; aucun endpoint d’application ne les expose.
const {token}=require('../lib/validation');
async function fixtureSession(pool,userId,organizationId,secret){const {serializeSignedCookie}=await import('better-call');const raw=token(),csrf=token();await pool.query("INSERT INTO auth_sessions(user_id,organization_id,token,csrf_token,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')",[userId,organizationId,raw,csrf]);const serialized=await serializeSignedCookie('ciblix.session_token',raw,secret);return {secret:serialized.split(';')[0].slice('ciblix.session_token='.length),csrf};}
module.exports={fixtureSession};
