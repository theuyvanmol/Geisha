import PocketBase from 'pocketbase';
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1).replace(/^["']|["']$/g,'')];}));
const pb = new PocketBase(env.POCKETBASE_URL);
await pb.collection('_superusers').authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);
const rest = await pb.collection('geisha_restaurants').getFirstListItem(`brand="fusion"`);
const tables = await pb.collection('geisha_tables').getFullList({ filter: `restaurant="${rest.id}"` });
const L = Object.fromEntries(tables.map(t=>[t.id, t.label]));
const row = await pb.collection('geisha_settings').getFirstListItem(`restaurant="${rest.id}" && key="table_chains"`);
console.log('Fusion chains:');
for (const c of row.value) console.log('  ' + c.tableIds.map(i=>L[i]??i).join(', ') + '  = ' + c.capacity);
const want = [['5','6'],['10','11'],['20','21'],['30','31']];
console.log('\nRequested pairs present?');
for (const w of want) {
  const hit = row.value.find(c => c.tableIds.length===w.length && w.every(l=>c.tableIds.some(i=>L[i]===l)));
  console.log(`  ${w.join(',')} -> ${hit ? 'YES (capacity '+hit.capacity+')' : 'MISSING'}`);
}
