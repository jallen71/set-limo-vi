import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBooking,requireOperator,hasConflict,transitionBooking} from '../src/domain.js';
const base={id:'b1',operatorId:'company-a',customerName:'Test Customer',pickup:'Airport',dropoff:'Hotel',
 startsAt:'2026-12-12T10:00:00Z',endsAt:'2026-12-12T11:00:00Z',
 passengers:2,status:'CONFIRMED',driverId:null,vehicleId:null};
test('valid booking starts as request with no assignment',()=>{
 const b=validateBooking(base);assert.equal(b.status,'REQUESTED');assert.equal(b.driverId,null);
});
test('invalid period and passenger counts rejected',()=>{
 assert.throws(()=>validateBooking({...base,endsAt:base.startsAt}));
 assert.throws(()=>validateBooking({...base,passengers:0}));
});
test('one operator cannot access another operator booking',()=>{
 assert.throws(()=>requireOperator(base,'company-b'),/denied/);
});
test('overlapping assignment is rejected for same operator',()=>{
 const assigned={...base,id:'b2',status:'ASSIGNED',driverId:'driver1',vehicleId:'van1'};
 assert.equal(hasConflict(base,[assigned],'driverId','driver1'),true);
 assert.equal(hasConflict(base,[assigned],'vehicleId','van1'),true);
 assert.equal(hasConflict({...base,operatorId:'company-b'},[assigned],'driverId','driver1'),false);
 const args={booking:base,operatorId:'company-a',nextStatus:'ASSIGNED',actorId:'staff1',reason:'Verified booking',driverId:'driver1',vehicleId:'van1',bookings:[assigned]};
 assert.throws(()=>transitionBooking(args),/conflicts/);
});
test('adjacent trip does not conflict',()=>{
 const other={...base,id:'b2',status:'ASSIGNED',driverId:'driver1',vehicleId:'van1',startsAt:base.endsAt,endsAt:'2026-12-12T12:00:00Z'};
 assert.equal(hasConflict(base,[other],'driverId','driver1'),false);
});
test('valid status change returns original unchanged and auditable event',()=>{
 const copy=structuredClone(base);
 const result=transitionBooking({booking:base,operatorId:'company-a',nextStatus:'ASSIGNED',
  actorId:'staff1',reason:'Dispatcher assigned',driverId:'driver1',vehicleId:'van1',bookings:[],occurredAt:'2026-11-22T16:00:00Z'});
 assert.equal(result.booking.status,'ASSIGNED');assert.equal(result.audit.previousStatus,'CONFIRMED');
 assert.equal(result.audit.actorId,'staff1');assert.deepEqual(base,copy);
});
test('illegal status jumps and missing reasons rejected',()=>{
 assert.throws(()=>transitionBooking({booking:base,operatorId:'company-a',nextStatus:'COMPLETED',actorId:'staff1',reason:'Finished early'}));
 assert.throws(()=>transitionBooking({booking:base,operatorId:'company-a',nextStatus:'CANCELLED',actorId:'staff1',reason:'x'}));
});
