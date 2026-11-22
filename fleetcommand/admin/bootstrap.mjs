/** One-time isolated database initializer. NEVER use with the live SET data store. */
import pg from 'pg';
import {readFile} from 'node:fs/promises';
const {FLEETCOMMAND_ADMIN_DATABASE_URL:url,FLEETCOMMAND_ADMIN_ACK:ack,
 FC_AUTH_PASSWORD:authPassword,FC_OPS_PASSWORD:opsPassword,FC_RECOVERY_PASSWORD:recoveryPassword,FC_GUEST_PASSWORD:guestPassword}=process.env;
if(ack!=='ISOLATED_FLEETCOMMAND_DATABASE'||!url)throw Error('An explicit isolated FleetCommand database acknowledgement is required');
const secrets={fc_auth_app:authPassword,fc_ops_app:opsPassword,fc_recovery_app:recoveryPassword,fc_guest_app:guestPassword};
if(Object.values(secrets).some(s=>typeof s!=='string'||s.length<20)||new Set(Object.values(secrets)).size!==3)
 throw Error('Four distinct strong DB role passwords are required');
const admin=new pg.Client({connectionString:url});
await admin.connect();
try{
 const db=(await admin.query('SELECT current_database() AS name')).rows[0].name;
 if(!/^fleetcommand_(pilot|test)$/.test(db))throw Error('Refusing to initialize a database outside isolated FleetCommand environments');
 await admin.query(await readFile(new URL('../persistent/001_schema.sql',import.meta.url),'utf8'));
 for(const [name,password] of Object.entries(secrets)){
  const found=(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[name])).rows.length>0;
  if(!found){
   const statement=(await admin.query('SELECT format($1::text,$2::text,$3::text) AS sql',['CREATE ROLE %I LOGIN PASSWORD %L',name,password])).rows[0].sql;
   await admin.query(statement);
  }
 }
 // No application role receives CREATE or table-owner privileges.
 await admin.query(`GRANT USAGE ON SCHEMA public TO fc_auth_app,fc_ops_app,fc_recovery_app,fc_guest_app;
 GRANT SELECT ON fc_users TO fc_auth_app;
 GRANT SELECT,INSERT,DELETE ON fc_sessions TO fc_auth_app;
 GRANT SELECT,INSERT,UPDATE,DELETE ON fc_login_attempts TO fc_auth_app;
 GRANT SELECT,INSERT,UPDATE ON fc_bookings TO fc_ops_app;
 GRANT SELECT,INSERT ON fc_events TO fc_ops_app;
 GRANT SELECT,INSERT ON fc_vehicles TO fc_ops_app;
 GRANT SELECT ON fc_drivers TO fc_ops_app;
 GRANT SELECT,INSERT,UPDATE ON fc_public_links TO fc_ops_app;
 GRANT SELECT,UPDATE ON fc_public_requests TO fc_ops_app;
 GRANT SELECT,INSERT ON fc_intake_events TO fc_ops_app;
 GRANT SELECT ON fc_public_links TO fc_guest_app;
 GRANT INSERT,SELECT(id,status) ON fc_public_requests TO fc_guest_app;
 GRANT SELECT ON fc_users TO fc_recovery_app;
 GRANT UPDATE(password_salt,password_hash,email_verified) ON fc_users TO fc_recovery_app;
 GRANT SELECT,INSERT,UPDATE,DELETE ON fc_account_tokens TO fc_recovery_app;
 GRANT SELECT(user_id),DELETE ON fc_sessions TO fc_recovery_app;`);
 console.log('Isolated FleetCommand database schema and restricted roles prepared');
}finally{await admin.end()}
