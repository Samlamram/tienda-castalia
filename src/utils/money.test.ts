import { describe, expect, it } from 'vitest';
import { parseCopAmount } from './money';

describe('parseCopAmount', () => {
  it.each([
    ['50000', 50000],
    ['50.000', 50000],
    ['1.234.567', 1234567]
  ])('interpreta %s como %s pesos', (input, expected) => {
    expect(parseCopAmount(input)).toBe(expected);
  });

  it.each([null, '', ' ', '0', '-1', '1e6', 'abc', '50.00', '50,000', '999999999999999999999'])('rechaza %s', (input) => {
    expect(parseCopAmount(input)).toBeNull();
  });
});