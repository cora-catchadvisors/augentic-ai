const SLACK_CHANNEL_ID = 'C06909QFJD6'; // #web-leads
const SPREADSHEET_ID = '1_iGkreS5906flEpdPHTj0W-2zLw63OuPTuVHOBb9GHc';
const SA_EMAIL = 'augentic-forms@catchkyle.iam.gserviceaccount.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// ── JWT / Google Auth ──

function base64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function arrayBufToBase64url(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf.buffer;
}

async function getAccessToken(privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToArrayBuffer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${arrayBufToBase64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  return data.access_token;
}

// ── Google Sheets append ──

async function appendToSheet(accessToken, sheetName, rowData) {
  const range = encodeURIComponent(`${sheetName}!A1`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  // Check if sheet exists, create if not
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const meta = await metaRes.json();
  const sheetExists = meta.sheets?.some(s => s.properties.title === sheetName);

  if (!sheetExists) {
    // Create the sheet tab
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] }),
    });
    // Write headers
    const headers = Object.keys(rowData);
    headers.unshift('timestamp');
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(sheetName + '!A1')}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [headers] }),
      }
    );
  }

  // Get current headers to maintain column order
  const headerRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(sheetName + '!1:1')}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const headerData = await headerRes.json();
  const headers = headerData.values?.[0] || [];

  // Build row matching header order
  const row = headers.map(h => {
    if (h === 'timestamp') return new Date().toISOString();
    return rowData[h] !== undefined ? String(rowData[h]) : '';
  });

  // Check for new fields not in headers
  const newKeys = Object.keys(rowData).filter(k => !headers.includes(k));
  if (newKeys.length > 0) {
    // Add new headers
    const lastCol = headers.length;
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(sheetName + '!' + columnLetter(lastCol + 1) + '1')}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [newKeys] }),
      }
    );
    // Add values for new columns
    for (const k of newKeys) {
      row.push(rowData[k] !== undefined ? String(rowData[k]) : '');
    }
  }

  await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
  });
}

function columnLetter(n) {
  let s = '';
  while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}

// ── Main handler ──

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS_HEADERS });
    }

    let data;
    try { data = await request.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS_HEADERS });
    }

    const { firstName, lastName, email, company, phone, revenue, interest, role, message, source, ref } = data;
    if (!email) {
      return new Response(JSON.stringify({ error: 'Email is required' }), { status: 400, headers: CORS_HEADERS });
    }

    const name = `${firstName || ''} ${lastName || ''}`.trim();
    const sheetName = data.formType || 'contact-form';
    const errors = [];

    // 1. Google Sheets
    try {
      const accessToken = await getAccessToken(env.GOOGLE_PRIVATE_KEY);
      const rowData = { firstName, lastName, email, company, phone, revenue, interest, role, message, source, ref: ref || '' };
      await appendToSheet(accessToken, sheetName, rowData);
    } catch (err) {
      console.error('Sheets error:', err);
      errors.push('sheets');
    }

    // 2. Slack notification
    try {
      const slackBlocks = [
        {
          type: 'header',
          text: { type: 'plain_text', text: 'Augentic AI — New Lead', emoji: true },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Name:*\n${name || 'N/A'}` },
            { type: 'mrkdwn', text: `*Email:*\n${email}` },
            { type: 'mrkdwn', text: `*Company:*\n${company || 'N/A'}` },
            { type: 'mrkdwn', text: `*Phone:*\n${phone || 'N/A'}` },
            { type: 'mrkdwn', text: `*Revenue:*\n${revenue || 'N/A'}` },
            { type: 'mrkdwn', text: `*Interest:*\n${interest || 'N/A'}` },
          ],
        },
      ];
      const extraFields = [];
      if (role) extraFields.push({ type: 'mrkdwn', text: `*Role:*\n${role}` });
      if (ref) extraFields.push({ type: 'mrkdwn', text: `*Referral:*\n${ref}` });
      if (message) extraFields.push({ type: 'mrkdwn', text: `*Message:*\n${message}` });
      if (extraFields.length) slackBlocks.push({ type: 'section', fields: extraFields });

      slackBlocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `_Source: ${source || 'website'} | Form: ${sheetName}_` }],
      });

      if (env.SLACK_BOT_TOKEN) {
        await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: SLACK_CHANNEL_ID,
            text: `Augentic AI — New lead: ${name} (${email})`,
            blocks: slackBlocks,
          }),
        });
      }
    } catch (err) {
      console.error('Slack error:', err);
      errors.push('slack');
    }

    return new Response(JSON.stringify({ success: true, errors }), { status: 200, headers: CORS_HEADERS });
  },
};
