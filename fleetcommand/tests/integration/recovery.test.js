import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {OperatorProvisioner} from '../../persistent/provisioning.js';
import {FleetRepository} from '../../persistent/repository.js';
import {AccountRecovery} from '../../persistent/recovery.js';
import {hashToken} from '../../persistent/password.js';

const {FC_TEST_ADMIN_URL:adminUrl,FC_TEST_AUTH_URL:authUrl,FC_TEST_OPS_URL:opsUrl,FC_TEST_RECOVERY_URL:recoveryUrl}=process.env;
if(!adminUrl||!authUrl||!opsUrl||!recoveryUrl){
 test('activation and reset require isolated PostgreSQL',{skip:'Missing CI recovery DB role'},()=>{});
}else{
 test('invitation activation, replay prevention, password reset, session revocation and role separation',{timeout:30000},async()=>{
  const admin=new pg.Pool({connectionString:adminUrl});
  const auth=new pg.Pool({connectionString:authUrl});
  const ops=new pg.Pool({connectionString:opsUrl});
  const recoveryDb=new pg.Pool({connectionString:recoveryUrl});
  const provisioner=new OperatorProvisioner(admin);
  const recovery=new AccountRecovery(recoveryDb);
  const repository=new FleetRepository({authPool:auth,operationsPool:ops});
  const reason='Fictional onboarding verification';
  const performedBy='isolated-test-operator';
  try{
   const op=await provisioner.createOperator({businessName:'Fictional Transport Service',
    ownerEmail:'recover-owner@fictional.invalid',ownerPassword:'initial strong fictional passphrase',
    reason,performedBy});
   const invited=await provisioner.inviteUser({operatorId:op.operatorId,email:'invited@fictional.invalid',
    role:'DISPATCHER',reason,performedBy});
   assert.equal(invited.activationRequired,true);
   await assert.rejects(()=>repository.login('invited@fictional.invalid','incorrect password'),/Invalid credentials/);
   const unknown=await recovery.issue('nonexistent@fictional.invalid','RESET');
   assert.deepEqual(unknown,{accepted:true,delivery:null});
   const missing=await recovery.issue('nonexistent@fictional.invalid','ACTIVATE');
   assert.deepEqual(missing,{accepted:true,delivery:null});
   const first=await recovery.issue('invited@fictional.invalid','ACTIVATE');
   assert.equal(first.delivery.address,'invited@fictional.invalid');
   assert.equal(first.delivery.token.length,64);
   assert.equal((await admin.query('SELECT token_hash FROM fc_account_tokens WHERE user_id=$1',[invited.id])).rows[0].token_hash,
    hashToken(first.delivery.token));
   assert.equal((await recovery.issue('invited@fictional.invalid','RESET')).delivery,null);
   const newer=await recovery.issue('invited@fictional.invalid','ACTIVATE');
   assert.notEqual(first.delivery.token,newer.delivery.token);
   await assert.rejects(()=>recovery.consume(first.delivery.token,'ACTIVATE','verified password for fictional user'),/Invalid or expired token/);
   const fresh=newer.delivery.token;
   await admin.query("UPDATE fc_account_tokens SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[hashToken(fresh)]);
   await assert.rejects(()=>recovery.consume(fresh,'ACTIVATE','verified password for fictional user'),/Invalid or expired token/);
   const active=await recovery.issue('invited@fictional.invalid','ACTIVATE');
   await assert.rejects(()=>recovery.consume(active.delivery.token,'RESET','verified password for fictional user'),/Invalid or expired token/);
   assert.deepEqual(await recovery.consume(active.delivery.token,'ACTIVATE','verified password for fictional user'),{completed:true});
   await assert.rejects(()=>recovery.consume(active.delivery.token,'ACTIVATE','verified password for fictional user'),/Invalid or expired token/);
   const session=await repository.login('invited@fictional.invalid','verified password for fictional user');
   assert.equal((await repository.actor(session.token)).operator_id,op.operatorId);
   const reset=await recovery.issue('invited@fictional.invalid','RESET');
   assert.equal(reset.delivery.purpose,'RESET');
   await recovery.consume(reset.delivery.token,'RESET','replacement fictional password!');
   await assert.rejects(()=>repository.actor(session.token),/Authentication required/);
   await assert.rejects(()=>repository.login('invited@fictional.invalid','verified password for fictional user'),/Invalid credentials/);
   assert.ok((await repository.login('invited@fictional.invalid','replacement fictional password!')).token);
   await assert.rejects(()=>recovery.consume(reset.delivery.token,'RESET','replacement fictional password 2'),/Invalid or expired token/);
   await assert.rejects(()=>auth.query('SELECT * FROM fc_account_tokens'),/permission denied/);
   await assert.rejects(()=>ops.query('SELECT * FROM fc_account_tokens'),/permission denied/);
   await assert.rejects(()=>recoveryDb.query("UPDATE fc_users SET role='OWNER' WHERE id=$1",[invited.id]),/permission denied/);
   await assert.rejects(()=>recoveryDb.query("UPDATE fc_users SET disabled=false WHERE id=$1",[invited.id]),/permission denied/);
  }finally{await Promise.allSettled([admin.end(),auth.end(),ops.end(),recoveryDb.end()]);}
 });
}
