var LOCATOR_CONFIG = Object.freeze({
  sheetName: 'Store Locator Feed',
  cacheSeconds: 300,
  headerAliases: {
    name: ['Customer Name', 'Customer name', 'Customer nan', 'Customer full name', 'Customer', 'Store Name', 'Store name', 'Locator Name', 'Account Name', 'Retail Accounts', 'Sold To', 'Companies', 'Retailer', 'Account', 'Store', 'Client', 'Buyer', 'Shop', 'Location Name', 'Account / Customer Name'],
    address: ['Address', 'Final Address', 'Street Address', 'Location Address', 'Street', 'Addr'],
    city: ['City', 'Town', 'Municipality', 'Muni'],
    state: ['State', 'ST', 'Province', 'Region', 'Territory'],
    postalCode: ['Zip', 'Postal Code', 'Zip Code', 'Zipcode', 'Postal', 'Pin'],
    premiseType: ['Category', 'Premise Type', 'Type', 'Premise', 'Segment', 'Channel'],
    status: ['Publish Status', 'Status'],
    latitude: ['Latitude', 'Lat'],
    longitude: ['Longitude', 'Lng', 'Long'],
    placeId: ['Google Place ID', 'Place ID', 'Store ID', 'ID', 'Account ID'],
    phone: ['Phone', 'Phone Number', 'Tel', 'Contact'],
    website: ['Website', 'URL', 'Web'],
    cases: ['Cases', '9L Cases', 'Volume', 'Units Sold', 'Quantity', 'Qty', 'Units', '9 Liter Equivs', 'Cases 2026/7', 'Cases Sum', 'Jul Cases Sum', 'Case Equiv 2026', 'Sales', 'Sales (Cases)'],
    bottlings: ['Bottlings Stocked', 'Bottlings', 'Products', 'Item Names', 'Product Name', 'Product', 'Item Description', 'Item Descripti', 'Description Size', 'Description', 'Item Name', 'Brands', 'Brand', 'SKU'],
    date: ['Transaction date', 'Transaction d', 'Transaction Date', 'Date', 'Invoice Date', 'Order Date', 'Sale Date', 'Time']
  },
  // Optional: force a state for tabs that have no state anywhere in the tab name or data
  // (match is case-insensitive text inside the tab name or its title rows). Example:
  // stateOverrides: { 'LUX BEVERAGE': 'XX', 'Blanco August 2026': 'XX' }
  stateOverrides: {},
  requiredHeaders: [
    'Locator Name'
  ]
});

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID') || '1VnQcAcYE0LPmmmAIXCSH71V_RTUIZbW6';
  try {
    if (id) return SpreadsheetApp.openById(id);
  } catch (e) {}

  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;

  return SpreadsheetApp.openById('1VnQcAcYE0LPmmmAIXCSH71V_RTUIZbW6');
}

function getLocatorSheet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName('Store Locator') || 
              spreadsheet.getSheetByName(LOCATOR_CONFIG.sheetName) || 
              spreadsheet.getSheets()[0];
  if (!sheet) throw new Error('Missing locator sheet tab in Google Sheet.');
  return sheet;
}

function getFeedToken_() {
  return PropertiesService.getScriptProperties().getProperty('FEED_TOKEN') || '';
}