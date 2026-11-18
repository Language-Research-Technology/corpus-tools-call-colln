import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemId } from './item-id.js';

test('builds item IDs from language metadata and the three source components', () => {
  const item = { id: 1, language_series_number: '001', year_of_entry: 2020, accession_number: '02/3' };
  assert.equal(itemId(item, { full_language_name: 'Language Name', AIATSIS_area: 'A/', AIATSIS_district: 'B' }), 'Language%20Name_A%2FB/001/2020/02%2F3');
  assert.equal(itemId(item, { full_language_name: 'English', aiatsis_area: 'A', aiatsis_district: '1' }), 'English_A1/001/2020/02%2F3');
  assert.equal(itemId(item, { full_language_name: 'English' }), 'English_/001/2020/02%2F3');
});

test('rejects missing and unsafe item ID components', () => {
  const language = { full_language_name: 'Language' };
  assert.throws(() => itemId({ id: 9, language_series_number: 1, year_of_entry: null, accession_number: 2 }, language), /Item 9: missing year_of_entry/);
  assert.throws(() => itemId({ id: 9, language_series_number: 1, year_of_entry: 2020 }, language), /Item 9: missing accession_number/);
  assert.throws(() => itemId({ id: 9, language_series_number: '..', year_of_entry: 2020, accession_number: 2 }, language), /invalid language_series_number/);
  assert.throws(() => itemId({ id: 9 }, {}), /Item 9: missing full_language_name/);
});