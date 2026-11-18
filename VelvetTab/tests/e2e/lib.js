const {chromium}=require(process.env.PW_CORE || 'playwright-core');const {spawn,execFileSync}=require('child_process');const fs=require('fs'),path=require('path');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function launch(prof,port){
  const p=spawn(CHROME,[`--user-data-dir=${prof}`,`--remote-debugging-port=${port}`,'--remote-debugging-pipe','--enable-unsafe-extension-debugging',
   '--no-first-run','--no-default-browser-check','--window-position=40,40','--window-size=1100,760','about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
  let buf='',id=0;const waits={};
  p.stdio[4].on('data',d=>{buf+=d.toString();let i;while((i=buf.indexOf('\0'))>=0){const m=JSON.parse(buf.slice(0,i));buf=buf.slice(i+1);if(m.id&&waits[m.id]){waits[m.id](m);delete waits[m.id]}}});
  const send=(method,params={})=>new Promise(r=>{const i=++id;waits[i]=r;p.stdio[3].write(JSON.stringify({id:i,method,params})+'\0')});
  await sleep(3000);
  const browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  return {proc:p,send,browser,ctx:browser.contexts()[0]};
}
function ps(args){try{return execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'win.ps1'),...args]).toString().trim()}catch(e){return 'ERR '+(e.stdout||'')+e.message.split('\n')[0]}}
const shot=(pid,out)=>ps(['-Action','shot','-ProcId',String(pid),'-Out',out]);
const keys=(pid,k)=>ps(['-Action','keys','-ProcId',String(pid),'-Keys',k]);
module.exports={launch,shot,keys,sleep};
