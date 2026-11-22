/** Safe CSV exports for operators. These are business records, not billing receipts. */
export function toCsv(bookings){
 const cols=['id','customer_name','pickup','dropoff','starts_at','ends_at','passengers','status','driver_id','vehicle_id'];
 const escape=v=>{
  let s=String(v??'');
  if(/^[=+@\-\t\r]/.test(s))s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
 };
 return [cols.join(','),...bookings.map(row=>cols.map(key=>escape(row[key])).join(','))].join('\r\n')+'\r\n';
}
