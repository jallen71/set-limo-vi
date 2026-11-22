import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {OperatorProvisioner} from '../../persistent/provisioning.js';
import {PilotBillingAdmin} from '../../persistent/pilot-billing.js';
import {FleetRepository} from '../../persistent/repository.js';
const {FC_TEST_ADMIN_URL:adminUrl,FC_TEST_AUTH_URL:authUrl,FC_TEST_OPS_URL:opsUrl}=process.env;
if(!adminUrl||!authUrl||!opsUrl)test('isolated billing records',{skip:'No test database'},()=>{});
else test('manual subscriptions: issue, audit, record external receipt, reject duplicate and cross-tenant visibility',{timeout:30000},async()=>{
 const admin=new pg.Pool({connectionString:adminUrl}),auth=new pg.Pool({connectionString:authUrl}),ops=new pg.Pool({connectionString:opsUrl});
 const bill=new PilotBillingAdmin(admin),provisioner=new OperatorProvisioner(admin),repo=new FleetRepository({authPool:auth,operationsPool:ops});
 const performedBy='fictional-billing-admin',reason='Pilot paid invoice reconciliation';
 try{
  const a=await provisioner.createOperator({businessName:'Billing Pilot A',ownerEmail:'billing-owner-a@fictional.invalid',
    ownerPassword:'Strong fictional A password',performedBy,reason});
  await provisioner.createOperator({businessName:'Billing Pilot B',ownerEmail:'billing-owner-b@fictional.invalid',
    ownerPassword:'Strong fictional B password',performedBy,reason});
  const ownerA=await repo.actor((await repo.login('billing-owner-a@fictional.invalid','Strong fictional A password')).token);
  const ownerB=await repo.actor((await repo.login('billing-owner-b@fictional.invalid','Strong fictional B password')).token);
  assert.equal((await repo.billingSummary(ownerA)).subscription.status,'PILOT');
  await assert.rejects(()=>bill.issue({operatorId:a.operatorId,plan:'STARTER',periodStart:'2026-12-01',
    periodEnd:'2027-01-01',performedBy,reason:'x'}),/reason/);
  const invoice=await bill.issue({operatorId:a.operatorId,plan:'STARTER',periodStart:'2026-12-01',
    periodEnd:'2027-01-01',performedBy,reason});
  assert.equal(invoice.amountCents,4900);assert.equal(invoice.status,'ISSUED');
  await assert.rejects(()=>bill.issue({operatorId:a.operatorId,plan:'STARTER',periodStart:'2026-12-01',
    periodEnd:'2027-01-01',performedBy,reason}),/duplicate key/i);
  assert.equal((await repo.billingSummary(ownerA)).invoices.length,1);
  assert.equal((await repo.billingSummary(ownerB)).invoices.length,0);
  await assert.rejects(()=>ops.query('UPDATE fc_invoices SET status=$1',['PAID']),/permission denied/);
  await assert.rejects(()=>auth.query('SELECT * FROM fc_invoices'),/permission denied/);
  await bill.recordVerifiedPayment({invoiceId:invoice.id,externalReceipt:'TEST-RECEIPT-123456',
    performedBy,reason:'Verified external fictional test receipt'});
  assert.equal((await repo.billingSummary(ownerA)).subscription.status,'ACTIVE');
  assert.equal((await repo.billingSummary(ownerA)).invoices[0].status,'PAID');
  await assert.rejects(()=>bill.recordVerifiedPayment({invoiceId:invoice.id,externalReceipt:'TEST-RECEIPT-123456',
    performedBy,reason:'Trying double settlement'}),/not available/);
  await assert.rejects(()=>bill.voidUnpaid({invoiceId:invoice.id,performedBy,reason}),/Only unpaid/);
  const history=(await admin.query('SELECT action,performed_by FROM fc_invoice_events WHERE invoice_id=$1 ORDER BY created_at,id',[invoice.id])).rows;
  assert.deepEqual(history.map(x=>x.action),['ISSUED','PAID']);
  assert.ok(history.every(x=>x.performed_by===performedBy));
  await assert.rejects(()=>ops.query('DELETE FROM fc_invoice_events'),/permission denied/);
 }finally{await Promise.allSettled([admin.end(),auth.end(),ops.end()]);}
});
