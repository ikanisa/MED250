import test from 'node:test';
import assert from 'node:assert/strict';
import {rosterNumbers,matchRosterBranch,validateRosterBoundaryResolution} from '../scripts/pharmacy-fda-roster-research.mjs';
test('complete roster numbers never join adjacent rows or invent missing digits',()=>{
  assert.deepEqual(rosterNumbers('0783509161&0784484324'),['250783509161','250784484324']);
  assert.deepEqual(rosterNumbers('788893968/788309064'),['250788893968','250788309064']);
  assert.deepEqual(rosterNumbers('078805085'),[]);
  assert.deepEqual(rosterNumbers('0788 893 968'),['250788893968']);
  assert.deepEqual(rosterNumbers('0788/893968'),[]);
});
test('sector spelling reconciliation requires identical district, cell, branch and exact map point',()=>{
  const p={name:'MISSION PHARMACY',district:'RUBAVU',sector_cell_raw:'RUBACU BYAHI'};
  const o={decision:'review',url:'https://www.google.com/maps/place/Mission/data=!3d-1.65!4d29.27',dom:'Mission Pharmacy'};
  const b={point:{latitude:-1.65,longitude:29.27},query_result:{features:[{attributes:{district:'Rubavu',sector:'Rubavu'}}]}};
  const r={name:'MISSION PHARMACY LTD',location:'WESTERN,RUBAVU,RUBAVU,BYAHI'};
  assert.equal(validateRosterBoundaryResolution(p,o,b,r).corroborated_sector,'Rubavu');
  for(const row of [{...r,name:'MISSION BRANCH 2'},{...r,location:'WESTERN,RUBAVU,RUBAVU,BUGOYI'},{...r,location:'WESTERN,RUBAVU,GISENYI,BYAHI'}])assert.throws(()=>validateRosterBoundaryResolution(p,o,b,row));
  assert.throws(()=>validateRosterBoundaryResolution(p,{...o,dom:'Permanently closed'},b,r));
  assert.throws(()=>validateRosterBoundaryResolution(p,o,{...b,point:{latitude:-1.6,longitude:29.27}},r));
});
test('roster identity is name plus district and sector, never a historical register serial',()=>{
  const ps=[{id:'1',name:'PHARMACIE TETA Ltd',district:'GASABO',sector_cell_raw:'REMERA RUKIRI I'},{id:'2',name:'Teta Pharmacy',district:'GASABO',sector_cell_raw:'KIMIRONKO BIBARE'}];
  const row={name:'PHARMACIE TETA',location:'Kigali City, GASABO, KIMIRONKO HAFI YA GARE'};
  assert.deepEqual(matchRosterBranch(row,ps).map(p=>p.id),['2']);
  assert.equal(matchRosterBranch({...row,location:'Kigali City, GASABO, BIBARE'},ps).length,0);
  assert.equal(matchRosterBranch({...row,name:'TETA BRANCH 2'},ps).length,0);
  assert.equal(matchRosterBranch(row,[...ps,{...ps[1],id:'3'}]).length,2);
});
