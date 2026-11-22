/** FleetCommand recovery-email transport.
 * Sender credentials and recipient policy come ONLY from runtime environment.
 * No email is sent unless an explicitly enabled delivery adapter is invoked.
 */
const emailPattern=/^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export function recoveryLink(baseUrl,purpose,token){
 if(!['ACTIVATE','RESET'].includes(purpose)||!/^[0-9a-f]{64}$/.test(String(token)))throw Error('Invalid recovery link');
 const u=new URL(baseUrl);
 if(u.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(u.hostname))
  throw Error('Recovery link requires HTTPS');
 // Secret in URL fragment: browser does not transmit it with GET.
 const path=purpose==='ACTIVATE'?'activate':'reset';
 return u.origin+'/account#'+path+'='+token;
}
export function createMailDelivery({apiKey,fromAddress,baseUrl,enabled=false,allowedRecipients=[],transport=fetch}={}){
 if(!enabled)throw Error('Recovery mail delivery is disabled');
 if(!apiKey||!fromAddress||!baseUrl||!emailPattern.test(fromAddress))throw Error('Verified sender and delivery configuration required');
 const allow=new Set(allowedRecipients.map(x=>String(x).toLowerCase().trim()));
 if(!allow.size)throw Error('An explicit test recipient allowlist is required');
 return async({address,token,purpose})=>{
  const email=String(address||'').toLowerCase().trim();
  if(!allow.has(email))throw Error('Recipient is not on test allowlist');
  const url=recoveryLink(baseUrl,purpose,token);
  const subject=purpose==='ACTIVATE'?'Activate your FleetCommand test account':'Reset your FleetCommand test password';
  const response=await transport('https://api.resend.com/emails',{
   method:'POST',
   headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
   body:JSON.stringify({from:fromAddress,to:[email],subject,
    text:'Use this one-time link to '+(purpose==='ACTIVATE'?'activate your account: ':'reset your password: ')+url+
     '\nIf you did not request this, ignore the message. The link expires automatically.'})
  });
  if(!response.ok)throw Error('Recovery email delivery failed');
  return {accepted:true};
 };
}
