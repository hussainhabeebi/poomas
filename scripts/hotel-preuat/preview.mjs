// Starts the real Next frontend plus a synthetic local API. Never starts the API Worker.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
for (const dir of [root,`${root}apps/web/`]) for (const name of ['.env','.env.local','.env.development','.env.development.local']) {
 if (existsSync(`${dir}${name}`)) throw new Error(`Remove local environment file from the isolated preview checkout first: ${name}`);
}
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,
 NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_API_URL:'http://127.0.0.1:4001',
 NODE_OPTIONS:`--require=${root}scripts/hotel-preuat/loopback-only.cjs`};
const children=[];
function stop(){for(const child of children)child.kill('SIGTERM');}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
for(const [cmd,args,cwd] of [[process.execPath,['scripts/hotel-preuat/fixture-api.mjs'],root],['pnpm',['--filter','@poomas/web','exec','next','dev','--hostname','127.0.0.1','-p','3000'],root]]) {
 const child=spawn(cmd,args,{cwd,env,stdio:'inherit'});children.push(child);
 child.on('error',error=>{console.error(error.message);stop();process.exitCode=1;});
 child.on('exit',code=>{if(code){process.exitCode=code;stop();}});
}
console.log('LOCAL FIXTURES ONLY: open http://127.0.0.1:4001/fixture/login then /hotels on port 3000. No real authentication or supplier verification.');
