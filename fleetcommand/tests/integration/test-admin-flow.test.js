import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {OperatorProvisioner} from '../../persistent/provisioning.js';
import {AccountRecovery} from '../../persistent/recovery.js';
import {FleetRepository} from '../../persistent/repository.js';
const {FC_TEST_ADMIN_URL:adminUrl,FC_TEST_AUTH_URL:authUrl,FC_TEST_OPS_URL:opsUrl,FC_TEST_RECOVERY_URL:recoveryUrl}=process.env;
if(!adminUrl||!authUrl||!opsUrl||!recoveryUrl)test('designated pilot administrator setup',{skip:'Test PostgreSQL unavailable'},()=>{});
else test('designated administrator can activate isolated test OWNER and create a share link',{timeout:30000},async()=>{
 const admin=new pg.Pool({connectionString:adminUrl}),auth=new pg.Pool({connectionString:authUrl}),
  ops=new pg.Pool({connectionString:opsUrl}),recoveryDb=new pg.Pool({connectionString:recoveryUrl});
 const provisioner=new OperatorProvisioner(admin),recovery=new AccountRecovery(recoveryDb);
 const repo=new FleetRepository({authPool:auth,operationsPool:ops});
 try{
  const operator=await provisioner.createOperator({businessName:'FleetCommand Test Pilot',
   ownerEmail:'testingthings@gmail.com',invitation:true,
   performedBy:'isolated-pilot-test',reason:'Test administrator activation acceptance test'});
  assert.equal(operator.activationRequired,true);
  await assert.rejects(()=>repo.login('testingthings@gmail.com','Any fictional password'),/Invalid credentials/);
  const issued=await recovery.issue('testingthings@gmail.com','ACTIVATE');
  assert.equal(issued.delivery.address,'testingthings@gmail.com');
  assert.equal(issued.delivery.purpose,'ACTIVATE');
  assert.equal(issued.delivery.token.length,64);
  const done=await recovery.consume(issued.delivery.token,'ACTIVATE','A strong test-only pilot password');
  assert.deepEqual(done,{completed:true});
  await assert.rejects(()=>recovery.consume(issued.delivery.token,'ACTIVATE','A strong test-only pilot password'),/Invalid or expired token/);
  const signed=await repo.login('testingthings@gmail.com','A strong test-only pilot password');
  const actor=await repo.actor(signed.token);
  assert.equal(actor.role,'OWNER');
  assert.equal(actor.operator_id,operator.operatorId);
  const vehicle=await repo.addVehicle(actor,{label:'Fictional Test Van',capacity:6});
  assert.equal(vehicle.capacity,6);
  assert.equal((await repo.listResources(actor)).vehicles.length,1);
  const link=await repo.rotateCustomerBookingLink(actor);
  assert.equal(link.token.length,64);
  await repo.logout(signed.token);
  await assert.rejects(()=>repo.actor(signed.token),/Authentication required/);
 }finally{await Promise.allSettled([admin.end(),auth.end(),ops.end(),recoveryDb.end()]);}
});
