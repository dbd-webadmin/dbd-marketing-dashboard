// Reads the DBD Marketing Clients Google Sheet and writes data/clients.json
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SHEET_RANGE = 'Clients!A2:K'; // Skip header row

// Column order in the Google Sheet (A=0, B=1, ...)
const COL = {
  name:             0,  // A
  slug:             1,  // B
  active:           2,  // C  (TRUE/FALSE)
  ga4PropertyId:    3,  // D
  googleAdsId:      4,  // E
  metaAdAccountId:  5,  // F
  mailchimpListId:  6,  // G
  hubspotPortalId:  7,  // H
  monthlyBudget:    8,  // I  (number, no $ sign)
  clientType:       9,  // J  (e.g. Tourism, Economic Development)
  notes:            10, // K
};

async function main() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: SHEET_RANGE,
  });

  const rows = res.data.values || [];
  const clients = rows
    .filter(r => r[COL.name]?.trim())
    .map(r => ({
      name:            r[COL.name]?.trim() || '',
      slug:            (r[COL.slug]?.trim() || r[COL.name]?.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')),
      active:          r[COL.active]?.toUpperCase() === 'TRUE',
      ga4PropertyId:   r[COL.ga4PropertyId]?.trim()   || null,
      googleAdsId:     r[COL.googleAdsId]?.trim()     || null,
      metaAdAccountId: r[COL.metaAdAccountId]?.trim() || null,
      mailchimpListId: r[COL.mailchimpListId]?.trim()  || null,
      hubspotPortalId: r[COL.hubspotPortalId]?.trim()  || null,
      monthlyBudget:   r[COL.monthlyBudget] ? Number(String(r[COL.monthlyBudget]).replace(/[^0-9.]/g, '')) : 0,
      clientType:      r[COL.clientType]?.trim() || '',
      notes:           r[COL.notes]?.trim() || '',
      summary:         null, // filled in by fetch-metrics workflows
    }));

  const output = {
    updated: new Date().toISOString(),
    clients,
  };

  const outPath = path.join(__dirname, '..', 'data', 'clients.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Wrote ${clients.length} clients to data/clients.json`);
}

main().catch(err => { console.error(err); process.exit(1); });
