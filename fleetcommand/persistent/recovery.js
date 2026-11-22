/** Trusted server-side account recovery service. Never expose issued tokens through public API.
 * Requires a separate narrowly-permissioned recovery DB role and a trusted
 * out-of-band delivery worker. No messages are sent by this module.
 */
import {randomBytes} from 'node:crypto';
import {hashToken,passwordRecord} from './password.js';
const MAX_TOKEN_AGE={ACTIVATE:24*3600,RESET:30*60};
function normalizeEmail(email){
 if(typeof email!=='string'||email.length>200||!email.includes('@'))throw Error('Invalid email');
 return email.trim().toLowerCase();
}
function validToken(token){return typeof token==='string'&&/^[0-9a-f]{64}$/.test(token);}
export class AccountRecovery{
 constructor(recoveryPool){if(!recoveryPool||typeof recoveryPool.connect!=='function')throw Error('Separate recovery pool required');this.pool=recoveryPool;}
 async transaction(callback){
  const db=await this.pool.connect();
  try{
   await db.query('BEGIN');const value=await callback(db);await db.query('COMMIT');return value;
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
 }
 /** Return token only to a trusted dispatch worker; callers must not log it. */
 async issue(email,purpose){
  const address=normalizeEmail(email);
  if(!Object.hasOwn(MAX_TOKEN_AGE,purpose))throw Error('Invalid token purpose');
  return this.transaction(async db=>{
   // Prevent concurrent token issuance and ensure no user existence feedback.
   const row=(await db.query('SELECT id,email,email_verified,disabled FROM fc_users WHERE lower(email)=$1 FOR UPDATE',[address])).rows[0];
   if(!row||row.disabled||(purpose==='ACTIVATE'&&row.email_verified)||(purpose==='RESET'&&!row.email_verified))
    return {accepted:true,delivery:null};
   await db.query('DELETE FROM fc_account_tokens WHERE user_id=$1 AND purpose=$2',[row.id,purpose]);
   const token=randomBytes(32).toString('hex'),hash=hashToken(token);
   await db.query('INSERT INTO fc_account_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+($4::int * interval \'1 second\'))',
    [hash,row.id,purpose,MAX_TOKEN_AGE[purpose]]);
   // Internal-only delivery object; never return this through HTTP.
   return {accepted:true,delivery:{address:row.email,token,purpose}};
  });
 }
 async consume(token,purpose,newPassword){
  if(!validToken(token)||!Object.hasOwn(MAX_TOKEN_AGE,purpose))throw Error('Invalid or expired token');
  const secret=await passwordRecord(newPassword);
  return this.transaction(async db=>{
   const record=(await db.query(
    'SELECT user_id FROM fc_account_tokens WHERE token_hash=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE',
    [hashToken(token),purpose])).rows[0];
   if(!record)throw Error('Invalid or expired token');
   const user=(await db.query('SELECT id,email_verified,disabled FROM fc_users WHERE id=$1 FOR UPDATE',[record.user_id])).rows[0];
   if(!user||user.disabled||purpose==='ACTIVATE'&&user.email_verified||purpose==='RESET'&&!user.email_verified)
    throw Error('Invalid or expired token');
   await db.query('UPDATE fc_users SET password_salt=$2,password_hash=$3,email_verified=true WHERE id=$1',
    [record.user_id,secret.salt,secret.hash]);
   await db.query('UPDATE fc_account_tokens SET consumed_at=now() WHERE token_hash=$1',[hashToken(token)]);
   await db.query('DELETE FROM fc_account_tokens WHERE user_id=$1 AND consumed_at IS NULL',[record.user_id]);
   await db.query('DELETE FROM fc_sessions WHERE user_id=$1',[record.user_id]);
   return {completed:true};
  });
 }
}
