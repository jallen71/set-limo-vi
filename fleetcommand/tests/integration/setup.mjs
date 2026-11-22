// Test database setup only. Requires explicit isolated CI database credentials.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
const url=process.env.FC_TEST_ADMIN_URL;
if(!url||!url.includes('fleetcommand_test'))throw Error('Refusing non-test database');
const admin=new pg.Client({connectionString:url});
await admin.connect();
try{
 await admin.query(await readFile(new URL('../../persistent/001_schema.sql',import.meta.url),'utf8'));
 await admin.query(`DO $$ BEGIN
   IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='fc_auth_test') THEN
     CREATE ROLE fc_auth_test LOGIN PASSWORD 'fictional-auth-test-only';
   END IF;
   IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='fc_ops_test') THEN
     CREATE ROLE fc_ops_test LOGIN PASSWORD 'fictional-ops-test-only';
   END IF;
 END $$;`);
 await admin.query(`GRANT CONNECT ON DATABASE fleetcommand_test TO fc_auth_test,fc_ops_test;
 GRANT USAGE ON SCHEMA public TO fc_auth_test,fc_ops_test;
 GRANT SELECT ON fc_users TO fc_auth_test;
 GRANT SELECT,INSERT,UPDATE ON fc_login_attempts TO fc_auth_test;
 GRANT SELECT,INSERT,DELETE ON fc_sessions TO fc_auth_test;
 GRANT SELECT,INSERT,UPDATE ON fc_bookings TO fc_ops_test;
 GRANT SELECT,INSERT ON fc_events TO fc_ops_test;
 GRANT SELECT ON fc_vehicles TO fc_ops_test;`);
 console.log('Isolated PostgreSQL schema and restricted test roles installed');
}finally{await admin.end()}
