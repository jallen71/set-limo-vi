import {scrypt as scryptCb,randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCb);
export const hashToken=token=>createHash('sha256').update(String(token)).digest('hex');
export async function passwordRecord(password){
 if(typeof password!=='string'||password.length<12||password.length>256)throw Error('Password length must be 12–256');
 const salt=randomBytes(24).toString('hex');
 const hash=(await scrypt(password,salt,64)).toString('hex');
 return {salt,hash};
}
export async function verifyPassword(password,salt,hash){
 if(typeof password!=='string'||typeof salt!=='string'||typeof hash!=='string'||!/^[0-9a-f]{128}$/.test(hash))return false;
 const proposed=await scrypt(password,salt,64);
 const expected=Buffer.from(hash,'hex');
 return proposed.length===expected.length&&timingSafeEqual(proposed,expected);
}
