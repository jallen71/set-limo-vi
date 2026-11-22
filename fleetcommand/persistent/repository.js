// PostgreSQL persistence adapter. Operational calls must use a least-privilege
// DB role; the auth pool must be a separate credential limited to users/sessions.
import {randomBytes} from 'node:crypto';
import {hashToken,verifyPassword} from './password.js';
import {validateBooking,transitionBooking} from '../src/domain.js';
const assertUuid=value=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value||'')))throw Error('Invalid record ID');return value;};
export class FleetRepository{
 constructor({authPool,operationsPool}){if(!authPool||!operationsPool)throw Error('Two separate DB pools required');this.auth=authPool;this.operations=operationsPool;}
 async login(email,password){
  if(typeof email!=='string'||typeof password!=='string'||email.length>200||password.length>256)throw Error('Invalid credentials');
  const {rows}=await this.auth.query('SELECT id,operator_id,email,role,password_salt,password_hash,disabled FROM fc_users WHERE lower(email)=lower($1) LIMIT 1',[email.trim()]);
  const u=rows[0];
  if(!u||u.disabled||!await verifyPassword(password,u.password_salt,u.password_hash))throw Error('Invalid credentials');
  const token=randomBytes(32).toString('hex');
  await this.auth.query("INSERT INTO fc_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",[hashToken(token),u.id]);
  return {token,operatorId:u.operator_id,role:u.role};
 }
 async actor(token){
  if(typeof token!=='string'||!/^[0-9a-f]{64}$/.test(token))throw Error('Authentication required');
  const {rows}=await this.auth.query(`SELECT u.id,u.operator_id,u.role FROM fc_sessions s JOIN fc_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.disabled=false`,[hashToken(token)]);
  if(!rows.length)throw Error('Authentication required');
  return rows[0];
 }
 async logout(token){if(typeof token==='string'&&/^[0-9a-f]{64}$/.test(token))await this.auth.query('DELETE FROM fc_sessions WHERE token_hash=$1',[hashToken(token)]);}
 async scoped(actor,action){
  if(!actor||!actor.operator_id||!actor.id)throw Error('Verified actor required');
  const client=await this.operations.connect();
  try{
   await client.query('BEGIN');
   await client.query("SELECT set_config('fleetcommand.operator_id',$1,true)",[actor.operator_id]);
   const result=await action(client);
   await client.query('COMMIT');return result;
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 async listBookings(actor){return this.scoped(actor,async db=>(await db.query('SELECT * FROM fc_bookings ORDER BY starts_at,id')).rows);}
 async createBooking(actor,input){
  if(!['OWNER','DISPATCHER'].includes(actor.role))throw Error('Insufficient role');
  const b=validateBooking({...input,operatorId:actor.operator_id});
  return this.scoped(actor,async db=>{
   const {rows}=await db.query(`INSERT INTO fc_bookings(operator_id,customer_name,pickup,dropoff,starts_at,ends_at,passengers,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,'REQUESTED') RETURNING *`,[actor.operator_id,b.customerName,b.pickup,b.dropoff,b.startsAt,b.endsAt,b.passengers]);
   const r=rows[0];await db.query(`INSERT INTO fc_events(operator_id,booking_id,actor_id,new_status,reason)
    VALUES($1,$2,$3,'REQUESTED','New booking request')`,[actor.operator_id,r.id,actor.id]);return r;
  });
 }
 async transition(actor,id,input){
  if(!['OWNER','DISPATCHER'].includes(actor.role))throw Error('Insufficient role');
  assertUuid(id);
  return this.scoped(actor,async db=>{
   // Operator-wide advisory lock serializes assignments, including competing requests.
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[actor.operator_id]);
   const {rows}=await db.query('SELECT * FROM fc_bookings WHERE id=$1 FOR UPDATE',[id]);
   if(!rows.length)throw Error('Booking not found');
   const b=rows[0];
   const list=(await db.query("SELECT * FROM fc_bookings WHERE status NOT IN ('CANCELLED','COMPLETED')")).rows;
   const normalize=x=>({id:x.id,operatorId:x.operator_id,status:x.status,startsAt:x.starts_at,
      endsAt:x.ends_at,driverId:x.driver_id,vehicleId:x.vehicle_id});
   const result=transitionBooking({booking:normalize(b),operatorId:actor.operator_id,
    nextStatus:input.status,actorId:actor.id,reason:input.reason,driverId:input.driverId,
    vehicleId:input.vehicleId,bookings:list.map(normalize)});
   const next=result.booking;
   const updated=await db.query('UPDATE fc_bookings SET status=$1,driver_id=$2,vehicle_id=$3 WHERE id=$4 RETURNING *',
    [next.status,next.driverId,next.vehicleId,id]);
   await db.query('INSERT INTO fc_events(operator_id,booking_id,actor_id,previous_status,new_status,reason) VALUES($1,$2,$3,$4,$5,$6)',
    [actor.operator_id,id,actor.id,b.status,next.status,result.audit.reason]);
   return updated.rows[0];
  });
 }
}
