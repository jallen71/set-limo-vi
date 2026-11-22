import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {OperatorProvisioner} from '../../persistent/provisioning.js';
import {FleetRepository} from '../../persistent/repository.js';
const adminUrl=process.env.FC_TEST_ADMIN_URL,authUrl=process.env.FC_TEST_AUTH_URL,opsUrl=process.env.FC_TEST_OPS_URL;
if(!adminUrl||!authUrl||!opsUrl){
 test('offline provisioning requires isolated PostgreSQL', {skip:'CI credentials absent'},()=>{});
}else{
 test('offline provisioning creates operators, prevents duplicates, audits changes and revokes staff sessions',{timeout:30000},async()=>{
  const admin=new pg.Pool({connectionString:adminUrl});
  const auth=new pg.Pool({connectionString:authUrl});
  const ops=new pg.Pool({connectionString:opsUrl});
  const provisioner=new OperatorProvisioner(admin),repo=new FleetRepository({authPool:auth,operationsPool:ops});
  const performedBy='isolated-test-provisioner';
  const reason='Fictional pilot operator setup';
  try{
   await assert.rejects(()=>provisioner.createOperator({businessName:'Test',ownerEmail:'test@fictional.invalid',
      ownerPassword:'safe fictional password',reason}),/provisioning operator/);
   const created=await provisioner.createOperator({businessName:'Fictional Shuttle',ownerEmail:'pilot@fictional.invalid',
     ownerPassword:'long fictional password only!',reason,performedBy});
   assert.equal(created.owner.role,'OWNER');
   await assert.rejects(()=>provisioner.createOperator({businessName:'Duplicate',ownerEmail:'PILOT@FICTIONAL.INVALID',
     ownerPassword:'long fictional password only!',reason,performedBy}),/duplicate key/);
   const staff=await provisioner.addUser({operatorId:created.operatorId,email:'staff@fictional.invalid',
     password:'long fictional password only!',role:'DISPATCHER',reason,performedBy});
   assert.equal(staff.role,'DISPATCHER');
   const session=await repo.login('staff@fictional.invalid','long fictional password only!');
   assert.equal((await repo.actor(session.token)).id,staff.id);
   await assert.rejects(()=>provisioner.disableUser({operatorId:created.operatorId,userId:created.owner.id,
     reason:'Trying to disable only owner',performedBy}),/last active owner/);
   const disabled=await provisioner.disableUser({operatorId:created.operatorId,userId:staff.id,
     reason:'Fictional test staff departure',performedBy});
   assert.equal(disabled.disabled,true);
   await assert.rejects(()=>repo.actor(session.token),/Authentication required/);
   await assert.rejects(()=>repo.login('staff@fictional.invalid','long fictional password only!'),/Invalid credentials/);
   const audit=(await admin.query('SELECT operation,performed_by,reason FROM fc_admin_events WHERE operator_id=$1 ORDER BY occurred_at,id',[created.operatorId])).rows;
   assert.deepEqual(audit.map(x=>x.operation).sort(),['OPERATOR_CREATED','USER_CREATED','USER_DISABLED'].sort());
   assert.ok(audit.every(x=>x.performed_by===performedBy&&x.reason.length>=12));
   await assert.rejects(()=>auth.query('SELECT * FROM fc_admin_events'),/permission denied/);
   await assert.rejects(()=>ops.query('SELECT * FROM fc_admin_events'),/permission denied/);
  }finally{await Promise.allSettled([admin.end(),auth.end(),ops.end()]);}
 });
}
