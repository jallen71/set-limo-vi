import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from '../src/demo-server.js';
async function harness(fn){const server=createDemoServer();await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const base='http://127.0.0.1:'+server.address().port;
 const call=async(path,method='GET',body,token)=>{const res=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=(res.headers.get('content-type')||'').includes('json')?await res.json():await res.text();return {status:res.status,data};};
 try{return await fn(call)}finally{await new Promise(ok=>server.close(ok));}}
const trip={customerName:'Example Rider',pickup:'Airport',dropoff:'Resort',startsAt:'2026-12-12T10:00:00Z',endsAt:'2026-12-12T11:00:00Z',passengers:2};
async function login(call,email,password){const r=await call('/api/login','POST',{email,password});assert.equal(r.status,200);return r.data.token;}
test('dashboard, demo health and authentication requirement',async()=>harness(async call=>{
 const root=await call('/');assert.equal(root.status,200);assert.match(root.data,/LOCAL FICTIONAL DEMO/);
 const h=await call('/api/health');assert.equal(h.data.productionReady,false);
 assert.equal((await call('/api/bookings')).status,401);
 assert.equal((await call('/api/login','POST',{email:'operator-a@example.invalid',password:'wrong'})).status,401);
}));
test('operator isolation in bookings, transitions and audit events',async()=>harness(async call=>{
 const a=await login(call,'operator-a@example.invalid','DemoOnly-A-2026!');
 const b=await login(call,'operator-b@example.invalid','DemoOnly-B-2026!');
 const created=await call('/api/bookings','POST',trip,a);assert.equal(created.status,201);
 assert.equal((await call('/api/bookings','GET',null,a)).data.bookings.length,1);
 assert.equal((await call('/api/bookings','GET',null,b)).data.bookings.length,0);
 const id=created.data.booking.id;
 assert.equal((await call('/api/bookings/'+id+'/transition','POST',{status:'CONFIRMED',reason:'Checked trip'},b)).status,404);
 assert.equal((await call('/api/events','GET',null,b)).data.events.length,0);
 assert.equal((await call('/api/bookings/'+id+'/transition','POST',{status:'CONFIRMED',reason:'Checked trip'},a)).status,200);
 assert.equal((await call('/api/events','GET',null,a)).data.events.length,2);
}));
test('assignment collision rejected without changing prior booking',async()=>harness(async call=>{
 const token=await login(call,'operator-a@example.invalid','DemoOnly-A-2026!');
 const ids=[];
 for(let i=0;i<2;i++){const r=await call('/api/bookings','POST',{...trip,customerName:'Test'+i},token);ids.push(r.data.booking.id);
  await call('/api/bookings/'+r.data.booking.id+'/transition','POST',{status:'CONFIRMED',reason:'Booking verified'},token);}
 const args={status:'ASSIGNED',reason:'Dispatcher assignment',driverId:'driver-1',vehicleId:'van-1'};
 assert.equal((await call('/api/bookings/'+ids[0]+'/transition','POST',args,token)).status,200);
 const blocked=await call('/api/bookings/'+ids[1]+'/transition','POST',args,token);
 assert.equal(blocked.status,400);assert.match(blocked.data.error,/conflicts/);
 const list=await call('/api/bookings','GET',null,token);
 assert.equal(list.data.bookings.find(x=>x.id===ids[1]).status,'CONFIRMED');
}));