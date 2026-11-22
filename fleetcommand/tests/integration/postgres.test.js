import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {FleetRepository} from '../../persistent/repository.js';
import {passwordRecord} from '../../persistent/password.js';
const adminUrl=process.env.FC_TEST_ADMIN_URL;
const authUrl=process.env.FC_TEST_AUTH_URL;
const opsUrl=process.env.FC_TEST_OPS_URL;
if(!adminUrl||!authUrl||!opsUrl){
 test('PostgreSQL integration requires isolated CI database', {skip:'Set FC_TEST_* URLs to use isolated test database'},()=>{});
}else{
 test('real PostgreSQL: role restrictions, tenant isolation, audit immutability, concurrent driver collision',async()=>{
  const admin=new pg.Pool({connectionString:adminUrl});
  const auth=new pg.Pool({connectionString:authUrl});
  const ops=new pg.Pool({connectionString:opsUrl,max:6});
  const repository=new FleetRepository({authPool:auth,operationsPool:ops});
  try{
   const p=await passwordRecord('long fictional password only!');
   const companyA=(await admin.query("INSERT INTO fc_operators(name) VALUES('Company A') RETURNING id")).rows[0].id;
   const companyB=(await admin.query("INSERT INTO fc_operators(name) VALUES('Company B') RETURNING id")).rows[0].id;
   async function owner(operator,email){
    return (await admin.query("INSERT INTO fc_users(operator_id,email,password_salt,password_hash,role) VALUES($1,$2,$3,$4,'OWNER') RETURNING id",
      [operator,email,p.salt,p.hash])).rows[0].id;
   }
   const ownerA=await owner(companyA,'a@fictional.invalid');
   await owner(companyB,'b@fictional.invalid');
   const driverA=(await admin.query("INSERT INTO fc_users(operator_id,email,password_salt,password_hash,role) VALUES($1,$2,$3,$4,'DRIVER') RETURNING id",
     [companyA,'driver-a@fictional.invalid',p.salt,p.hash])).rows[0].id;
   const vanA=(await admin.query("INSERT INTO fc_vehicles(operator_id,label,capacity) VALUES($1,'Van A',6) RETURNING id",[companyA])).rows[0].id;
   const sessionA=await repository.login('a@fictional.invalid','long fictional password only!');
   const sessionB=await repository.login('b@fictional.invalid','long fictional password only!');
   const a=await repository.actor(sessionA.token),b=await repository.actor(sessionB.token);
   assert.equal(a.operator_id,companyA);assert.equal(b.operator_id,companyB);
   const source={customerName:'Fictional passenger',pickup:'Airport',dropoff:'Hotel',
     startsAt:'2026-12-12T10:00:00Z',endsAt:'2026-12-12T11:00:00Z',passengers:2};
   const first=await repository.createBooking(a,source);
   const second=await repository.createBooking(a,{...source,customerName:'Second fictional passenger'});
   assert.equal((await repository.listBookings(a)).length,2);
   assert.equal((await repository.listBookings(b)).length,0);
   assert.equal((await repository.listEvents(b)).length,0);
   assert.equal((await repository.listEvents(a)).length,2);
   await assert.rejects(()=>repository.transition(b,first.id,{status:'CONFIRMED',reason:'Cannot cross tenant'}),/not found/i);
   // Database privilege proof: operational credentials have no access to global user/session tables.
   await assert.rejects(()=>ops.query('SELECT * FROM fc_users'),/permission denied/);
   await assert.rejects(()=>ops.query('SELECT * FROM fc_sessions'),/permission denied/);
   await assert.rejects(()=>ops.query('UPDATE fc_events SET reason=$1',['Malicious change']),/permission denied/);
   await assert.rejects(()=>ops.query('DELETE FROM fc_events'),/permission denied/);
   await assert.rejects(()=>auth.query('SELECT * FROM fc_bookings'),/permission denied/);
   await repository.scoped(b,async db=>{
    assert.equal((await db.query('SELECT * FROM fc_bookings WHERE id=$1',[first.id])).rows.length,0);
    assert.equal((await db.query('UPDATE fc_bookings SET customer_name=$1 WHERE id=$2 RETURNING id',['blocked',first.id])).rows.length,0);
   });
   await repository.transition(a,first.id,{status:'CONFIRMED',reason:'Dispatcher confirmed'});
   await repository.transition(a,second.id,{status:'CONFIRMED',reason:'Dispatcher confirmed'});
   const assignment={status:'ASSIGNED',reason:'Dispatcher assigned',driverId:driverA,vehicleId:vanA};
   const results=await Promise.allSettled([
    repository.transition(a,first.id,assignment),
    repository.transition(a,second.id,assignment)
   ]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   assert.equal(results.filter(r=>r.status==='rejected').length,1);
   assert.match(results.find(r=>r.status==='rejected').reason.message,/conflict/i);
   const list=await repository.listBookings(a);
   assert.equal(list.filter(r=>r.status==='ASSIGNED').length,1);
   assert.equal(list.filter(r=>r.status==='CONFIRMED').length,1);
   assert.equal((await repository.listEvents(a)).length,5);
   await repository.logout(sessionA.token);
   await assert.rejects(()=>repository.actor(sessionA.token),/Authentication required/);
  }finally{await Promise.allSettled([admin.end(),auth.end(),ops.end()])}
 },{timeout:30000});
}
