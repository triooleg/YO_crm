import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiscountValue } from '../lib/order-discount-input.mjs';

test('discount inputs use exact minor units and basis points', () => {
  assert.equal(parseDiscountValue('40,25', 'FIXED'), 4025);
  assert.equal(parseDiscountValue('12.35', 'PERCENT'), 1235);
  assert.equal(parseDiscountValue('100', 'PERCENT'), 10000);
  assert.equal(parseDiscountValue('0', 'FIXED'), 0);
  assert.equal(parseDiscountValue('21474836.47', 'FIXED'), 2147483647);
});
test('invalid precision, negative values and overflow cannot be submitted', () => {
  for (const text of ['', '-1', 'NaN', '1e2', '1.001', 'Infinity', '21474836.48']) {
    assert.equal(parseDiscountValue(text, 'FIXED'), null, text);
  }
  assert.equal(parseDiscountValue('100.01', 'PERCENT'), null);
});
