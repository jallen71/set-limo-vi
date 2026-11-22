/** Offline-only pilot subscription accounting; does not contact a payment provider. */
import pg from 'pg';
import {PilotBillingAdmin} from '../persistent/pilot-billing.js';
const e=process.env,mode=process.argv[2];
if(e.FC_BILLING_ACK!=='ISOLATED_EXTERNAL_RECEIPT_REVIEW'||
 !e.FLEETCOMMAND_ADMIN_DATABASE_URL||!e.FC_BILLING_ACTOR||!e.FC_BILLING_REASON)
 throw Error('Verified offline billing administrator and reason required');
const admin=new pg.Pool({connectionString:e.FLEETCOMMAND_ADMIN_DATABASE_URL});
try{
 const name=(await admin.query('SELECT current_database() AS name')).rows[0].name;
 if(!/^fleetcommand_(pilot|test)$/.test(name))throw Error('Refusing non-isolated billing database');
 const billing=new PilotBillingAdmin(admin);
 let result;
 if(mode==='issue'){
  const [operatorId,plan,periodStart,periodEnd]=process.argv.slice(3);
  result=await billing.issue({operatorId,plan,periodStart,periodEnd,performedBy:e.FC_BILLING_ACTOR,reason:e.FC_BILLING_REASON});
 }else if(mode==='settle'){
  const invoiceId=process.argv[3];
  result=await billing.recordVerifiedPayment({invoiceId,externalReceipt:e.FC_EXTERNAL_RECEIPT,
   performedBy:e.FC_BILLING_ACTOR,reason:e.FC_BILLING_REASON});
 }else if(mode==='void'){
  const invoiceId=process.argv[3];
  result=await billing.voidUnpaid({invoiceId,performedBy:e.FC_BILLING_ACTOR,reason:e.FC_BILLING_REASON});
 }else throw Error('Billing action must be issue, settle or void');
 console.log(JSON.stringify(result));
}catch(e){console.error('Billing operation failed:',e.message);process.exitCode=1}
finally{await admin.end()}
