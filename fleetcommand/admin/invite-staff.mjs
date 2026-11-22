/** Offline-only staff invitation; operator must be explicitly authorized externally. */
import pg from 'pg';
import {OperatorProvisioner} from '../persistent/provisioning.js';
import {AccountRecovery} from '../persistent/recovery.js';
import {createMailDelivery} from '../persistent/mail.js';
const env=process.env;
const {FLEETCOMMAND_ADMIN_DATABASE_URL:adminUrl,FLEETCOMMAND_RECOVERY_DATABASE_URL:recoveryUrl,
 FC_STAFF_OPERATOR_ID:operatorId,FC_STAFF_EMAIL:email,FC_STAFF_ROLE:role,
 FC_STAFF_AUDIT_ACTOR:performedBy,FC_STAFF_AUDIT_REASON:reason}=env;
if(env.FC_STAFF_INVITE_ACK!=='ISOLATED_AUTHORIZED_OPERATOR_INVITE'||!adminUrl||!recoveryUrl||
 !operatorId||!email||!role||!performedBy||!reason)throw Error('Authorized isolated staff invitation configuration required');
const admin=new pg.Pool({connectionString:adminUrl}),recoveryPool=new pg.Pool({connectionString:recoveryUrl});
try{
 const name=(await admin.query('SELECT current_database() AS name')).rows[0].name;
 if(!/^fleetcommand_(pilot|test)$/.test(name))throw Error('Refusing non-isolated database');
 const provisioner=new OperatorProvisioner(admin);
 const result=await provisioner.inviteUser({operatorId,email,role,performedBy,reason});
 const recovery=new AccountRecovery(recoveryPool);
 const issued=await recovery.issue(email,'ACTIVATE');
 if(!issued.delivery)throw Error('Staff invitation activation token unavailable');
 const deliver=createMailDelivery({enabled:true,apiKey:env.FLEETCOMMAND_RESEND_API_KEY,
  fromAddress:env.FLEETCOMMAND_MAIL_FROM,baseUrl:env.FLEETCOMMAND_MAIL_BASE_URL,
  allowedRecipients:[email]});
 await deliver(issued.delivery);
 console.log('Staff activation requested for approved operator; no secret logged');
}catch(e){console.error('Invitation failed; verify account state before retrying');process.exitCode=1}
finally{await Promise.allSettled([admin.end(),recoveryPool.end()])}
