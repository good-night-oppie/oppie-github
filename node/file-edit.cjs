'use strict';
const crypto=require('node:crypto');
const MAX_FILE_BYTES=525000;
function validateEdits(edits,bad){
 if(!Array.isArray(edits)||!edits.length||edits.length>100)bad('INVALID_EDITS');
 for(const e of edits){
  if(!e||typeof e!=='object'||Array.isArray(e)||Object.keys(e).some(k=>!['old_text','new_text'].includes(k)))bad('INVALID_EDITS');
  if(typeof e.old_text!=='string'||!e.old_text.length||typeof e.new_text!=='string')bad('INVALID_EDITS');
  for(const value of [e.old_text,e.new_text])if(value.includes('\0')||Buffer.from(value,'utf8').toString('utf8')!==value)bad('INVALID_EDITS');
 }
}
function applyEdits(current,args,bad){
 if(current?.sha!==args.expected_sha)bad('STALE_FILE');
 if(current.type!=='file'||current.encoding!=='base64'||!Number.isSafeInteger(current.size)||current.size<0)bad('INVALID_FILE_BASELINE');
 if(current.size>MAX_FILE_BYTES)bad('FILE_TOO_LARGE');
 if(typeof current.content!=='string'||!/^[A-Za-z0-9+/=\r\n]*$/.test(current.content))bad('INVALID_FILE_BASELINE');
 const encoded=current.content.replace(/[\r\n]/g,'');
 if(encoded.length>700000)bad('FILE_TOO_LARGE');
 const bytes=Buffer.from(encoded,'base64');
 if(bytes.toString('base64')!==encoded||bytes.length!==current.size)bad('INVALID_FILE_BASELINE');
 const gitSha=crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
 if(gitSha!==args.expected_sha)bad('CONTENT_BASELINE_MISMATCH');
 let text=bytes.toString('utf8');
 if(!Buffer.from(text,'utf8').equals(bytes)||text.includes('\0'))bad('INVALID_FILE_ENCODING');
 for(const edit of args.edits){
  const at=text.indexOf(edit.old_text);
  if(at<0||text.indexOf(edit.old_text,at+1)>=0)bad('PATCH_CONFLICT');
  text=text.slice(0,at)+edit.new_text+text.slice(at+edit.old_text.length);
  if(Buffer.byteLength(text,'utf8')>MAX_FILE_BYTES)bad('FILE_TOO_LARGE');
 }
 const result=Buffer.from(text,'utf8');
 if(crypto.createHash('sha256').update(result).digest('hex')!==args.expected_result_sha256)bad('CONTENT_SHA256_MISMATCH');
 return result.toString('base64');
}
module.exports={MAX_FILE_BYTES,validateEdits,applyEdits};
