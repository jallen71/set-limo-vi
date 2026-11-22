import test from 'node:test';
import assert from 'node:assert/strict';
import {createMailDelivery,recoveryLink} from '../persistent/mail.js';
import {createPersistentServer} from '../persistent/server.js';

test('recovery links keep raw token in browser fragment and require HTTPS except localhost',()=>{
 const token='f'.repeat(64);
 assert.equal(recoveryLink('https://fleet.example.invalid','ACTIVATE',token),
  'https://fleet.example.invalid/account#activate='+token);
 assert.throws(()=>recoveryLink('http://fleet.example.invalid','RESET',token),/HTTPS/);
 assert.throws(()=>recoveryLink('https://fleet.example.invalid','RESET','bad'),/Invalid/);
});
test('provider adapter is disabled unless configured and cannot email unauthorized recipients',async()=>{
 assert.throws(()=>createMailDelivery({}),/disabled/);
 let sent=null;
 const deliver=createMailDelivery({enabled:true,apiKey:'fictional-test-key',fromAddress:'verify@example.invalid',
  baseUrl:'https://fleet.example.invalid',allowedRecipients:['testingthings@gmail.com'],
  transport:async(url,req)=>{sent={url,req};return {ok:true}}});
 await assert.rejects(()=>deliver({address:'another@gmail.com',token:'b'.repeat(64),purpose:'RESET'}),/allowlist/);
 assert.equal(sent,null);
 await deliver({address:'testingthings@gmail.com',token:'b'.repeat(64),purpose:'RESET'});
 assert.equal(sent.url,'https://api.resend.com/emails');
 const payload=JSON.parse(sent.req.body);
 assert.deepEqual(payload.to,['testingthings@gmail.com']);
 assert.match(payload.text,/account#reset=/);
});
async function harness({recovery,deliver},run){
 const server=createPersistentServer({actor:async()=>{throw Error('Authentication required')}},{recovery,deliver});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const base='http://127.0.0.1:'+server.address().port;
 const request=async(path,payload,origin=base)=>{
  const response=await fetch(base+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  return {status:response.status,data:await response.json()};
 };
 try{return await run(request,base)}finally{await new Promise(done=>server.close(done))}
}
test('recovery endpoints are disabled by default',async()=>harness({},async request=>{
 assert.equal((await request('/api/recovery/request',{email:'testingthings@gmail.com'})).status,503);
 assert.equal((await request('/api/recovery/consume',{token:'a'.repeat(64),purpose:'RESET',password:'fictional password'})).status,503);
}));
test('recovery requests have generic responses, origin checks, one-minute throttle, and never return token',async()=>{
 let issued=0,delivered=0,consumed=0;
 const recovery={
  issue:async(email,purpose)=>{issued++;assert.equal(email,'testingthings@gmail.com');assert.equal(purpose,'RESET');
   return {accepted:true,delivery:{address:email,token:'a'.repeat(64),purpose}}},
  consume:async(token,purpose,password)=>{consumed++;assert.equal(token,'a'.repeat(64));assert.equal(purpose,'ACTIVATE');assert.equal(password,'fictional password long');return {completed:true}}
 };
 const deliver=async()=>{delivered++};
 await harness({recovery,deliver},async(request,base)=>{
  const bad=await request('/api/recovery/request',{email:'testingthings@gmail.com'},'http://evil.invalid');
  assert.equal(bad.status,403);assert.equal(issued,0);
  assert.equal((await request('/api/recovery/request',{email:'bad email@example.invalid'})).status,400);
  const ok=await request('/api/recovery/request',{email:'testingthings@gmail.com'});
  assert.equal(ok.status,200);assert.deepEqual(ok.data,{accepted:true});
  const repeated=await request('/api/recovery/request',{email:'testingthings@gmail.com'});
  assert.deepEqual(repeated.data,{accepted:true});assert.equal(issued,1);assert.equal(delivered,1);
  assert.equal((await request('/api/recovery/consume',{token:'a'.repeat(64),purpose:'ACTIVATE',password:'fictional password long'},'http://evil.invalid')).status,403);
  assert.equal(consumed,0);
  const completion=await request('/api/recovery/consume',{token:'a'.repeat(64),purpose:'ACTIVATE',password:'fictional password long'});
  assert.equal(completion.status,200);assert.equal(consumed,1);
 });
});
