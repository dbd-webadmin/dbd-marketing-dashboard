// Fetches GA4 data for all active clients and writes data/{slug}/latest.json
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

async function main() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
  });

  const analyticsData = google.analyticsdata({ version: 'v1beta', auth });
  const clients = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'clients.json')));

  for (const client of clients.clients) {
    if (!client.active || !client.ga4PropertyId) continue;

    console.log(`Fetching GA4 for ${client.name} (property ${client.ga4PropertyId})...`);

    try {
      const property = `properties/${client.ga4PropertyId}`;
      const today = new Date();
      const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const startDate = firstOfMonth.toISOString().split('T')[0];
      const endDate = today.toISOString().split('T')[0];

      // MTD summary metrics
      const [summary, timeSeries, channels] = await Promise.all([
        analyticsData.properties.runReport({
          property,
          requestBody: {
            dateRanges: [
              { startDate, endDate, name: 'current' },
              { startDate: offsetMonth(startDate, -1), endDate: offsetMonth(endDate, -1), name: 'previous' },
            ],
            metrics: [
              { name: 'sessions' },
              { name: 'totalUsers' },
              { name: 'screenPageViews' },
              { name: 'bounceRate' },
              { name: 'averageSessionDuration' },
              { name: 'newUsers' },
              { name: 'conversions' },
            ],
          },
        }),

        // Daily sessions for line chart (last 30 days)
        analyticsData.properties.runReport({
          property,
          requestBody: {
            dateRanges: [{ startDate: daysAgo(30), endDate }],
            dimensions: [{ name: 'date' }],
            metrics: [{ name: 'sessions' }, { name: 'conversions' }],
            orderBys: [{ dimension: { dimensionName: 'date' } }],
          },
        }),

        // Channel breakdown
        analyticsData.properties.runReport({
          property,
          requestBody: {
            dateRanges: [{ startDate, endDate }],
            dimensions: [{ name: 'sessionDefaultChannelGroup' }],
            metrics: [{ name: 'sessions' }],
            orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            limit: 8,
          },
        }),
      ]);

      const curr = summary.data.rows?.[0]?.metricValues || [];
      const prev = summary.data.rows?.[1]?.metricValues || [];
      const val = (row, i) => row[i] ? parseFloat(row[i].value) : null;

      const ga4 = {
        sessions:           val(curr, 0),
        users:              val(curr, 1),
        pageViews:          val(curr, 2),
        bounceRate:         val(curr, 3),
        avgSessionDuration: val(curr, 4),
        newUsers:           val(curr, 5),
        conversions:        val(curr, 6),
      };

      const ga4Prev = {
        sessions:    val(prev, 0),
        conversions: val(prev, 6),
      };

      const sessionSeries = (timeSeries.data.rows || []).map(r => ({
        date: formatDate(r.dimensionValues[0].value),
        value: parseFloat(r.metricValues[0].value),
      }));

      const conversionSeries = (timeSeries.data.rows || []).map(r => ({
        date: formatDate(r.dimensionValues[0].value),
        value: parseFloat(r.metricValues[1].value),
      }));

      const channelData = {};
      (channels.data.rows || []).forEach(r => {
        channelData[r.dimensionValues[0].value] = parseFloat(r.metricValues[0].value);
      });

      // Load existing client data file if it exists (to preserve non-GA4 data)
      const outDir  = path.join(__dirname, '..', 'data', client.slug);
      const outFile = path.join(outDir, 'latest.json');
      let existing = {};
      if (fs.existsSync(outFile)) existing = JSON.parse(fs.readFileSync(outFile));

      const output = {
        ...existing,
        name:    client.name,
        slug:    client.slug,
        updated: new Date().toISOString(),
        budget:  client.monthlyBudget ? { monthly: client.monthlyBudget } : null,
        summary: {
          ...(existing.summary || {}),
          sessions:        ga4.sessions,
          sessionsPrev:    ga4Prev.sessions,
          conversions:     ga4.conversions,
          conversionsPrev: ga4Prev.conversions,
          topChannel:      channels.data.rows?.[0]?.dimensionValues[0].value || null,
          lastUpdated:     new Date().toISOString(),
        },
        ga4,
        timeSeries: {
          ...(existing.timeSeries || {}),
          sessions:    sessionSeries,
          conversions: conversionSeries,
          channelSessions: channelData,
        },
        channelSpend: existing.channelSpend || null,
      };

      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outFile, JSON.stringify(output, null, 2));

      // Update summary in clients.json so the master dashboard card shows live metrics
      const clientsFile = path.join(__dirname, '..', 'data', 'clients.json');
      const clientsData = JSON.parse(fs.readFileSync(clientsFile));
      const idx = clientsData.clients.findIndex(c => c.slug === client.slug);
      if (idx !== -1) clientsData.clients[idx].summary = output.summary;
      fs.writeFileSync(clientsFile, JSON.stringify(clientsData, null, 2));

      console.log(`  ✓ Wrote data/${client.slug}/latest.json`);

    } catch (err) {
      console.error(`  ✗ ${client.name}: ${err.message}`);
      process.exit(1);
    }
  }
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function offsetMonth(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

function formatDate(yyyymmdd) {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

main().catch(err => { console.error(err); process.exit(1); });
