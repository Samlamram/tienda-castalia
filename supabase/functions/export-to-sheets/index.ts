type RowsPayload = Record<string, Array<Record<string, string | number | boolean | null>>>;

interface ExportRequest {
  sheetId: string;
  rows: RowsPayload;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function base64Url(value: ArrayBuffer | string): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const clean = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const raw = Uint8Array.from(atob(clean), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    raw,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function getAccessToken(): Promise<string> {
  const email = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  const privateKey = Deno.env.get('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');
  if (!email || !privateKey) {
    throw new Error('Faltan GOOGLE_SERVICE_ACCOUNT_EMAIL o GOOGLE_PRIVATE_KEY.');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const key = await importPrivateKey(privateKey);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64Url(signature)}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error_description ?? 'No se pudo autenticar con Google.');
  return body.access_token;
}

function rowsToValues(rows: Array<Record<string, string | number | boolean | null>>): Array<Array<string | number | boolean | null>> {
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>()));
  return [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ''))];
}

async function ensureSheets(sheetId: string, tabNames: string[], token: string): Promise<void> {
  const metadata = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await metadata.json();
  if (!metadata.ok) throw new Error(body.error?.message ?? 'No se pudo leer el spreadsheet.');

  const existing = new Set<string>((body.sheets ?? []).map((sheet: { properties: { title: string } }) => sheet.properties.title));
  const requests = tabNames
    .filter((title) => !existing.has(title))
    .map((title) => ({ addSheet: { properties: { title } } }));

  if (requests.length === 0) return;
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message ?? 'No se pudieron crear pestañas.');
}

async function updateTab(sheetId: string, tabName: string, rows: Array<Record<string, string | number | boolean | null>>, token: string) {
  const values = rowsToValues(rows);
  const range = encodeURIComponent(`'${tabName}'!A1`);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values })
    }
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message ?? `No se pudo actualizar ${tabName}.`);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const payload = (await request.json()) as ExportRequest;
    if (!payload.sheetId || !payload.rows) throw new Error('sheetId y rows son requeridos.');
    const token = await getAccessToken();
    const tabNames = Object.keys(payload.rows);
    await ensureSheets(payload.sheetId, tabNames, token);
    for (const tabName of tabNames) {
      await updateTab(payload.sheetId, tabName, payload.rows[tabName], token);
    }
    return Response.json({ ok: true, tabs: tabNames }, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Error exportando a Sheets.' },
      { status: 400, headers: corsHeaders }
    );
  }
});
