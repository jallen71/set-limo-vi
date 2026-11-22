import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {passwordRecord,verifyPassword,hashToken} from '../persistent/password.js';
import {FleetRepository} from '../persistent/repository.js';

test('credentials use unique salt and reject wrong password',async()=>{
 const a=await passwordRecord('a secure test passphrase');
 const b=await passwordRecord('a secure test passphrase');
 assert.notEqual(a.salt,b.salt);
 assert.notEqual(a.hash,b.hash);
 assert.equal(await verifyPassword('a secure test passphrase',a.salt,a.hash),true);
 assert.equal(await verifyPassword('incorrect password',a.salt,a.hash),false);
 await assert.rejects(()=>passwordRecord('short'));
});
test('session token hash is deterministic but does not reveal token',()=>{
 const token='a'.repeat(64);
 assert.equal(hashToken(token).length,64);
 assert.notEqual(hashToken(token),token);
});
test('tenant context is set inside a transaction and cleanup is mandatory',async()=>{
 const calls=[];
 const db={async query(sql,params){calls.push([sql,params]);return {rows:[]}},release(){calls.push(['RELEASE'])}};
 const repo=new FleetRepository({authPool:{query(){}},operationsPool:{async connect(){return db}}});
 const actor={id:'actor-1',operator_id:'company-a',role:'OWNER'};
 await repo.scoped(actor,async c=>{await c.query('SELECT * FROM fc_bookings');});
 assert.deepEqual(calls.map(x=>x[0]),[
  'BEGIN',"SELECT set_config('fleetcommand.operator_id',$1,true)",
  'SELECT * FROM fc_bookings','COMMIT','RELEASE'
 ]);
 assert.deepEqual(calls[1][1],['company-a']);
 calls.length=0;
 await assert.rejects(()=>repo.scoped(actor,async()=>{throw Error('Simulated failure')}),/Simulated failure/);
 assert.deepEqual(calls.map(x=>x[0]),[
  'BEGIN',"SELECT set_config('fleetcommand.operator_id',$1,true)",'ROLLBACK','RELEASE'
 ]);
 await assert.rejects(()=>repo.scoped({operator_id:'a'},async()=>{}),/Verified actor/);
});
test('persistent store refuses unknown or missing session',async()=>{
 const calls=[];
 const auth={async query(sql,params){calls.push(sql);return {rows:[]}}};
 const repo=new FleetRepository({authPool:auth,operationsPool:{connect(){throw Error('Not called')}}});
 await assert.rejects(()=>repo.actor('invalid'),/Authentication required/);
 await assert.rejects(()=>repo.actor('b'.repeat(64)),/Authentication required/);
 assert.equal(calls.length,1);
});
test('PostgreSQL schema enables mandatory tenant RLS on all operator tables',()=>{
 const sql=readFileSync(new URL('../persistent/001_schema.sql',import.meta.url),'utf8');
 for(const table of ['fc_vehicles','fc_bookings','fc_events']){
  assert.match(sql,new RegExp('ALTER TABLE '+table+' ENABLE ROW LEVEL SECURITY'));
  assert.match(sql,new RegExp('ALTER TABLE '+table+' FORCE ROW LEVEL SECURITY'));
  assert.match(sql,new RegExp('CREATE POLICY '+table.slice(0,-1)+'s?_tenant|CREATE POLICY '+table+'_tenant'));
 }
 assert.match(sql,/CREATE UNIQUE INDEX IF NOT EXISTS fc_users_email_unique/);
});
