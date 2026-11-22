/** Public request intake: independent from payment and dispatch.
 * Only the dedicated guest role can use this adapter; it has no access to
 * confirmed bookings, users, sessions, or billing.
 */
import {createHash} from 'node:crypto';
import {validateBooking} from '../src/domain.js';
const tokenHash=token=>createHash('sha256').update(token).digest('hex');
export class GuestBookingIntake{
 constructor(guestPool){if(!guestPool||typeof guestPool.connect!=='function')throw Error('Dedicated guest database pool required');this.pool=guestPool;}
 async submit({token,email,...input}){
  if(!/^[0-9a-f]{64}$/.test(String(token||'')))throw Error('Invalid booking link');
  const address=String(email||'').trim().toLowerCase();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)||address.length>200)
   throw Error('Valid customer email required');
  const client=await this.pool.connect();
  try{
   await client.query('BEGIN');
   const link=(await client.query('SELECT operator_id FROM fc_public_links WHERE token_hash=$1 AND enabled=true',
    [tokenHash(token)])).rows[0];
   if(!link)throw Error('Invalid booking link');
   const b=validateBooking({...input,operatorId:link.operator_id});
   await client.query("SELECT set_config('fleetcommand.operator_id',$1,true)",[link.operator_id]);
   const {rows}=await client.query(
    `INSERT INTO fc_public_requests(operator_id,customer_name,email,pickup,dropoff,starts_at,ends_at,passengers)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,status`,
    [link.operator_id,b.customerName,address,b.pickup,b.dropoff,b.startsAt,b.endsAt,b.passengers]);
   await client.query('COMMIT');
   return {requestId:rows[0].id,status:rows[0].status,message:'Request received; operator confirmation is required'};
  }catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
 }
}
