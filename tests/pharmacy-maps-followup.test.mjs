import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSupplementalBoundary} from '../scripts/pharmacy-maps-followup.mjs';
const p={id:'retail-2026-05-479',registry_entry_key:'retail-2026-05-479',district:'GASABO',sector_cell_raw:'REMERA RUKIRI II'};
const o={pharmacy_id:p.id,registry_entry_key:p.id,decision:'review',coordinates:{latitude:-1.9591741,longitude:30.1091981},url:'https://www.google.com/maps/place/Ngabo/data=!3d-1.9591741!4d30.1091981',dom:'Ngabo Pharmacy Open Phone 0782 383 770'};
const data={features:[{attributes:{district:'Gasabo',sector:'Remera'}}]};
test('supplemental evidence requires unchanged identity and exact official boundary',()=>{
  assert.deepEqual(validateSupplementalBoundary(p,o,data),o.coordinates);
  assert.throws(()=>validateSupplementalBoundary(p,{...o,pharmacy_id:'another'},data),/Identity/);
  assert.throws(()=>validateSupplementalBoundary(p,{...o,coordinates:{...o.coordinates,latitude:-2}},data),/point/);
  assert.throws(()=>validateSupplementalBoundary(p,o,{features:[{attributes:{district:'Gasabo',sector:'Kimironko'}}]}),/boundary|mismatch/);
  assert.throws(()=>validateSupplementalBoundary(p,o,{...data,exceededTransferLimit:true}),/mismatch/);
  assert.throws(()=>validateSupplementalBoundary(p,o,{features:[...data.features,...data.features]}),/mismatch/);
  assert.throws(()=>validateSupplementalBoundary(p,{...o,dom:'Ngabo Pharmacy permanently closed'},data),/Closed/);
});
