import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const read=p=>readFileSync(p,'utf8');
test('all deployment jobs depend on the migration job; no swallowed SQL failures',()=>{
 const source=read('.github/workflows/deploy.yml');
 for(const job of ['deploy-api','deploy-web','deploy-admin','deploy-portal']){
  const block=source.split(`  ${job}:\n`)[1].split(/\n  [a-z][a-z-]+:/)[0];assert.match(block,/needs: migrate-db/);assert.doesNotMatch(block,/always\(\)|continue-on-error/);
 }
 assert.match(source,/bash scripts\/migrations\/hotel-release.sh/);assert.doesNotMatch(source,/Warning:|for f in|continue-on-error/);
});
test('manual verification workflows cannot deploy and reference no production secrets',()=>{
 for(const name of ['postgres','browser']){
  const source=read(`.github/workflows/hotel-${name}-verification.yml`);
  assert.match(source,/workflow_dispatch:/);assert.doesNotMatch(source,/\n  (push|pull_request|schedule):/);
  assert.match(source,/contents: read/);assert.match(source,/refs\/heads\/review\/hotel-api-readiness/);
  assert.doesNotMatch(source,/wrangler|CLOUDFLARE|secrets\.DATABASE_URL|secrets\.TRIPJACK|NOMOD|persist-credentials: true/);
 }
});
test('release runner propagates psql failure rather than reporting success (stub, not PostgreSQL proof)',()=>{
 const dir=mkdtempSync(join(tmpdir(),'hotel-release-'));try{
  writeFileSync(join(dir,'psql'),'#!/bin/sh\ncat >/dev/null\nexit 23\n',{mode:0o755});
  const r=spawnSync('bash',['scripts/migrations/hotel-release.sh'],{env:{...process.env,DATABASE_URL:'postgresql://fixture.invalid/never-connected',PATH:`${dir}:${process.env.PATH}`},encoding:'utf8'});
  assert.equal(r.status,23);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('generated SQL locks, validates baseline/checksums and never replays legacy migration bodies',()=>{
 const r=spawnSync('python3',['scripts/migrations/hotel-release-sql.py'],{encoding:'utf8'});assert.equal(r.status,0);
 assert.match(r.stdout,/pg_advisory_xact_lock/);assert.match(r.stdout,/Approved migration ledger\/baseline required/);assert.match(r.stdout,/Untracked hotel schema/);
 assert.match(r.stdout,/\\if :hotel_pending/);assert.equal((r.stdout.match(/CREATE TABLE hotel_quotes/g)||[]).length,1);
 assert.doesNotMatch(r.stdout,/CREATE TABLE(?: IF NOT EXISTS)? tenants|INSERT INTO tenants|DELETE FROM|DROP TABLE/);
});
