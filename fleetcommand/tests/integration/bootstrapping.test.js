import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFileSync} from 'node:fs';
const url=process.env.FC_TEST_ADMIN_URL;
if(!url)test('bootstrap script isolated DB', {skip:'No isolated database'},()=>{});
else test('runtime role grants in bootstrap script remain least privileged',{timeout:20000},async()=>{
 const code=readFileSync(new URL('../../admin/bootstrap.mjs',import.meta.url),'utf8');
 assert.match(code,/ISOLATED_FLEETCOMMAND_DATABASE/);
 assert.match(code,/fleetcommand_\(pilot\|test\)/);
 for(const role of ['fc_auth_app','fc_ops_app','fc_recovery_app'])assert.ok(code.includes(role));
 assert.ok(!/GRANT\s+ALL\s+PRIVILEGES/i.test(code));
 assert.ok(!/BYPASSRLS\b/.test(code));
 const db=new pg.Client({connectionString:url});await db.connect();
 try{const r=await db.query('SELECT current_database() AS name');assert.equal(r.rows[0].name,'fleetcommand_test')}
 finally{await db.end()}
});
