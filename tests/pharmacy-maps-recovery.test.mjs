import test from 'node:test';
import assert from 'node:assert/strict';
import { csvRecords, knownPlaceLeads, recordSearchAttempt } from '../scripts/pharmacy-maps-recovery.mjs';

test('CSV preserves quoted evidence commas, escaped quotes and multiline names',()=>{
  assert.deepEqual(csvRecords('key,name,url\r\n1,"A, B","https://example.com/a,b"\r\n2,"Two ""quoted""\nlines",x\r\n'),[
    {key:'1',name:'A, B',url:'https://example.com/a,b'},
    {key:'2',name:'Two "quoted"\nlines',url:'x'}
  ]);
});
test('CSV rejects incomplete fields and shifted column counts',()=>{
  assert.throws(()=>csvRecords('a,b\n"unfinished,x'),/Unterminated/);
  assert.throws(()=>csvRecords('a,b\nx,y,z'),/column count/);
  assert.deepEqual(csvRecords('a,b\n\n'),[]);
});
test('historic leads require an explicitly named checkpoint, not arbitrary file paths',()=>{
  for(const value of ['../before','checkpoint-4','checkpoint-004.json']) assert.throws(()=>knownPlaceLeads(value),/checkpoint/);
});
test('search log rejects invalid identity and unsupported methods before writing evidence',()=>{
  assert.throws(()=>recordSearchAttempt({key:'../../escape',method:'phone'}),/identity/);
  assert.throws(()=>recordSearchAttempt({key:'retail-2026-05-1',method:'guess'}),/identity/);
});
