const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../../public/i18n.js'),'utf8');
function load({search='',blocked=false,saved}={}){
  const values=new Map(saved?[['ciblix.language',saved]]:[]);
  const context={window:{},URLSearchParams,location:{search},localStorage:{getItem:key=>{if(blocked)throw Error('blocked');return values.get(key);},setItem:(key,value)=>{if(blocked)throw Error('blocked');values.set(key,value);}}};
  vm.runInNewContext(source,context);return {i18n:context.window.CiblixI18n,values};
}
test('Traductions auth FR/EN : mêmes clés et paramètres, préférence partagée',()=>{
  const {i18n,values}=load();const {fr,en}=i18n.messages;
  assert.deepEqual(Object.keys(fr).sort(),Object.keys(en).sort());
  for(const key of Object.keys(fr))assert.deepEqual((fr[key].match(/\{\w+\}/g)||[]).sort(),(en[key].match(/\{\w+\}/g)||[]).sort(),key);
  assert.equal(i18n.t('login'),'Connexion');i18n.setLanguage('en');assert.equal(i18n.t('login'),'Sign in');assert.equal(values.get('ciblix.language'),'en');
  assert.equal(i18n.t('welcome',{name:'Amira'}),'Welcome Amira');i18n.setLanguage('unsupported');assert.equal(i18n.language,'en');
});
test('Préférence de langue robuste sans stockage navigateur et avec langue explicite',()=>{
  const {i18n}=load({blocked:true});i18n.setLanguage('en');assert.equal(i18n.t('login'),'Sign in');
  assert.equal(load({saved:'en'}).i18n.language,'en');assert.equal(load({search:'?lang=en'}).i18n.language,'en');
  assert.equal(load({saved:'invalid',search:'?lang=invalid'}).i18n.language,'fr');
});
