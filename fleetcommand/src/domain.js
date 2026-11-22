// Pure FleetCommand booking rules. No production calls, emails, payments or storage.
export const statuses=Object.freeze(['REQUESTED','CONFIRMED','ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED']);
const transitions=Object.freeze({
 REQUESTED:['CONFIRMED','CANCELLED'],CONFIRMED:['ASSIGNED','CANCELLED'],
 ASSIGNED:['IN_PROGRESS','CANCELLED'],IN_PROGRESS:['COMPLETED'],COMPLETED:[],CANCELLED:[]
});
export function requireOperator(record,operatorId){
 if(!record||typeof operatorId!=='string'||!operatorId.trim()||record.operatorId!==operatorId)
   throw new Error('Operator access denied');
 return record;
}
export function validateBooking(input){
 const x=input||{};
 if(!x.operatorId||!x.customerName||!x.pickup||!x.dropoff)
   throw new Error('Operator, customer, pickup and dropoff are required');
 const start=Date.parse(x.startsAt),end=Date.parse(x.endsAt);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)
   throw new Error('A valid start and end are required');
 const passengers=Number(x.passengers);
 if(!Number.isInteger(passengers)||passengers<1||passengers>50)
   throw new Error('Invalid passenger count');
 return {operatorId:String(x.operatorId),customerName:String(x.customerName).trim(),
   pickup:String(x.pickup).trim(),dropoff:String(x.dropoff).trim(),
   startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString(),
   passengers,status:'REQUESTED',driverId:null,vehicleId:null};
}
export function hasConflict(candidate,bookings,resource,resourceId){
 if(!['driverId','vehicleId'].includes(resource))throw new Error('Unknown resource');
 if(!resourceId)return false;
 const start=Date.parse(candidate.startsAt),end=Date.parse(candidate.endsAt);
 return bookings.some(existing=>existing.id!==candidate.id &&
   existing.operatorId===candidate.operatorId &&
   existing[resource]===resourceId &&
   !['CANCELLED','COMPLETED'].includes(existing.status) &&
   start<Date.parse(existing.endsAt)&&end>Date.parse(existing.startsAt));
}
export function transitionBooking({booking,operatorId,nextStatus,actorId,reason,driverId,vehicleId,bookings=[],occurredAt}){
 requireOperator(booking,operatorId);
 if(!actorId||!String(actorId).trim())throw new Error('Verified actor required');
 if(!(transitions[booking.status]||[]).includes(nextStatus))throw new Error('Invalid status transition');
 if(!reason||String(reason).trim().length<5)throw new Error('Change reason required');
 const updated={...booking,status:nextStatus};
 if(nextStatus==='ASSIGNED'){
   if(!driverId||!vehicleId)throw new Error('Driver and vehicle required');
   if(hasConflict(updated,bookings,'driverId',driverId)||hasConflict(updated,bookings,'vehicleId',vehicleId))
     throw new Error('Assignment conflicts with another trip');
   updated.driverId=driverId;updated.vehicleId=vehicleId;
 }
 const at=occurredAt||new Date().toISOString();
 if(!Number.isFinite(Date.parse(at)))throw new Error('Invalid audit timestamp');
 const audit={operatorId,bookingId:booking.id,actorId,action:'STATUS_CHANGED',
   previousStatus:booking.status,newStatus:nextStatus,reason:String(reason).trim(),occurredAt:at,
   previousDriverId:booking.driverId||null,newDriverId:updated.driverId||null,
   previousVehicleId:booking.vehicleId||null,newVehicleId:updated.vehicleId||null};
 return {booking:updated,audit};
}
