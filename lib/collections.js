const {fail,uuid}=require('./validation');

function pagination(q,max=200){
  const limit=q.limit===undefined?50:Number(q.limit),offset=q.offset===undefined?0:Number(q.offset);
  if(!Number.isSafeInteger(limit)||limit<1||limit>max||!Number.isSafeInteger(offset)||offset<0)fail(400,'Pagination invalide.');
  return {limit,offset};
}
const normalize=sql=>`lower(translate(${sql},'àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ','aaaeeeeiioouuucAAAEEEEIIOOUUUC'))`;
const statusSQL=field=>`CASE WHEN t.archived_at IS NOT NULL THEN 'archived' WHEN EXISTS(SELECT 1 FROM followups f WHERE f.${field}=t.id AND f.status='pending' AND (f.due_at AT TIME ZONE 'Africa/Tunis')::date < (now() AT TIME ZONE 'Africa/Tunis')::date) THEN 'late' WHEN EXISTS(SELECT 1 FROM followups f WHERE f.${field}=t.id AND f.status='pending') THEN 'planned' WHEN EXISTS(SELECT 1 FROM followups f WHERE f.${field}=t.id) THEN 'done' ELSE 'none' END`;
function listing(table,q){
  const params=[],where=[];const add=v=>{params.push(v);return '$'+params.length;};
  const directory=['contacts','companies'].includes(table),company=table==='companies';
  let from=`${table} t`,select='t.*',order='t.created_at,t.id';
  if(directory){
    const field=company?'company_id':'contact_id';
    from+=` LEFT JOIN users u ON u.id=t.owner_user_id ${company?'':'LEFT JOIN companies co ON co.id=t.company_id'}`;
    select+=`,u.name AS owner_name,${statusSQL(field)} AS tracking_key,(SELECT row_to_json(n) FROM (SELECT id,due_at,subject FROM followups f WHERE f.${field}=t.id AND f.status='pending' ORDER BY due_at,id LIMIT 1)n) AS next_followup`;
    if(company)select+=`,(SELECT count(*)::int FROM contacts p WHERE p.company_id=t.id AND p.archived_at IS NULL) AS people_count,(SELECT row_to_json(p) FROM (SELECT id,name,job_title FROM contacts p WHERE p.company_id=t.id AND p.archived_at IS NULL ORDER BY p.name,p.id LIMIT 1)p) AS primary_contact`;
    else select+=`,co.name AS company_name,co.sector AS company_sector`;
    if(q.archived!==undefined&&!['true','false'].includes(q.archived))fail(400,'Filtre d’archives invalide.');
    if(q.archived!=='true'&&q.status!=='archived')where.push('t.archived_at IS NULL');
    if(q.owner)where.push(q.owner==='unassigned'?'t.owner_user_id IS NULL':`t.owner_user_id=${add(uuid(q.owner))}`);
    if(q.sector)where.push(`${company?'t.sector':'co.sector'}=${add(q.sector)}`);
    if(q.status){if(!['late','planned','none','done','archived'].includes(q.status))fail(400,'Statut invalide.');where.push(`${statusSQL(field)}=${add(q.status)}`);}
    const sorts={name:'t.name',relation:company?"(SELECT p.name FROM contacts p WHERE p.company_id=t.id AND p.archived_at IS NULL ORDER BY p.name,p.id LIMIT 1)":'co.name',owner:'u.name',last:'NULL::text',next:`(SELECT min(f.due_at) FROM followups f WHERE f.${field}=t.id AND f.status='pending')`,status:`CASE ${statusSQL(field)} WHEN 'none' THEN 'À organiser' WHEN 'archived' THEN 'Archivé' WHEN 'late' THEN 'En retard' WHEN 'planned' THEN 'Relance prévue' ELSE 'Suivi terminé' END`};
    if(q.sort&&!Object.hasOwn(sorts,q.sort))fail(400,'Tri invalide.');
    if(q.direction&&!['asc','desc'].includes(q.direction))fail(400,'Ordre invalide.');
    order=`${sorts[q.sort||'name']} ${q.direction==='desc'?'DESC':'ASC'} NULLS LAST,t.id`;
    if(q.q){
      if(typeof q.q!=='string'||q.q.length>200)fail(400,'Recherche invalide.');
      const term=add(q.q.trim());
      const fields=company?"concat_ws(' ',t.name,t.sector,t.city,t.description)":"concat_ws(' ',t.name,t.phone,t.job_title,co.name)";
      let search=`strpos(${normalize(fields)},${normalize(term)})>0`;
      if(company)search+=` OR EXISTS(SELECT 1 FROM contacts p WHERE p.company_id=t.id AND (strpos(${normalize("concat_ws(' ',p.name,p.phone)")},${normalize(term)})>0 OR EXISTS(SELECT 1 FROM contact_emails e WHERE e.contact_id=p.id AND strpos(${normalize('e.email')},${normalize(term)})>0)))`;
      else search+=` OR EXISTS(SELECT 1 FROM contact_emails e WHERE e.contact_id=t.id AND strpos(${normalize('e.email')},${normalize(term)})>0)`;
      where.push('('+search+')');
    }
  }
  if(q.company_id){if(table==='companies')where.push(`t.id=${add(uuid(q.company_id))}`);else where.push(`t.company_id=${add(uuid(q.company_id))}`);}
  if(q.contact_id){if(table==='contacts')where.push(`t.id=${add(uuid(q.contact_id))}`);else if(table!=='companies')where.push(`t.contact_id=${add(uuid(q.contact_id))}`);}
  if(table==='notes')order='t.created_at DESC,t.id DESC';
  if(table==='activities'){from+=' JOIN users actor ON actor.id=t.actor_user_id';select+=',actor.name AS actor_name';order='t.created_at DESC,t.id DESC';}
  if(table==='followups'){
    if(q.status){if(!['pending','completed','cancelled'].includes(q.status))fail(400,'Statut invalide.');where.push(`t.status=${add(q.status)}`);}
    if(q.owner)where.push(`t.owner_user_id=${add(uuid(q.owner))}`);
    if(q.scope){if(!['today','late','upcoming'].includes(q.scope))fail(400,'Période invalide.');where.push(`(t.due_at AT TIME ZONE 'Africa/Tunis')::date ${{today:'=',late:'<',upcoming:'>'}[q.scope]} (now() AT TIME ZONE 'Africa/Tunis')::date`);}
    order='t.due_at,t.id';
  }
  return {sql:`SELECT ${select} FROM ${from}${where.length?' WHERE '+where.join(' AND '):''}`,params,order};
}
async function related(c,table,items){
  const result={companies:[],contacts:[],contact_emails:[],notes:[],followups:[],images:[],activities:[]};
  const companyIds=new Set(),contactIds=new Set();
  for(const r of items){if(table==='companies')companyIds.add(r.id);if(table==='contacts')contactIds.add(r.id);if(r.company_id)companyIds.add(r.company_id);if(r.contact_id)contactIds.add(r.contact_id);}
  if(contactIds.size){result.contacts=(await c.query('SELECT * FROM contacts WHERE id=ANY($1::uuid[])',[[...contactIds]])).rows;for(const r of result.contacts)if(r.company_id)companyIds.add(r.company_id);result.contact_emails=(await c.query('SELECT * FROM contact_emails WHERE contact_id=ANY($1::uuid[]) ORDER BY email',[[...contactIds]])).rows;result.images=(await c.query('SELECT id,contact_id,mime_type FROM contact_card_images WHERE contact_id=ANY($1::uuid[])',[[...contactIds]])).rows;}
  if(companyIds.size)result.companies=(await c.query('SELECT * FROM companies WHERE id=ANY($1::uuid[])',[[...companyIds]])).rows;
  return result;
}
async function page(c,table,q){
  const {limit,offset}=pagination(q),query=listing(table,q);
  const {rows:[count]}=await c.query(`SELECT count(*)::int AS total FROM (${query.sql}) counted`,query.params);
  const items=(await c.query(`${query.sql} ORDER BY ${query.order} LIMIT $${query.params.length+1} OFFSET $${query.params.length+2}`,[...query.params,limit,offset])).rows;
  return {items,total:count.total,limit,offset,related:await related(c,table,items)};
}
function installCollections(api,{route,db}){
  for(const table of ['companies','contacts','notes','followups','activities'])api.get('/'+table,route((req,c)=>page(c,table,req.query)));
  api.get('/contacts/export',async(req,res,next)=>{
    try{await db.tenant(req.auth.organization_id,async c=>{
      if(!(await c.query('SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2 AND active=true',[req.auth.organization_id,req.auth.user_id])).rowCount)fail(403,'Accès révoqué.');const query=listing('contacts',req.query);let cursor=false;
      try{await c.query(`DECLARE contact_export NO SCROLL CURSOR FOR ${query.sql} ORDER BY ${query.order}`,query.params);cursor=true;
        res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="ciblix-contacts.csv"'});
        const quote=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';
        res.write('\ufeff'+['Nom','Entreprise','E-mails','Téléphone','Fonction','Origine','Responsable','Archivé'].map(quote).join(';')+'\r\n');
        while(!res.destroyed){const {rows}=await c.query('FETCH 200 FROM contact_export');if(!rows.length)break;const data=await related(c,'contacts',rows);
          for(const r of rows){const line=[r.name,r.company_name,data.contact_emails.filter(e=>e.contact_id===r.id).map(e=>e.email).join(', '),r.phone,r.job_title,r.source,r.owner_name,r.archived_at?'Oui':'Non'].map(quote).join(';')+'\r\n';if(!res.write(line))await new Promise(resolve=>{const done=()=>{res.off('drain',done);res.off('close',done);resolve();};res.once('drain',done);res.once('close',done);});if(res.destroyed)break;}
        }
      }finally{if(cursor)await c.query('CLOSE contact_export');}
    });res.end();}catch(e){if(res.headersSent)res.destroy();else next(e);}
  });
  for(const table of ['contacts','companies'])api.get('/'+table+'/:id/context',route(async(req,c)=>{
    const id=uuid(req.params.id),query=listing(table,{archived:'true'});
    const {rows:[record]}=await c.query(query.sql+' WHERE t.id=$1',[id]);if(!record)fail(404,'Fiche introuvable.');
    const field=table==='contacts'?'contact_id':'company_id';
    const data=await related(c,table,[record]);data[table]=[record];
    const followups=await page(c,'followups',{[field]:id,status:'pending',limit:3});data.followups=followups.items;
    return {record,related:data,followupTotal:followups.total};
  }));
  api.get('/dashboard',route(async(_req,c)=>{
    const {rows:[counts]}=await c.query(`SELECT
      (SELECT count(*)::int FROM contacts WHERE archived_at IS NULL) AS contacts,
      (SELECT count(*)::int FROM companies WHERE archived_at IS NULL) AS companies,
      (SELECT count(*)::int FROM contacts WHERE archived_at IS NULL AND created_at>=date_trunc('month',now() AT TIME ZONE 'Africa/Tunis') AT TIME ZONE 'Africa/Tunis') AS new_contacts,
      (SELECT count(*)::int FROM companies WHERE archived_at IS NULL AND created_at>=date_trunc('month',now() AT TIME ZONE 'Africa/Tunis') AT TIME ZONE 'Africa/Tunis') AS new_companies,
      (SELECT count(*)::int FROM followups WHERE status='pending') AS pending`);
    const periods={};for(const scope of ['today','late','upcoming'])periods[scope]=await page(c,'followups',{status:'pending',scope,limit:10});
    const evolution=(await c.query(`SELECT to_char(m,'YYYY-MM') AS month,(SELECT count(*)::int FROM contacts WHERE archived_at IS NULL AND created_at < (m+interval '1 month') AT TIME ZONE 'Africa/Tunis') AS count FROM generate_series(date_trunc('month',now() AT TIME ZONE 'Africa/Tunis')-interval '11 months',date_trunc('month',now() AT TIME ZONE 'Africa/Tunis'),interval '1 month') m ORDER BY m`)).rows;
    const origins=(await c.query(`WITH groups AS (SELECT coalesce(nullif(source,''),'Non renseignée') AS name,count(*)::int AS count FROM contacts WHERE archived_at IS NULL GROUP BY 1),ranked AS (SELECT *,row_number() OVER(ORDER BY count DESC,name) AS rank FROM groups) SELECT CASE WHEN rank<=19 THEN name ELSE 'Autres origines' END AS name,sum(count)::int AS count FROM ranked GROUP BY 1 ORDER BY count DESC,name`)).rows;
    const sectors=(await c.query(`SELECT coalesce(nullif(co.sector,''),'Non renseigné') AS name,count(*)::int AS count FROM contacts t LEFT JOIN companies co ON co.id=t.company_id WHERE t.archived_at IS NULL GROUP BY 1 ORDER BY count DESC,name LIMIT 6`)).rows;
    return {counts,periods,evolution,origins,sectors};
  }));
  api.get('/directory-facets',route(async(_req,c)=>({sectors:(await c.query("SELECT DISTINCT sector FROM companies WHERE sector<>'' ORDER BY sector LIMIT 200")).rows.map(r=>r.sector)})));
}
module.exports={installCollections,pagination,listing};
