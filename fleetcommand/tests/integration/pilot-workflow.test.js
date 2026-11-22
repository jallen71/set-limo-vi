import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {OperatorProvisioner} from '../../persistent/provisioning.js';
import {FleetRepository} from '../../persistent/repository.js';
const a=process.env.FC_TEST_ADMIN_URL,b=process.env.FC_TEST_AUTH_URL,c=process.env.FC_TEST_OPS_URL;
if(!a||!b||!c){test('pilot driver integration',{skip:'Isolated PostgreSQL not configured'},()=>{});}
else test('pilot: operator fleet choices, vehicle capacity and restricted driver trips',{timeout:30000},async()=>{
 const admin=new pg.Pool({connectionString:a}),auth=new pg.Pool({connectionString:b}),ops=new pg.Pool({connectionString:c});
 const manager=new OperatorProvisioner(admin),repo=new FleetRepository({authPool:auth,operationsPool:ops});
 const reason='Pilot workflow integration test',performedBy='trusted-fake-admin';
 try{
  const owner=await manager.createOperator({businessName:'Pilot A Fleet',ownerEmail:'pilot-owner@fictional.invalid',
   ownerPassword:'Strong pilot owner password',reason,performedBy});
  const other=await manager.createOperator({businessName:'Pilot B Fleet',ownerEmail:'pilot-other@fictional.invalid',
   ownerPassword:'Strong pilot owner password',reason,performedBy});
  const driver=await manager.addUser({operatorId:owner.operatorId,email:'pilot-driver@fictional.invalid',
   password:'Strong pilot driver password',role:'DRIVER',reason,performedBy});
  const aActor=await repo.actor((await repo.login('pilot-owner@fictional.invalid','Strong pilot owner password')).token);
  const bActor=await repo.actor((await repo.login('pilot-other@fictional.invalid','Strong pilot owner password')).token);
  const driverActor=await repo.actor((await repo.login('pilot-driver@fictional.invalid','Strong pilot driver password')).token);
  const vehicle=await repo.addVehicle(aActor,{label:'Test Minivan',capacity:4});
  const data=await repo.listResources(aActor);
  assert.equal(data.vehicles[0].id,vehicle.id);
  assert.equal(data.drivers[0].id,driver.id);
  assert.deepEqual(await repo.listResources(bActor),{vehicles:[],drivers:[]});
  await assert.rejects(()=>repo.listResources(driverActor),/Insufficient role/);
  await assert.rejects(()=>repo.addVehicle(driverActor,{label:'Invalid Van',capacity:6}),/Insufficient role/);
  const trip=await repo.createBooking(aActor,{customerName:'Pilot Rider',pickup:'Marina',dropoff:'Airport',
   startsAt:'2026-12-15T11:00:00Z',endsAt:'2026-12-15T12:00:00Z',passengers:5});
  await repo.transition(aActor,trip.id,{status:'CONFIRMED',reason:'Dispatcher confirmed trip'});
  const invalid=()=>repo.transition(aActor,trip.id,{status:'ASSIGNED',reason:'Fleet capacity validation',driverId:driver.id,vehicleId:vehicle.id});
  await assert.rejects(invalid,/capacity/);
  assert.equal((await repo.listBookings(aActor))[0].status,'CONFIRMED');
  const valid=await repo.addVehicle(aActor,{label:'Large Van',capacity:8});
  await repo.transition(aActor,trip.id,{status:'ASSIGNED',reason:'Fleet assigned driver',driverId:driver.id,vehicleId:valid.id});
  assert.equal((await repo.listBookings(driverActor)).length,1);
  assert.equal((await repo.listBookings(bActor)).length,0);
  await assert.rejects(()=>repo.transition(bActor,trip.id,{status:'IN_PROGRESS',reason:'Wrong operator trying'}),/not found/i);
  await repo.transition(driverActor,trip.id,{status:'IN_PROGRESS',reason:'Picked up passengers'});
  await repo.transition(driverActor,trip.id,{status:'COMPLETED',reason:'Passengers delivered'});
  assert.equal((await repo.listBookings(aActor))[0].status,'COMPLETED');
  assert.equal((await repo.listEvents(aActor)).length,5);
  await manager.disableUser({operatorId:owner.operatorId,userId:driver.id,
   reason:'Retiring test driver account',performedBy});
  assert.equal((await repo.listResources(aActor)).drivers.length,0);
 }finally{await Promise.allSettled([admin.end(),auth.end(),ops.end()]);}
});
