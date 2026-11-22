import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {FleetRepository} from '../../persistent/repository.js';
import {passwordRecord} from '../../persistent/password.js';
import {createHash} from 'node:crypto';
const adminUrl=process.env.FC_TEST_ADMIN_URL,authUrl=process.env.FC_TEST_AUTH_URL,opsUrl=process.env.FC_TEST_OPS_URL;
if(!adminUrl||!authUrl||!opsUrl){
 test('isolated login throttle integration',{skip:'No isolated postgres credentials'},()=>{});
}else{
 test('failed attempts persist across repository instances and lock out valid credentials until expiry',{timeout:30000},async()=>{
  const admin=new pg.Pool({connectionString:adminUrl}),auth=new pg.Pool({connectionString:authUrl}),ops=new pg.Pool({connectionString:opsUrl});
  try{
   const op=(await admin.query("INSERT INTO fc_operators(name) VALUES('Throttle Test Operator') RETURNING id")).rows[0].id;
   const pass=await passwordRecord('long fictional test password!');
   const email='lockout-test@fictional.invalid';
   await admin.query("INSERT INTO fc_users(operator_id,email,password_salt,password_hash,role) VALUES($1,$2,$3,$4,'OWNER')",[op,email,pass.salt,pass.hash]);
   let repository=new FleetRepository({authPool:auth,operationsPool:ops});
   for(let n=1;n<=5;n++){
    await assert.rejects(()=>repository.login(email,'incorrect password'),n===5?/Too many sign-in attempts/:/Invalid credentials/);
   }
   repository=new FleetRepository({authPool:auth,operationsPool:ops});
   await assert.rejects(()=>repository.login(email,'long fictional test password!'),/Too many sign-in attempts/);
   const key=createHash('sha256').update(email).digest('hex');
   const locked=(await admin.query('SELECT failure_count,locked_until FROM fc_login_attempts WHERE email_key=$1',[key])).rows[0];
   assert.equal(locked.failure_count,5);assert.ok(new Date(locked.locked_until)>new Date());
   await admin.query("UPDATE fc_login_attempts SET locked_until=now()-interval '1 second',window_started_at=now()-interval '20 minutes' WHERE email_key=$1",[key]);
   const session=await repository.login(email,'long fictional test password!');
   assert.equal((await repository.actor(session.token)).operator_id,op);
   assert.equal((await admin.query('SELECT * FROM fc_login_attempts WHERE email_key=$1',[key])).rows.length,0);
   await assert.rejects(()=>ops.query('SELECT * FROM fc_login_attempts'),/permission denied/);
  }finally{await Promise.allSettled([admin.end(),auth.end(),ops.end()]);}
 });
}
