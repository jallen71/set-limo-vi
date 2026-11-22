import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {OperatorProvisioner} from '../../persistent/provisioning.js';
import {FleetRepository} from '../../persistent/repository.js';
import {GuestBookingIntake} from '../../persistent/guest.js';
const {FC_TEST_ADMIN_URL:adminUrl,FC_TEST_AUTH_URL:authUrl,FC_TEST_OPS_URL:opsUrl,FC_TEST_GUEST_URL:guestUrl}=process.env;
if(!adminUrl||!authUrl||!opsUrl||!guestUrl)test('isolated public bookings',{skip:'No guest database role'},()=>{});
else test('customer request: secure share link, tenant separation, dispatcher acceptance, decline, rotation and audit',{timeout:30000},async()=>{
 const admin=new pg.Pool({connectionString:adminUrl}),auth=new pg.Pool({connectionString:authUrl}),
  ops=new pg.Pool({connectionString:opsUrl}),guestPool=new pg.Pool({connectionString:guestUrl});
 const provisioner=new OperatorProvisioner(admin),repo=new FleetRepository({authPool:auth,operationsPool:ops});
 const guest=new GuestBookingIntake(guestPool),reason='Isolated guest booking flow test',performedBy='pilot-admin-test';
 try{
  const first=await provisioner.createOperator({businessName:'Guest Operator One',ownerEmail:'guest-owner-a@fictional.invalid',
   ownerPassword:'Fictional owner secret 123',reason,performedBy});
  await provisioner.createOperator({businessName:'Guest Operator Two',ownerEmail:'guest-owner-b@fictional.invalid',
   ownerPassword:'Fictional owner secret 123',reason,performedBy});
  const a=await repo.actor((await repo.login('guest-owner-a@fictional.invalid','Fictional owner secret 123')).token);
  const b=await repo.actor((await repo.login('guest-owner-b@fictional.invalid','Fictional owner secret 123')).token);
  const link=await repo.rotateCustomerBookingLink(a);
  assert.equal(link.token.length,64);
  const intake={token:link.token,email:'rider@fictional.invalid',customerName:'Pilot Rider',pickup:'Airport',
   dropoff:'Marina',startsAt:'2026-12-23T10:00:00Z',endsAt:'2026-12-23T11:00:00Z',passengers:2};
  await assert.rejects(()=>guest.submit({...intake,token:'f'.repeat(64)}),/Invalid booking link/);
  const request=await guest.submit(intake);assert.equal(request.status,'PENDING');
  assert.equal((await repo.listCustomerRequests(a)).length,1);
  assert.equal((await repo.listCustomerRequests(b)).length,0);
  await assert.rejects(()=>repo.decideCustomerRequest(b,request.requestId,{action:'ACCEPTED',reason:'Wrong operator'}),/not found/i);
  const accepted=await repo.decideCustomerRequest(a,request.requestId,{action:'ACCEPTED',reason:'Dispatch accepted request'});
  assert.equal(accepted.status,'ACCEPTED');assert.ok(accepted.bookingId);
  assert.equal((await repo.listBookings(a)).length,1);
  assert.equal((await repo.listBookings(b)).length,0);
  await assert.rejects(()=>repo.decideCustomerRequest(a,request.requestId,{action:'ACCEPTED',reason:'Duplicate'}),/already decided/);
  const next=await guest.submit({...intake,customerName:'Second Pilot Rider'});
  const declined=await repo.decideCustomerRequest(a,next.requestId,{action:'DECLINED',reason:'No availability'});
  assert.equal(declined.bookingId,null);
  assert.equal((await repo.listBookings(a)).length,1);
  const rotated=await repo.rotateCustomerBookingLink(a);
  assert.notEqual(rotated.token,link.token);
  await assert.rejects(()=>guest.submit(intake),/Invalid booking link/);
  assert.equal((await guest.submit({...intake,token:rotated.token})).status,'PENDING');
  await assert.rejects(()=>guestPool.query('SELECT * FROM fc_bookings'),/permission denied/);
  await assert.rejects(()=>guestPool.query('SELECT * FROM fc_users'),/permission denied/);
  await assert.rejects(()=>guestPool.query('SELECT * FROM fc_public_requests'),/permission denied|row-level security/i);
  const audit=(await admin.query('SELECT action FROM fc_intake_events WHERE operator_id=$1',[first.operatorId])).rows;
  assert.deepEqual(audit.map(x=>x.action).sort(),['ACCEPTED','DECLINED']);
 }finally{await Promise.allSettled([admin.end(),auth.end(),ops.end(),guestPool.end()]);}
});
