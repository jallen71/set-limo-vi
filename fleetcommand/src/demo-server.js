/** Localhost-only fictional FleetCommand prototype. No real customers, billing or production persistence. */
import http from 'node:http';
import {randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {validateBooking,transitionBooking} from './domain.js';

const users=Object.freeze([
 {email:'operator-a@example.invalid',password:'DemoOnly-A-2026!',operatorId:'demo-operator-a',actorId:'demo-owner-a',name:'Harbor Transfers'},
 {email:'operator-b@example.invalid',password:'DemoOnly-B-2026!',operatorId:'demo-operator-b',actorId:'demo-owner-b',name:'Island Rides'}
]);
function equal(a,b){const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));return aa.length===bb.length&&timingSafeEqual(aa,bb);}
function send(res,code,obj){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj));}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>16000){reject(Error('Payload too large'));req.destroy();}});req.on('end',()=>{try{resolve(JSON.parse(s||'{}'));}catch{reject(Error('Invalid JSON'));}});req.on('error',reject);});}
export function createDemoState(){return {bookings:[],events:[],sessions:new Map()};}
const uiPath=fileURLToPath(new URL('../public/index.html',import.meta.url));
export function createDemoServer(state=createDemoState()){
 return http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  try{
   if(req.method==='GET'&&pathname==='/'){
    const html=await readFile(uiPath);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});return res.end(html);
   }
   if(req.method==='POST'&&pathname==='/api/login'){
    const payload=await body(req);
    const user=users.find(u=>u.email===payload.email&&equal(u.password,payload.password));
    if(!user)return send(res,401,{error:'Invalid demo credentials'});
    const token=randomBytes(32).toString('hex');state.sessions.set(token,{...user,expires:Date.now()+2*3600*1000});
    return send(res,200,{token,operator:user.name});
   }
   if(pathname==='/api/health')return send(res,200,{mode:'LOCAL_DEMO_ONLY',productionReady:false});
   const token=(req.headers.authorization||'').match(/^Bearer ([0-9a-f]{64})$/)?.[1];
   const actor=token&&state.sessions.get(token);
   if(!actor||actor.expires<=Date.now())return send(res,401,{error:'Demo sign-in required'});
   if(req.method==='POST'&&pathname==='/api/logout'){state.sessions.delete(token);return send(res,200,{ok:true});}
   if(req.method==='GET'&&pathname==='/api/bookings'){
    const bookings=state.bookings.filter(x=>x.operatorId===actor.operatorId).map(x=>({...x}));
    return send(res,200,{bookings,operator:actor.name});
   }
   if(req.method==='GET'&&pathname==='/api/events')return send(res,200,{events:state.events.filter(x=>x.operatorId===actor.operatorId)});
   if(req.method==='POST'&&pathname==='/api/bookings'){
    const payload=await body(req);
    const b={...validateBooking({...payload,operatorId:actor.operatorId}),id:randomUUID()};
    state.bookings.push(b);
    const event={operatorId:actor.operatorId,bookingId:b.id,actorId:actor.actorId,action:'BOOKING_CREATED',reason:'New demo booking',occurredAt:new Date().toISOString()};
    state.events.push(event);return send(res,201,{booking:b,event});
   }
   const match=pathname.match(/^\/api\/bookings\/([0-9a-f-]{36})\/transition$/);
   if(req.method==='POST'&&match){
    const b=state.bookings.find(x=>x.id===match[1]);
    if(!b||b.operatorId!==actor.operatorId)return send(res,404,{error:'Booking not found'});
    const payload=await body(req);
    const result=transitionBooking({booking:b,operatorId:actor.operatorId,nextStatus:payload.status,
     actorId:actor.actorId,reason:payload.reason,driverId:payload.driverId,vehicleId:payload.vehicleId,
     bookings:state.bookings});
    const i=state.bookings.indexOf(b);state.bookings[i]=result.booking;state.events.push(result.audit);
    return send(res,200,result);
   }
   return send(res,404,{error:'Route not found'});
  }catch(err){return send(res,400,{error:String(err.message||err)});}
 });
}
export async function startDemoServer(){
 const host='127.0.0.1',port=Number(process.env.FLEETCOMMAND_DEMO_PORT||8787);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');
 const server=createDemoServer();await new Promise(resolve=>server.listen(port,host,resolve));
 console.log('FleetCommand FICTIONAL DEMO at http://'+host+':'+port+' — NOT FOR PRODUCTION');return server;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])startDemoServer();
