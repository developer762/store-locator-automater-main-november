const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = {
  console,
  Utilities: {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    computeDigest: () => Array(32).fill(1),
  },
};
vm.createContext(context);
for (const file of ['Config.gs', 'Feed.gs']) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'apps-script', file), 'utf8');
  vm.runInContext(source, context, { filename: file });
}

const headers = [
  'Locator Name', 'City', 'State', 'Postal Code', 'Premise Type',
  'Publish Status', 'Latitude', 'Longitude', 'Final Address',
  'Google Place ID', 'Cases (Aug 2026)', 'Bottlings Stocked',
];

test('publishes ready rows and normalizes locator fields', () => {
  const result = context.normalizeSheetRows_([
    headers,
    ['Example Liquor', 'Austin', 'TX', '78701', 'Retail', 'Ready', '30.2672', '-97.7431', '1 Main St, Austin, TX 78701', 'place-1', '12.5', 'Blanco'],
    ['Example Bar', 'Dallas', 'TX', '75201', 'Bar & Restaurant', 'Ready - address estimated', '32.7767', '-96.7970', '2 Main St, Dallas, TX 75201', '', '2', 'Reposado'],
  ], 'Store Locator', {});

  assert.equal(result.locations.length, 2);
  assert.equal(result.locations[0].type, 'retail');
  assert.equal(result.locations[0].cases, 12.5);
  assert.equal(result.locations[0].tabName, 'Store Locator');
  assert.equal(result.locations[1].type, 'bar-restaurant');
  assert.equal(result.skipped.notReady, 0);
});

test('handles tab structure like July 2026 NY-NJ (Row 58 format: Col A=Product, Col B=Store, Col C=City)', () => {
  const sheetData = [
    ['Casa Mexico Reposado High Proof 6/750mL', 'BRUCE\'S WINES & LIQUORS LLC', 'FRESH MEADOWS'],
    ['Casa Mexico Reposado High Proof 6/1050mL', 'World Of Liquors', 'India'],
  ];

  const result = context.normalizeSheetRows_(sheetData, 'July 2026 NY-NJ', {});

  assert.equal(result.locations.length, 2);
  assert.equal(result.locations[1].name, 'World Of Liquors');
  assert.equal(result.locations[1].city, 'India');
  assert.equal(result.locations[1].state, 'NY');
  assert.equal(result.locations[1].tabName, 'July 2026 NY-NJ');
  assert.equal(result.locations[1].bottlings, 'Casa Mexico Reposado High Proof 6/1050mL');
});

test('sanitizes invalid state text (e.g. store names parsed as state)', () => {
  const customHeaders = ['Store Name', 'Address', 'City', 'State'];
  const sheetData = [
    customHeaders,
    ['509 Liquors', '100 Main St', 'Dallas', '19th Hole Package'], // Invalid state text
  ];

  const result = context.normalizeSheetRows_(sheetData, 'Depletions TX July 2026', {});

  assert.equal(result.locations.length, 1);
  assert.equal(result.locations[0].state, 'TX'); // Falls back to inferred tab state TX instead of store name
});

test('publishes successfully when Address and City columns are removed/absent (e.g. Blanco August 2026 format)', () => {
  const customHeaders = ['Transaction date', 'Customer name', 'Item Description', 'Quantity'];
  const sheetData = [
    ['Casa Mexico - Blanco'],
    [''],
    customHeaders,
    ['08/04/2026', 'Bob\'s Liquors DL', 'Case of 6 bottles', '1.00'],
    ['08/13/2026', 'Community Spirits', 'Case of 6 bottles', '3.00'],
    ['08/16/2026', 'High Spirits', 'Case of 6 bottles', '3.00'],
    ['08/31/2026', 'City Wide Liquor', 'Case of 6 bottles', '1.00'],
  ];

  const result = context.normalizeSheetRows_(sheetData, 'Blanco August 2026', {});

  assert.equal(result.locations.length, 4);
  assert.equal(result.locations[0].name, 'Bob\'s Liquors DL');
  assert.equal(result.locations[0].cases, 1);
  assert.equal(result.locations[0].bottlings, 'Case of 6 bottles');
  assert.ok(typeof result.locations[0].latitude === 'number' && !isNaN(result.locations[0].latitude));
  assert.ok(typeof result.locations[0].longitude === 'number' && !isNaN(result.locations[0].longitude));
  assert.equal(result.locations[1].name, 'Community Spirits');
  assert.equal(result.locations[1].cases, 3);
});

test('rejects non-ready, empty, and duplicate rows', () => {
  const result = context.normalizeSheetRows_([
    headers,
    ['Good', 'Austin', 'TX', '78701', 'Retail', 'Ready', '30', '-97', '1 Main St', 'same-place', '1', 'Blanco'],
    ['Duplicate', 'Austin', 'TX', '78701', 'Retail', 'Ready', '30', '-97', '1 Main St', 'same-place', '1', 'Blanco'],
    ['', '', '', '', '', '', '', '', '', '', '', ''],
    ['Held', 'Austin', 'TX', '78701', 'Retail', 'Excluded', '30', '-97', '3 Main St', '', '1', 'Blanco'],
  ], 'Store Locator', {});

  assert.equal(result.locations.length, 1);
  assert.equal(result.skipped.duplicate, 1);
  assert.equal(result.skipped.notReady, 1);
});

