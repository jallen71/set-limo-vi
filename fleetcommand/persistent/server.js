/** Localhost-only gateway to the isolated PostgreSQL adapter.
 * This server does not seed credentials, mutate SET data, or accept public traffic.
 * No production exposure without real database integration/security testing.
 */
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {FleetRepository} from './repository.js';

const uiPath=fileURLToPath(new URL('../public/index.html',import.meta.url));
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
async function parseBody(req){
 const chunks=[];let bytes=0;
 for await(const chunk of req){bytes+=chunk.length;if(bytes>16384)throw Error('Request too large');chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw Error('Invalid JSON');}
}
function failure(err){
 if(/Authentication required|Invalid credentials/.test(err.message))return 401;
 if(/Insufficient role/.test(err.message))return 403;
 if(/Booking not found/.test(err.message))return 404;
 if(/Invalid|required|conflict|transition|unknown|overlap|too large|not found/i.test(err.message))return 400;
 return 500;
}
export function createPersistentServer(repo){
 if(!repo||typeof repo.actor!=='function')throw Error('Repository is required');
 return http.createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  try{
   if(req.method==='GET'&&path==='/'){
    const html=await readFile(uiPath);
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
     'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
     'X-Content-Type-Options':'nosniff'});
    return res.end(html);
   }
   if(req.method==='GET'&&path==='/api/health')return send(res,200,{mode:'ISOLATED_PERSISTENT_DEVELOPMENT',productionReady:false});
   if(req.method==='POST'&&path==='/api/login'){
    const b=await parseBody(req);
    const session=await repo.login(b.email,b.password);
    return send(res,200,{token:session.token,operator:session.operatorId,role:session.role});
   }
   const raw=(req.headers.authorization||'').match(/^Bearer ([0-9a-f]{64})$/)?.[1];
   const actor=await repo.actor(raw);
   if(req.method==='POST'&&path==='/api/logout'){await repo.logout(raw);return send(res,200,{ok:true});}
   if(req.method==='GET'&&path==='/api/bookings'){
    const bookings=await repo.listBookings(actor);
    return send(res,200,{operator:actor.operator_id,bookings:bookings.map(row=>({
     id:row.id,operatorId:row.operator_id,customerName:row.customer_name,pickup:row.pickup,
     dropoff:row.dropoff,startsAt:row.starts_at,endsAt:row.ends_at,passengers:row.passengers,
     status:row.status,driverId:row.driver_id,vehicleId:row.vehicle_id
    }))});
   }
   if(req.method==='GET'&&path==='/api/events'){
    const events=await repo.listEvents(actor);
    return send(res,200,{events:events.map(row=>({
     operatorId:row.operator_id,bookingId:row.booking_id,actorId:row.actor_id,
     action:row.previous_status?'STATUS_CHANGED':'BOOKING_CREATED',occurredAt:row.occurred_at,
     previousStatus:row.previous_status,newStatus:row.new_status,reason:row.reason
    }))});
   }
   if(req.method==='POST'&&path==='/api/bookings'){
    const item=await repo.createBooking(actor,await parseBody(req));
    return send(res,201,{booking:{id:item.id,operatorId:item.operator_id,status:item.status}});
   }
   const match=path.match(/^\/api\/bookings\/([0-9a-f-]{36})\/transition$/i);
   if(req.method==='POST'&&match){
    const item=await repo.transition(actor,match[1],await parseBody(req));
    return send(res,200,{booking:{id:item.id,operatorId:item.operator_id,status:item.status}});
   }
   return send(res,404,{error:'Route not found'});
  }catch(err){
   const code=failure(err);
   // Internal failures must not leak SQL or server configuration into responses.
   return send(res,code,{error:code===500?'Internal development server error':err.message});
  }
 });
}
export async function startPersistentServer(){
 if(process.env.FLEETCOMMAND_DEV_ACK!=='ISOLATED_TEST_DATABASE')
  throw Error('Refusing to start: set FLEETCOMMAND_DEV_ACK=ISOLATED_TEST_DATABASE');
 const {Pool}=await import('pg');
 const authString=process.env.FLEETCOMMAND_AUTH_DATABASE_URL;
 const opsString=process.env.FLEETCOMMAND_OPERATIONS_DATABASE_URL;
 if(!authString||!opsString||authString===opsString)throw Error('Distinct auth and operations database credentials required');
 const authPool=new Pool({connectionString:authString,max:5});
 const operationsPool=new Pool({connectionString:opsString,max:5});
 const repo=new FleetRepository({authPool,operationsPool});
 const server=createPersistentServer(repo);
 const port=Number(process.env.FLEETCOMMAND_DEV_PORT||8788);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid development port');
 try{
  await Promise.all([authPool.query('SELECT 1'),operationsPool.query('SELECT 1')]);
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  console.log('FleetCommand isolated PostgreSQL development gateway on localhost port '+port);
 }catch(e){await Promise.allSettled([authPool.end(),operationsPool.end()]);throw e;}
 const shutdown=async()=>{server.close();await Promise.allSettled([authPool.end(),operationsPool.end()]);};
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);return server;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])startPersistentServer().catch(e=>{console.error(e.message);process.exitCode=1;});
