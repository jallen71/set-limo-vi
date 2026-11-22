/** Offline-only pilot billing. No charge capture or payment-provider assertions.
 * A trusted human admin must verify an external receipt before recording PAID.
 */
const AMOUNTS=Object.freeze({STARTER:4900,BUSINESS:9900,PRO:14900});
const reasonValue=r=>{if(typeof r!=='string'||r.trim().length<12)throw Error('Specific billing audit reason required');return r.trim()};
const actorValue=a=>{if(typeof a!=='string'||a.trim().length<3)throw Error('Verified billing administrator required');return a.trim()};
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s));
export class PilotBillingAdmin{
 constructor(adminPool){if(!adminPool||typeof adminPool.connect!=='function')throw Error('Separate trusted billing admin pool required');this.pool=adminPool}
 async transaction(fn){
  const db=await this.pool.connect();
  try{await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result}
  catch(err){await db.query('ROLLBACK');throw err}finally{db.release()}
 }
 async issue({operatorId,plan,periodStart,periodEnd,performedBy,reason}){
  const actor=actorValue(performedBy),why=reasonValue(reason);
  if(!operatorId||!Object.hasOwn(AMOUNTS,plan)||!validDate(periodStart)||!validDate(periodEnd)||periodStart>=periodEnd)
   throw Error('Invalid invoice parameters');
  return this.transaction(async db=>{
   const operator=(await db.query('SELECT id FROM fc_operators WHERE id=$1 FOR UPDATE',[operatorId])).rows[0];
   if(!operator)throw Error('Operator not found');
   const invoice=(await db.query(`INSERT INTO fc_invoices(operator_id,plan,amount_cents,period_start,period_end)
    VALUES($1,$2,$3,$4,$5) RETURNING *`,[operatorId,plan,AMOUNTS[plan],periodStart,periodEnd])).rows[0];
   await db.query(`INSERT INTO fc_invoice_events(invoice_id,operator_id,action,performed_by,reason)
    VALUES($1,$2,'ISSUED',$3,$4)`,[invoice.id,operatorId,actor,why]);
   return {id:invoice.id,operatorId,plan,currency:'USD',amountCents:invoice.amount_cents,status:'ISSUED'};
  });
 }
 async recordVerifiedPayment({invoiceId,externalReceipt,performedBy,reason}){
  const actor=actorValue(performedBy),why=reasonValue(reason),reference=String(externalReceipt||'').trim();
  if(!invoiceId||reference.length<8||reference.length>200)throw Error('Verified external receipt reference required');
  return this.transaction(async db=>{
   const invoice=(await db.query('SELECT * FROM fc_invoices WHERE id=$1 FOR UPDATE',[invoiceId])).rows[0];
   if(!invoice||invoice.status!=='ISSUED')throw Error('Invoice is not available for settlement');
   await db.query("UPDATE fc_invoices SET status='PAID',external_receipt=$2,paid_at=now() WHERE id=$1",[invoiceId,reference]);
   await db.query(`INSERT INTO fc_invoice_events(invoice_id,operator_id,action,performed_by,reason,external_reference)
    VALUES($1,$2,'PAID',$3,$4,$5)`,[invoiceId,invoice.operator_id,actor,why,reference]);
   await db.query(`INSERT INTO fc_subscriptions(operator_id,plan,status,provider,current_period_end,updated_at)
    VALUES($1,$2,'ACTIVE','MANUAL',$3,now())
    ON CONFLICT(operator_id) DO UPDATE SET plan=excluded.plan,status='ACTIVE',
     provider='MANUAL',current_period_end=GREATEST(fc_subscriptions.current_period_end,excluded.current_period_end),updated_at=now()`,
    [invoice.operator_id,invoice.plan,invoice.period_end]);
   return {invoiceId,status:'PAID'};
  });
 }
 async voidUnpaid({invoiceId,performedBy,reason}){
  const actor=actorValue(performedBy),why=reasonValue(reason);
  return this.transaction(async db=>{
   const invoice=(await db.query('SELECT * FROM fc_invoices WHERE id=$1 FOR UPDATE',[invoiceId])).rows[0];
   if(!invoice||invoice.status!=='ISSUED')throw Error('Only unpaid issued invoices may be voided');
   await db.query("UPDATE fc_invoices SET status='VOID' WHERE id=$1",[invoiceId]);
   await db.query(`INSERT INTO fc_invoice_events(invoice_id,operator_id,action,performed_by,reason)
    VALUES($1,$2,'VOID',$3,$4)`,[invoiceId,invoice.operator_id,actor,why]);
   return {invoiceId,status:'VOID'};
  });
 }
}
