const assert = require('assert');
require('../stock-engine.js');
const E = global.StockEngine;

function idx(rows, col='code') { return E.buildIndex(rows, col); }

// 1) Direct stock must use JST available, not physical.
{
  const jst = idx([{ code: 'BF120', 'จำนวน': 3, 'จํานวนที่ใช้ได้': 2 }]);
  const r = E.resolveStockForCode({
    code: 'BF120', jstIndex: jst, comboMap: new Map(), componentUsage: new Map(),
    jstAvailableColumn: 'จํานวนที่ใช้ได้', jstPhysicalColumn: 'จำนวน', sharedPolicy: 'block'
  });
  assert.equal(r.status, 'OK');
  assert.equal(r.quantity, 2);
  assert.equal(r.physicalRaw, 3);
}

// 2) Negative available is clamped to zero but kept as a warning.
{
  const jst = idx([{ code: 'NEG1', 'จำนวน': 0, 'จํานวนที่ใช้ได้': -2 }]);
  const r = E.resolveStockForCode({
    code: 'NEG1', jstIndex: jst, comboMap: new Map(), componentUsage: new Map(),
    jstAvailableColumn: 'จํานวนที่ใช้ได้', jstPhysicalColumn: 'จำนวน', sharedPolicy: 'block'
  });
  assert.equal(r.quantity, 0);
  assert.ok(r.warnings.some(x => x.includes('ติดลบ')));
}

// 3) Family resolver: RU454XL should expand to the real RU454 family, not RU45 + 4XL.
{
  const vrich = idx([
    { code: 'RU454S' }, { code: 'RU454M' }, { code: 'RU454L' }, { code: 'RU454XL' },
    { code: 'RU45S' }, { code: 'RU454XL' }
  ]);
  const jstSet = new Set(['RU454S','RU454M','RU454L','RU454XL']);
  const r = E.resolveFamily('RU454XL', vrich, [jstSet]);
  assert.equal(r.mode, 'family');
  assert.equal(r.base, 'RU454');
  assert.deepEqual(new Set(r.members), new Set(['RU454S','RU454M','RU454L','RU454XL']));
}

// 4) A111 = A110 x2; Available 150 => 75 sets.
{
  const jst = idx([{ code: 'A110', 'จำนวน': 152, 'จํานวนที่ใช้ได้': 150 }]);
  const comboMap = E.buildComboMap([
    { combo: 'A111', component: 'A110', qty: 2 }
  ], { comboCodeColumn: 'combo', comboComponentColumn: 'component', comboRequiredQtyColumn: 'qty' });
  const r = E.resolveStockForCode({
    code: 'A111', jstIndex: jst, comboMap, componentUsage: new Map(),
    jstAvailableColumn: 'จํานวนที่ใช้ได้', jstPhysicalColumn: 'จำนวน', sharedPolicy: 'block'
  });
  assert.equal(r.status, 'OK');
  assert.equal(r.quantity, 75);
}

// 5) Shared component blocks by default.
{
  const jst = idx([{ code: 'A2222', 'จำนวน': 1, 'จํานวนที่ใช้ได้': 1 }]);
  const comboMap = E.buildComboMap([
    { combo: 'A212', component: 'A2222', qty: 1 },
    { combo: 'A3112', component: 'A2222', qty: 1 },
  ], { comboCodeColumn: 'combo', comboComponentColumn: 'component', comboRequiredQtyColumn: 'qty' });
  const usage = new Map([['A2222', new Set(['A212','A3112'])]]);
  const r = E.resolveStockForCode({
    code: 'A3112', jstIndex: jst, comboMap, componentUsage: usage,
    jstAvailableColumn: 'จํานวนที่ใช้ได้', jstPhysicalColumn: 'จำนวน', sharedPolicy: 'block'
  });
  assert.equal(r.status, 'SHARED_COMPONENT');
}

// 6) Theoretical mode can calculate shared combo but must warn.
{
  const jst = idx([{ code: 'A2222', 'จำนวน': 1, 'จํานวนที่ใช้ได้': 1 }]);
  const comboMap = E.buildComboMap([
    { combo: 'A212', component: 'A2222', qty: 1 },
    { combo: 'A3112', component: 'A2222', qty: 1 },
  ], { comboCodeColumn: 'combo', comboComponentColumn: 'component', comboRequiredQtyColumn: 'qty' });
  const usage = new Map([['A2222', new Set(['A212','A3112'])]]);
  const r = E.resolveStockForCode({
    code: 'A3112', jstIndex: jst, comboMap, componentUsage: usage,
    jstAvailableColumn: 'จํานวนที่ใช้ได้', jstPhysicalColumn: 'จำนวน', sharedPolicy: 'theoretical'
  });
  assert.equal(r.status, 'OK');
  assert.equal(r.quantity, 1);
  assert.ok(r.warnings.some(x => x.includes('double counting')));
}

// 7) Code present in both JST Item and Combo is ambiguous and blocked.
{
  const jst = idx([{ code: 'EA70XL', 'จำนวน': 4, 'จํานวนที่ใช้ได้': 4 }]);
  const comboMap = E.buildComboMap([
    { combo: 'EA70XL', component: 'EA70-XL', qty: 2 }
  ], { comboCodeColumn: 'combo', comboComponentColumn: 'component', comboRequiredQtyColumn: 'qty' });
  const r = E.resolveStockForCode({
    code: 'EA70XL', jstIndex: jst, comboMap, componentUsage: new Map(),
    jstAvailableColumn: 'จํานวนที่ใช้ได้', jstPhysicalColumn: 'จำนวน', sharedPolicy: 'block'
  });
  assert.equal(r.status, 'AMBIGUOUS_SOURCE');
}


// 8) A Combo must also be blocked when its component is still sold directly in vRich.
{
  const vrich = idx([
    { code: 'A111', qty: 270 },
    { code: 'A110', qty: 74 },
  ]);
  const jst = idx([{ code: 'A110', 'จำนวน': 152, 'จํานวนที่ใช้ได้': 150 }]);
  const comboMap = E.buildComboMap([
    { combo: 'A111', component: 'A110', qty: 2 }
  ], { comboCodeColumn: 'combo', comboComponentColumn: 'component', comboRequiredQtyColumn: 'qty' });
  const usage = E.buildActiveComponentUsage(comboMap, vrich, 'qty', new Set(['A111']));
  assert.ok(usage.get('A110').has('DIRECT:A110'));
  const r = E.resolveStockForCode({
    code: 'A111', jstIndex: jst, comboMap, componentUsage: usage,
    jstAvailableColumn: 'จํานวนที่ใช้ได้', jstPhysicalColumn: 'จำนวน', sharedPolicy: 'block'
  });
  assert.equal(r.status, 'SHARED_COMPONENT');
}

console.log('PASS stock-engine tests');
