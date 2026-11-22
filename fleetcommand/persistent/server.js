/** Localhost-only gateway to the isolated PostgreSQL adapter.
 * This server does not seed credentials, mutate SET data, or accept public traffic.
 * No production exposure without real database integration/security testing.
 */
import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {FleetRepository} from './repository.js';
import {AccountRecovery} from './recovery.js';
import {createMailDelivery} from './mail.js';
import {toCsv} from './export.js';
import {GuestBookingIntake} from './guest.js';

const uiPath=fileURLToPath(new URL('../public/persistent.html',import.meta.url));
const accountPage=fileURLToPath(new URL('../public/account.html',import.meta.url));
const customerPage=fileURLToPath(new URL('../public/customer.html',import.meta.url));
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
async function parseBody(req){
 const chunks=[];let bytes=0;
 for await(const chunk of req){bytes+=chunk.length;if(bytes>16384)throw Error('Request too large');chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw Error('Invalid JSON');}
}
function failure(err){
 if(/Too many sign-in attempts/.test(err.message))return 429;
 if(/CSRF|Origin|cross-site/.test(err.message))return 403;
 if(/Authentication required|Invalid credentials/.test(err.message))return 401;
 if(/Insufficient role/.test(err.message))return 403;
 if(/Booking not found/.test(err.message))return 404;
 if(/Invalid|required|conflict|transition|unknown|overlap|too large|not found/i.test(err.message))return 400;
 return 500;
}
export function createPersistentServer(repo,{recovery=null,deliver=null,guest=null}={}){
 if(!repo||typeof repo.actor!=='function')throw Error('Repository is required');
 const publicOrigin=process.env.FLEETCOMMAND_PUBLIC_ORIGIN||null;
 const expectedOrigin=req=>publicOrigin||'http://'+req.headers.host;
 const csrfSessions=new Map();
 const recoveryAttempts=new Map();
 const guestAttempts=new Map();
 const cookieName='fc_session';
 const cookieToken=req=>String(req.headers.cookie||'').split(';').map(x=>x.trim())
   .find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 const eq=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y);};
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
   if(req.method==='GET'&&/^\/book\/[0-9a-f]{64}$/.test(path)){
    const html=await readFile(customerPage);
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
     'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
     'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
    return res.end(html);
   }
   if(req.method==='POST'&&path==='/api/public/requests'){
    if(req.headers.origin!==expectedOrigin(req))throw Error('Origin verification failed');
    if(!guest)return send(res,503,{error:'Public booking is not configured'});
    const b=await parseBody(req);
    const ip=req.socket.remoteAddress||'unknown',key=ip+':'+String(b.token||'').slice(0,16);
    const now=Date.now(),previous=guestAttempts.get(key);
    if(guestAttempts.size>10000)guestAttempts.clear();
    if(previous&&now-previous<30000)return send(res,429,{error:'Request limit reached'});
    guestAttempts.set(key,now);
    const result=await guest.submit(b);
    return send(res,202,result);
   }
   if(req.method==='GET'&&path==='/account'){
    const html=await readFile(accountPage);
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
     'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
     'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
    return res.end(html);
   }
   if(req.method==='POST'&&path==='/api/recovery/request'){
    if(req.headers.origin!==expectedOrigin(req))throw Error('Origin verification failed');
    if(!recovery||!deliver)return send(res,503,{error:'Recovery email is not configured'});
    const input=await parseBody(req),email=String(input.email||'').trim().toLowerCase();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||email.length>200)
     return send(res,400,{error:'Invalid email'});
    // Local defense only; deploy a shared network-aware limiter before exposing publicly.
    const key=email,now=Date.now(),previous=recoveryAttempts.get(key);
    if(recoveryAttempts.size>1000)recoveryAttempts.clear();
    if(previous&&now-previous<60000)return send(res,200,{accepted:true});
    recoveryAttempts.set(key,now);
    const issue=await recovery.issue(email,'RESET');
    if(issue.delivery)await deliver(issue.delivery);
    return send(res,200,{accepted:true});
   }
   if(req.method==='POST'&&path==='/api/recovery/consume'){
    if(req.headers.origin!==expectedOrigin(req))throw Error('Origin verification failed');
    if(!recovery)return send(res,503,{error:'Recovery is not configured'});
    const b=await parseBody(req);
    await recovery.consume(b.token,b.purpose,b.password);
    return send(res,200,{completed:true});
   }
   if(req.method==='GET'&&path==='/api/health')return send(res,200,{mode:'ISOLATED_PERSISTENT_DEVELOPMENT',productionReady:false});
   if(req.method==='POST'&&path==='/api/login'){
    if(req.headers.origin!==expectedOrigin(req))throw Error('Origin verification failed');
    const b=await parseBody(req);
    const session=await repo.login(b.email,b.password);
    const csrf=randomBytes(32).toString('hex');
    csrfSessions.set(session.token,csrf);
    // Secure is deliberately omitted only for localhost HTTP development; public TLS is mandatory.
    res.setHeader('Set-Cookie',cookieName+'='+session.token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800'+(publicOrigin?'; Secure':''));
    return send(res,200,{csrf,operator:session.operatorId,role:session.role});
   }
   // Ignore Authorization bearer headers: persistent browser sessions use HttpOnly cookies.
   const raw=cookieToken(req);
   const actor=await repo.actor(raw);
   if(req.method!=='GET'&&req.method!=='HEAD'){
    const origin=req.headers.origin;
    const expected=expectedOrigin(req);
    if(!origin||origin!==expected||!eq(req.headers['x-fleetcommand-csrf'],csrfSessions.get(raw)))
     throw Error('CSRF or Origin verification failed');
   }
   if(req.method==='POST'&&path==='/api/logout'){
    await repo.logout(raw);csrfSessions.delete(raw);
    res.setHeader('Set-Cookie',cookieName+'=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'+(publicOrigin?'; Secure':''));
    return send(res,200,{ok:true});
   }
   if(req.method==='POST'&&path==='/api/public-link/rotate'){
    const link=await repo.rotateCustomerBookingLink(actor);
    return send(res,200,{url:expectedOrigin(req)+'/book/'+link.token,warning:link.warning});
   }
   if(req.method==='GET'&&path==='/api/customer-requests'){
    const rows=await repo.listCustomerRequests(actor);
    return send(res,200,{requests:rows});
   }
   const intakeDecision=path.match(/^\/api\/customer-requests\/([0-9a-f-]{36})\/decision$/i);
   if(req.method==='POST'&&intakeDecision){
    const result=await repo.decideCustomerRequest(actor,intakeDecision[1],await parseBody(req));
    return send(res,200,result);
   }
   if(req.method==='GET'&&path==='/api/resources'){
    const resources=await repo.listResources(actor);
    return send(res,200,resources);
   }
   if(req.method==='POST'&&path==='/api/vehicles'){
    const vehicle=await repo.addVehicle(actor,await parseBody(req));
    return send(res,201,{vehicle});
   }
   if(req.method==='GET'&&path==='/api/reports/bookings.csv'){
    if(!['OWNER','DISPATCHER'].includes(actor.role))throw Error('Insufficient role');
    const csv=toCsv(await repo.listBookings(actor));
    res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Cache-Control':'no-store',
     'Content-Disposition':'attachment; filename="fleetcommand-bookings.csv"',
     'X-Content-Type-Options':'nosniff'});
    return res.end(csv);
   }
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
 let recoveryPool=null,recovery=null,deliver=null;
 const enabled=process.env.FLEETCOMMAND_RECOVERY_EMAIL_ENABLED==='yes';
 if(enabled){
  const url=process.env.FLEETCOMMAND_RECOVERY_DATABASE_URL;
  if(!url||url===authString||url===opsString)throw Error('Separate recovery role is required');
  recoveryPool=new Pool({connectionString:url,max:3});
  recovery=new AccountRecovery(recoveryPool);
  deliver=createMailDelivery({
   enabled:true,
   apiKey:process.env.FLEETCOMMAND_RESEND_API_KEY,
   fromAddress:process.env.FLEETCOMMAND_MAIL_FROM,
   baseUrl:process.env.FLEETCOMMAND_MAIL_BASE_URL,
   allowedRecipients:(process.env.FLEETCOMMAND_MAIL_TEST_RECIPIENTS||'').split(',').filter(Boolean)
  });
 }
 let guestPool=null,guest=null;
 const guestUrl=process.env.FLEETCOMMAND_GUEST_DATABASE_URL;
 if(guestUrl){
  if(guestUrl===authString||guestUrl===opsString||guestUrl===process.env.FLEETCOMMAND_RECOVERY_DATABASE_URL)
   throw Error('Public booking requires a separate restricted database role');
  guestPool=new Pool({connectionString:guestUrl,max:5});guest=new GuestBookingIntake(guestPool);
 }
 const server=createPersistentServer(repo,{recovery,deliver,guest});
 const port=Number(process.env.FLEETCOMMAND_DEV_PORT||8788);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid development port');
 try{
  await Promise.all([authPool.query('SELECT 1'),operationsPool.query('SELECT 1'),...(recoveryPool?[recoveryPool.query('SELECT 1')]:[]),...(guestPool?[guestPool.query('SELECT 1')]:[])]);
  const host=process.env.FLEETCOMMAND_PILOT_BIND==='0.0.0.0'?'0.0.0.0':'127.0.0.1';
  if(host==='0.0.0.0'&&
    (process.env.FLEETCOMMAND_PILOT_PROXY_ACK!=='ISOLATED_REVERSE_PROXY'||
     !/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(process.env.FLEETCOMMAND_PUBLIC_ORIGIN||'')))
    throw Error('Refusing public bind without isolated HTTPS reverse-proxy configuration');
  if(process.env.FLEETCOMMAND_PUBLIC_ORIGIN&&!/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(process.env.FLEETCOMMAND_PUBLIC_ORIGIN))
   throw Error('Configured public origin must be HTTPS');
  await new Promise(resolve=>server.listen(port,host,resolve));
  console.log('FleetCommand isolated PostgreSQL development gateway on localhost port '+port);
 }catch(e){await Promise.allSettled([authPool.end(),operationsPool.end(),...(recoveryPool?[recoveryPool.end()]:[]),...(guestPool?[guestPool.end()]:[])]);throw e;}
 const shutdown=async()=>{server.close();await Promise.allSettled([authPool.end(),operationsPool.end(),...(recoveryPool?[recoveryPool.end()]:[]),...(guestPool?[guestPool.end()]:[])]);};
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);return server;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])startPersistentServer().catch(e=>{console.error(e.message);process.exitCode=1;});
