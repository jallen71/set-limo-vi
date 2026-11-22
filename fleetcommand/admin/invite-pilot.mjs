/** Provision test owner without an initial password; optionally dispatch activation.
 * A privileged, one-time command, not a web application endpoint.
 */
import pg from 'pg';
import {OperatorProvisioner} from '../persistent/provisioning.js';
import {AccountRecovery} from '../persistent/recovery.js';
import {createMailDelivery} from '../persistent/mail.js';
const {FLEETCOMMAND_ADMIN_DATABASE_URL:adminUrl,FLEETCOMMAND_RECOVERY_DATABASE_URL:recoveryUrl,
 FLEETCOMMAND_PILOT_INVITE_ACK:ack,FLEETCOMMAND_PILOT_EMAIL:email,
 FLEETCOMMAND_PILOT_BUSINESS:business, FLEETCOMMAND_RESEND_API_KEY:key,
 FLEETCOMMAND_MAIL_FROM:from,FLEETCOMMAND_MAIL_BASE_URL:origin}=process.env;
if(ack!=='CREATE_ISOLATED_TEST_OPERATOR'||email!=='testingthings@gmail.com'||
 !adminUrl||!recoveryUrl||!business||!key||!from||!origin)
 throw Error('Isolated pilot invitation requires explicitly configured owner, database and email provider');
const admin=new pg.Pool({connectionString:adminUrl}),recoveryDb=new pg.Pool({connectionString:recoveryUrl});
try{
 const provisioner=new OperatorProvisioner(admin);
 let owner;
 const existing=await admin.query('SELECT u.id,u.operator_id,u.email_verified FROM fc_users u WHERE lower(u.email)=$1',[email]);
 if(existing.rows.length){
  if(existing.rows[0].email_verified)throw Error('Test administrator is already active; no invitation sent');
  owner={operatorId:existing.rows[0].operator_id,owner:{id:existing.rows[0].id,email},activationRequired:true};
 }else{
  owner=await provisioner.createOperator({businessName:business,ownerEmail:email,invitation:true,
   performedBy:'fleetcommand-pilot-bootstrap',reason:'Initial approved isolated pilot administrator invitation'});
 }
 const recovery=new AccountRecovery(recoveryDb);
 const delivery=createMailDelivery({enabled:true,apiKey:key,fromAddress:from,baseUrl:origin,
  allowedRecipients:[email]});
 const issued=await recovery.issue(email,'ACTIVATE');
 if(!issued.delivery)throw Error('Activation invitation could not be issued');
 await delivery(issued.delivery);
 console.log('Activation delivery requested for approved test administrator; no token printed');
}finally{await Promise.allSettled([admin.end(),recoveryDb.end()])}
