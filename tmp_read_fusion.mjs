import PocketBase from 'pocketbase';
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1).replace(/^["']|["']$/g,'')];}));
const pb = new PocketBase(env.POCKETBASE_URL);
await pb.collection('_superusers').authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);
const rest = await pb.collection('geisha_restaurants').getFirstListItem(`brand="fusion"`);
const tables = await pb.collection('geisha_tables').getFullList({ filter: `restaurant="${rest.id}"`, sort: 'label' });
console.log('restaurant', rest.id, rest.display_name, '| tables', tables.length);
console.log(tables.map(t=>`${t.label}[${t.seats_min}-${t.seats_max}] ${t.section||'-'}${t.bookable?'':' (walk-in only)'}`).join('\n'));
for (const key of ['table_chains','table_autojoin']) {
  const row = await pb.collection('geisha_settings').getFirstListItem(`restaurant="${rest.id}" && key="${key}"`).catch(()=>null);
  console.log('\n==', key, row ? '' : '(NO ROW)');
  if (row) console.log(JSON.stringify(row.value));
}