test('handles depletion inventory tabs like Depletions MEMPHIS August 2026 and ignores Total rows', () => {
  const sheetData = [
    ['Athens Memphis'],
    [''],
    ['1989', 'SWIRL/LIEBER', '', '', '', 'All Numbers are Case Equivalence'],
    [''],
    ['ITEM', 'DESCRIPTION SIZE', 'CASE PACK', 'BEG INV', 'RECEIPTS', 'VARIANCE', 'TRANSFERS', 'VND/HSE', 'SALES', 'END INV', 'ON ORDER'],
    ['42311730', 'CASA MEXICC 750ML', '6', '9.00', '0.00', '0.00', '0.00', '0.00', '0.00', '9.00', '0.00'],
    ['42311731', 'CASA MEXICC 750ML', '6', '9.00', '0.00', '0.00', '0.00', '0.00', '2.00', '7.00', '0.00'],
    ['42311732', 'CASA MEXICC 750ML', '6', '21.00', '0.00', '0.00', '0.00', '0.00', '1.00', '20.00', '0.00'],
    ['42311733', 'CASA MEXICC 750ML', '6', '9.00', '0.00', '0.00', '0.00', '0.00', '0.00', '9.00', '0.00'],
    ['42314492', 'CASA MEXICC 750ML', '6', '17.00', '0.00', '-1.00', '0.00', '0.00', '1.00', '15.00', '0.00'],
    ['', '', '', '98.25009', '0.00', '-1.00', '0.00', '0.83332', '4.00', '75.08343', '0.00'], // TOTAL ROW
  ];

  const result = context.normalizeSheetRows_(sheetData, 'Depletions MEMPHIS August 2026', {});

  // Should have 5 valid items, exactly 0 total rows!
  assert.equal(result.locations.length, 5);
  // Title should not be 0, 1, 2, 4
  assert.ok(!/^\d+(\.\d+)?$/.test(result.locations[0].name));
  assert.equal(result.locations[0].name, 'CASA MEXICC 750ML');
  assert.equal(result.locations[1].cases, 2);
  assert.equal(result.locations[2].cases, 1);
});


test('state filter only receives real US state codes (no DFW / ST / US)', () => {
  const tx = context.normalizeSheetRows_([
    ['Location / Salesman Assigned / Customer Name', 'Product Name / City', 'Cases 2026/7', 'Cases Sum'],
    ['DFW', 'Casa Mexico High Proof Reposado 750', '12.00', '12.00'],
    ['Goody Goody #16', 'Little Elm', '1.00', '1.00'],
  ], 'Depletions TX July 2026', {});
  tx.locations.forEach((l) => assert.equal(l.state, 'TX'));

  const ks = context.normalizeSheetRows_([
    ['Account', 'Address', 'City', 'ST', 'Zip'],
    ['FIFO Adjustment - City', 'Distributor Address', 'City', 'ST', 'Zip'],
  ], 'Depletions KS July 2026', {});
  assert.equal(ks.locations[0].state, 'KS');

  const nash = context.normalizeSheetRows_([
    ['Athens Nashville'], [''],
    ['ITEM', 'DESCRIPTION SIZE', 'CASE PACK', 'BEG INV', 'SALES'],
    ['42311730', 'CASA MEXICO BLANCO TEQUILA', '6', '14.99', '8.00'],
  ], 'Depletions Nashville August 2026', {});
  assert.equal(nash.locations[0].state, 'TN');

  const blanco = context.normalizeSheetRows_([
    ['LUX BEVERAGE LLC   WH8730132'], ['Blanco'], ['Casa Mexico - Blanco'],
    ['Transaction date', 'Customer full name', 'Description', 'Quantity'],
    ['08/04/2026', "Bob's Liquors DL1934237", 'Case of 6 bottles', '1'],
  ], 'Blanco August 2026', {});
  assert.equal(blanco.locations[0].state, ''); // unknown state -> not listed as a fake "US" option
  assert.equal(blanco.locations[0].territory, 'Blanco August 2026');

  assert.equal(context.normalizeStateCode_('Texas'), 'TX');
  assert.equal(context.normalizeStateCode_('DFW'), '');
  assert.equal(context.normalizeStateCode_('US'), '');
  assert.equal(context.normalizeStateCode_('ST'), '');
});

test('MA/RI 2x multiplier only applies to MA or RI tabs', () => {
  const rows = [['Customer Name', 'Cases'], ['Some Store', '3']];
  assert.equal(context.normalizeSheetRows_(rows, 'MA-RI August 2026', {}).locations[0].cases, 6);
  assert.equal(context.normalizeSheetRows_(rows, 'Depletions SC Summary', {}).locations[0].cases, 3);
});