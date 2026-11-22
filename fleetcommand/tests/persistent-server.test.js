import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersistentServer} from '../persistent/server.js';
async function harness(repo,fn){
 const server=createPersistentServer(repo);await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+server.address().port;
 const call=async(path,method='GET',body,token)=>{
  const r=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),
   ...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const data=(r.headers.get('content-type')||'').includes('json')?await r.json():await r.text();
  return {status:r.status,data};
 };
 try{return await fn(call);}finally{await new Promise(ok=>server.close(ok));}
}
test('Persistent gateway requires authentication and shows isolated-mode warning',async()=>{
 const repository={actor:async()=>{throw Error('Authentication required');}};
 await harness(repository,async call=>{
  assert.equal((await call('/')).status,200);
  const health=await call('/api/health');
  assert.equal(health.data.productionReady,false);
  assert.equal((await call('/api/bookings')).status,401);
 });
});
test('Authenticated gateway maps tenant bookings and events without exposing another company',async()=>{
 const calls=[];
 const repo={
  login:async()=>({token:'a'.repeat(64),operatorId:'tenant-a',role:'OWNER'}),
  actor:async token=>{assert.equal(token,'a'.repeat(64));return {id:'owner-a',operator_id:'tenant-a',role:'OWNER'};},
  listBookings:async actor=>{calls.push(actor.operator_id);return [{id:'b1',operator_id:'tenant-a',customer_name:'Demo Rider',
   pickup:'Port',dropoff:'Hotel',starts_at:'2026-12-12T10:00:00Z',ends_at:'2026-12-12T11:00:00Z',
   status:'REQUESTED',passengers:2,driver_id:null,vehicle_id:null}];},
  listEvents:async actor=>{calls.push(actor.operator_id);return [{operator_id:'tenant-a',booking_id:'b1',actor_id:'owner-a',
   previous_status:null,new_status:'REQUESTED',reason:'New booking request',occurred_at:'2026-12-01T00:00:00Z'}];}
 };
 await harness(repo,async call=>{
  const login=await call('/api/login','POST',{email:'example@invalid.test',password:'fictional only'});
  assert.equal(login.status,200);
  const list=await call('/api/bookings','GET',undefined,login.data.token);
  assert.equal(list.status,200);assert.equal(list.data.bookings[0].customerName,'Demo Rider');
  const history=await call('/api/events','GET',undefined,login.data.token);
  assert.equal(history.status,200);assert.equal(history.data.events[0].action,'BOOKING_CREATED');
  assert.deepEqual(calls,['tenant-a','tenant-a']);
 });
});
test('Gateway refuses to leak backend SQL errors',async()=>{
 const repo={actor:async()=>{throw Error('password=secret SQL connection failed');}};
 await harness(repo,async call=>{
  const r=await call('/api/bookings','GET',undefined,'a'.repeat(64));
  assert.equal(r.status,500);assert.equal(r.data.error,'Internal development server error');
 });
});
