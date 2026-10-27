// Hard-stop gate tests: every unsafe input in Sec 7 must stop, in all
// three languages. Safe repair talk must pass. New work, 2026-10-28.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkHardStop, CATEGORIES } from './safety.js';

const UNSAFE = [
  // [input, expectedCategory]
  ['I smell gas near the stove', 'gas'],
  ['there is a gas leak in the kitchen', 'gas'],
  ['சமையலறையில் கேஸ் வாசனை வருகிறது', 'gas'],
  ['रसोई में गैस की बदबू आ रही है', 'gas'],
  ['exposed wiring in the switchboard, sparks', 'electricity'],
  ['got an electric shock from the mains', 'electricity'],
  ['வயர் வெளியே தெரிகிறது, ஷாக் அடிக்கிறது', 'electricity'],
  ['बिजली के तार खुले हैं, शॉक लग रहा है', 'electricity'],
  ['fuel leak under the bike tank', 'fuel'],
  ['petrol is dripping near the engine', 'fuel'],
  ['பெட்ரோல் கசிகிறது', 'fuel'],
  ['पेट्रोल रिस रहा है', 'fuel'],
  ['crack in the load-bearing wall is growing', 'structural'],
  ['சுவர் விரிசல் பெரிதாகிறது', 'structural'],
  ['दीवार में दरार बढ़ रही है', 'structural'],
  ['brake failure on my Activa, lever goes loose', 'brakes'],
  ['பிரேக் பிடிக்கவில்லை', 'brakes'],
  ['ब्रेक नहीं लग रहा', 'brakes'],
  ['I cut my hand, it is bleeding', 'medical'],
];

const SAFE = [
  'The bike chain keeps slipping off the Hero Splendor',
  'Water is dripping from the kitchen tap',
  'பைக் சங்கிலி கழல்கிறது',
  'नल से पानी टपक रहा है',
  'The drawer is jammed and will not open',
];

describe('safety gate', () => {
  it('covers all required categories', () => {
    for (const c of ['gas', 'electricity', 'fuel', 'structural', 'brakes', 'medical']) {
      assert.ok(CATEGORIES.includes(c), `missing category ${c}`);
    }
  });
  for (const [input, category] of UNSAFE) {
    it(`stops: ${input.slice(0, 40)} -> ${category}`, () => {
      assert.deepEqual(checkHardStop(input), { stopped: true, category });
    });
  }
  for (const input of SAFE) {
    it(`passes safe input: ${input.slice(0, 40)}`, () => {
      assert.deepEqual(checkHardStop(input), { stopped: false, category: null });
    });
  }
  it('handles empty input', () => {
    assert.deepEqual(checkHardStop(''), { stopped: false, category: null });
    assert.deepEqual(checkHardStop(null), { stopped: false, category: null });
  });
});
