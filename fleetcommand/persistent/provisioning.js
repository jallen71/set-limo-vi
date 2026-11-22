/** Offline-only operator provisioning. Never expose this module through an HTTP route.
 * Accepts a separate migration/admin database pool, never the app's auth/operations pools.
 * Passwords are supplied by the authorized provisioning caller and never returned.
 */
import {passwordRecord} from './password.js';
import {randomBytes} from 'node:crypto';

const cleanEmail=s=>String(s||'').trim().toLowerCase();
const validEmail=s=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)&&s.length<=200;
const roles=new Set(['OWNER','DISPATCHER','DRIVER']);
const requireOperatorIdentity=s=>{if(typeof s!=='string'||s.trim().length<3)throw Error('Verified provisioning operator required');return s.trim();};
const ensureReason=s=>{if(typeof s!=='string'||s.trim().length<12)throw Error('Specific audit reason required');return s.trim();};
export class OperatorProvisioner{
 constructor(adminPool){if(!adminPool||typeof adminPool.connect!=='function')throw Error('Separate administrative pool required');this.pool=adminPool;}
 async transaction(fn){
  const client=await this.pool.connect();
  try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}
  catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
 }
 async createOperator({businessName,ownerEmail,ownerPassword,reason,performedBy}){
  const actor=requireOperatorIdentity(performedBy);
  ensureReason(reason);
  const name=String(businessName||'').trim(),email=cleanEmail(ownerEmail);
  if(name.length<2||name.length>150||!validEmail(email))throw Error('Invalid business or owner email');
  const secret=await passwordRecord(ownerPassword);
  return this.transaction(async db=>{
   const op=(await db.query('INSERT INTO fc_operators(name) VALUES($1) RETURNING id,name',[name])).rows[0];
   const user=(await db.query(`INSERT INTO fc_users(operator_id,email,password_salt,password_hash,role)
     VALUES($1,$2,$3,$4,'OWNER') RETURNING id,email,role`,[op.id,email,secret.salt,secret.hash])).rows[0];
   await db.query("INSERT INTO fc_admin_events(operator_id,subject_user_id,operation,performed_by,reason) VALUES($1,$2,'OPERATOR_CREATED',$3,$4)",[op.id,user.id,actor,reason.trim()]);
   return {operatorId:op.id,businessName:op.name,owner:{id:user.id,email:user.email,role:user.role}};
  });
 }
 async addUser({operatorId,email,password,role,reason,performedBy}){
  const actor=requireOperatorIdentity(performedBy);
  ensureReason(reason);
  const address=cleanEmail(email);
  if(!validEmail(address)||!roles.has(role)||!operatorId)throw Error('Invalid user registration');
  const secret=await passwordRecord(password);
  return this.transaction(async db=>{
   const found=await db.query('SELECT id FROM fc_operators WHERE id=$1 FOR UPDATE',[operatorId]);
   if(found.rows.length!==1)throw Error('Operator not found');
   const user=(await db.query(`INSERT INTO fc_users(operator_id,email,password_salt,password_hash,role)
     VALUES($1,$2,$3,$4,$5) RETURNING id,email,role`,[operatorId,address,secret.salt,secret.hash,role])).rows[0];
   if(role==='DRIVER')await db.query('INSERT INTO fc_drivers(user_id,operator_id,display_name) VALUES($1,$2,$3)',[user.id,operatorId,address]);
   await db.query("INSERT INTO fc_admin_events(operator_id,subject_user_id,operation,performed_by,reason) VALUES($1,$2,'USER_CREATED',$3,$4)",[operatorId,user.id,actor,reason.trim()]);
   return {id:user.id,email:user.email,role:user.role,operatorId};
  });
 }
 /** Create a pending invited user with no usable password until activation. */
 async inviteUser({operatorId,email,role,reason,performedBy}){
  const actor=requireOperatorIdentity(performedBy);
  ensureReason(reason);
  const address=cleanEmail(email);
  if(!validEmail(address)||!roles.has(role)||!operatorId)throw Error('Invalid invited user');
  const unusablePassword=await passwordRecord(randomBytes(48).toString('hex'));
  return this.transaction(async db=>{
   const found=await db.query('SELECT id FROM fc_operators WHERE id=$1 FOR UPDATE',[operatorId]);
   if(found.rows.length!==1)throw Error('Operator not found');
   const user=(await db.query(`INSERT INTO fc_users(operator_id,email,password_salt,password_hash,role,email_verified)
    VALUES($1,$2,$3,$4,$5,false) RETURNING id,email,role`,
    [operatorId,address,unusablePassword.salt,unusablePassword.hash,role])).rows[0];
   if(role==='DRIVER')await db.query('INSERT INTO fc_drivers(user_id,operator_id,display_name) VALUES($1,$2,$3)',[user.id,operatorId,address]);
   await db.query("INSERT INTO fc_admin_events(operator_id,subject_user_id,operation,performed_by,reason) VALUES($1,$2,'USER_CREATED',$3,$4)",
    [operatorId,user.id,actor,reason.trim()]);
   return {id:user.id,operatorId,email:user.email,role:user.role,activationRequired:true};
  });
 }
 async disableUser({operatorId,userId,reason,performedBy}){
  const actor=requireOperatorIdentity(performedBy);
  ensureReason(reason);
  return this.transaction(async db=>{
   const target=(await db.query('SELECT id,role,disabled FROM fc_users WHERE id=$1 AND operator_id=$2 FOR UPDATE',[userId,operatorId])).rows[0];
   if(!target)throw Error('User not found');
   if(target.role==='OWNER'){
    const count=(await db.query("SELECT count(*)::int AS n FROM fc_users WHERE operator_id=$1 AND role='OWNER' AND disabled=false",[operatorId])).rows[0].n;
    if(!target.disabled&&count<=1)throw Error('Cannot disable last active owner');
   }
   await db.query('UPDATE fc_users SET disabled=true WHERE id=$1 AND operator_id=$2',[userId,operatorId]);
   await db.query('DELETE FROM fc_drivers WHERE user_id=$1 AND operator_id=$2',[userId,operatorId]);
   await db.query('DELETE FROM fc_sessions WHERE user_id=$1',[userId]);
   await db.query("INSERT INTO fc_admin_events(operator_id,subject_user_id,operation,performed_by,reason) VALUES($1,$2,'USER_DISABLED',$3,$4)",[operatorId,userId,actor,reason.trim()]);
   return {disabled:true,id:userId,operatorId};
  });
 }
}
