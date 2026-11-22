// PostgreSQL persistence adapter. Operational calls must use a least-privilege
// DB role; the auth pool must be a separate credential limited to users/sessions.
import {randomBytes,createHash} from 'node:crypto';
import {hashToken,verifyPassword} from './password.js';
import {validateBooking,transitionBooking} from '../src/domain.js';
const assertUuid=value=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value||'')))throw Error('Invalid record ID');return value;};
export class FleetRepository{
 constructor({authPool,operationsPool}){if(!authPool||!operationsPool)throw Error('Two separate DB pools required');this.auth=authPool;this.operations=operationsPool;}
 async login(email,password){
  if(typeof email!=='string'||typeof password!=='string'||email.length>200||password.length>256)
   throw Error('Invalid credentials');
  const normalized=email.trim().toLowerCase();
  if(!normalized)throw Error('Invalid credentials');
  const emailKey=createHash('sha256').update(normalized).digest('hex');
  const db=await this.auth.connect();
  let outcome;
  try{
   await db.query('BEGIN');
   // Per-identifier advisory lock prevents simultaneous attempts bypassing limits.
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[emailKey]);
   await db.query('INSERT INTO fc_login_attempts(email_key) VALUES($1) ON CONFLICT DO NOTHING',[emailKey]);
   const attempt=(await db.query('SELECT failure_count,window_started_at,locked_until FROM fc_login_attempts WHERE email_key=$1 FOR UPDATE',[emailKey])).rows[0];
   const now=Date.now();
   if(attempt.locked_until&&new Date(attempt.locked_until).getTime()>now){
    outcome={error:'Too many sign-in attempts. Try again later.'};
   }else{
    const fresh=now-new Date(attempt.window_started_at).getTime()>15*60*1000;
    const {rows}=await db.query('SELECT id,operator_id,email,role,password_salt,password_hash,disabled,email_verified FROM fc_users WHERE lower(email)=$1 LIMIT 1',[normalized]);
    const user=rows[0];
    const valid=!!user&&!user.disabled&&user.email_verified&&await verifyPassword(password,user.password_salt,user.password_hash);
    if(!valid){
     const count=(fresh?0:Number(attempt.failure_count))+1;
     await db.query(`UPDATE fc_login_attempts SET failure_count=$2,window_started_at=CASE WHEN $3 THEN now() ELSE window_started_at END,
      locked_until=CASE WHEN $2>=5 THEN now()+interval '15 minutes' ELSE NULL END WHERE email_key=$1`,[emailKey,count,fresh]);
     outcome={error:count>=5?'Too many sign-in attempts. Try again later.':'Invalid credentials'};
    }else{
     const token=randomBytes(32).toString('hex');
     await db.query("INSERT INTO fc_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",[hashToken(token),user.id]);
     await db.query('DELETE FROM fc_login_attempts WHERE email_key=$1',[emailKey]);
     outcome={token,operatorId:user.operator_id,role:user.role};
    }
   }
   await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}
  finally{db.release();}
  if(outcome.error)throw Error(outcome.error);
  return outcome;
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
 async listResources(actor){
  if(!['OWNER','DISPATCHER'].includes(actor.role))throw Error('Insufficient role');
  return this.scoped(actor,async db=>{
   const vehicles=(await db.query('SELECT id,label,capacity FROM fc_vehicles ORDER BY label,id')).rows;
   const drivers=(await db.query('SELECT user_id AS id,display_name AS name FROM fc_drivers ORDER BY display_name,user_id')).rows;
   return {vehicles,drivers};
  });
 }
 async addVehicle(actor,{label,capacity}){
  if(actor.role!=='OWNER')throw Error('Insufficient role');
  const name=String(label||'').trim(),seats=Number(capacity);
  if(name.length<2||name.length>80||!Number.isInteger(seats)||seats<1||seats>50)
   throw Error('Invalid vehicle');
  return this.scoped(actor,async db=>{
   const row=(await db.query('INSERT INTO fc_vehicles(operator_id,label,capacity) VALUES($1,$2,$3) RETURNING id,label,capacity',
    [actor.operator_id,name,seats])).rows[0];
   return row;
  });
 }
 async listBookings(actor){return this.scoped(actor,async db=>(await db.query('SELECT * FROM fc_bookings ORDER BY starts_at,id')).rows);}
 async listEvents(actor){
  return this.scoped(actor,async db=>(await db.query(
   'SELECT operator_id,booking_id,actor_id,previous_status,new_status,reason,occurred_at FROM fc_events ORDER BY occurred_at DESC,id DESC LIMIT 200'
  )).rows);
 }
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
