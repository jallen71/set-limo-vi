import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersistentServer} from '../persistent/server.js';
import {toCsv} from '../persistent/export.js';
async function harness(repo,options,fn){
 const server=createPersistentServer(repo,options);
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const url='http://127.0.0.1:'+server.address().port;
 const send=async(path,{method='GET',body,session,origin=url}={})=>{
  const response=await fetch(url+path,{method,headers:{
   ...(method==='POST'?{Origin:origin}:{}),
   ...(body?{'Content-Type':'application/json'}:{}),
   ...(session?{Cookie:session.cookie,'X-FleetCommand-CSRF':session.csrf}:{})
  },body:body?JSON.stringify(body):undefined});
  const type=response.headers.get('content-type')||'';
  return {status:response.status,body:type.includes('application/json')?await response.json():await response.text(),
   cookie:response.headers.get('set-cookie')};
 };
 try{return await fn(send);}finally{await new Promise(ok=>server.close(ok));}
}
test('public form is served without login, guest requests are pending and rate-limited',async()=>{
 let count=0;const repo={actor:async()=>{throw Error('Authentication required')}};
 await harness(repo,{guest:{submit:async()=>{count++;return {requestId:'fictional-id',status:'PENDING'}}}},async send=>{
  const token='a'.repeat(64);
  const page=await send('/book/'+token);
  assert.equal(page.status,200);assert.match(page.body,/NOT a confirmed/i);
  const req={token,email:'rider@fictional.invalid',customerName:'Test Rider',pickup:'A',dropoff:'B',passengers:2,
   startsAt:'2026-12-24T10:00:00Z',endsAt:'2026-12-24T11:00:00Z'};
  const first=await send('/api/public/requests',{method:'POST',body:req});
  assert.equal(first.status,202);assert.equal(first.body.status,'PENDING');
  const second=await send('/api/public/requests',{method:'POST',body:req});
  assert.equal(second.status,429);assert.equal(count,1);
  assert.equal((await send('/api/public/requests',{method:'POST',body:req,origin:'http://evil.invalid'})).status,403);
 });
});
test('operator-only incoming queue, booking link and CSV export enforce roles',async()=>{
 const token='b'.repeat(64),operatorId='fictional-company';
 const repo={
  login:async()=>({token,operatorId,role:'OWNER'}),
  actor:async raw=>{if(raw!==token)throw Error('Authentication required');return {id:'fictional-owner',operator_id:operatorId,role:'OWNER'}},
  listCustomerRequests:async()=>[{id:'r1',status:'PENDING'}],
  rotateCustomerBookingLink:async()=>({token:'c'.repeat(64),warning:'Save link'}),
  decideCustomerRequest:async()=>({status:'ACCEPTED',bookingId:'b1'}),
  listBookings:async()=>[{customer_name:'=SUM(A1:A2)',status:'REQUESTED',operator_id:operatorId}]
 };
 await harness(repo,{},async send=>{
  assert.equal((await send('/api/customer-requests')).status,401);
  const login=await send('/api/login',{method:'POST',body:{email:'a',password:'b'}});
  const session={cookie:login.cookie.split(';')[0],csrf:login.body.csrf};
  assert.equal((await send('/api/customer-requests',{session})).body.requests.length,1);
  const link=await send('/api/public-link/rotate',{method:'POST',body:{},session});
  assert.match(link.body.url,/\/book\/c{64}$/);
  assert.equal((await send('/api/customer-requests/r1/decision',{method:'POST',body:{action:'ACCEPTED',reason:'Fictional review'},session})).status,404);
  const csv=await send('/api/reports/bookings.csv',{session});
  assert.equal(csv.status,200);assert.match(csv.body,/"'=SUM\(A1:A2\)"/);
 });
});
test('CSV exporter neutralizes leading spreadsheet formulas and embedded quotes',()=>{
 const csv=toCsv([{customer_name:'=HYPERLINK("x")',pickup:'-1+2',dropoff:'Normal',status:'PENDING'}]);
 assert.match(csv,/"'=HYPERLINK\(""x""\)"/);
 assert.match(csv,/"'-1\+2"/);
});
