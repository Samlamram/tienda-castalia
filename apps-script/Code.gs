/**
 * Receptor de respaldo Supabase -> Google Sheets.
 *
 * Propiedades de script requeridas:
 * - SPREADSHEET_ID: ID de la hoja de respaldo.
 * - WEBHOOK_TOKEN: secreto aleatorio compartido con los Database Webhooks.
 */

const EVENT_SHEET = '_eventos';
const EVENT_HEADERS = [
  'event_id',
  'received_at',
  'operation',
  'schema',
  'table',
  'row_id',
  'record_json',
  'old_record_json'
];
const ALLOWED_TABLES = new Set([
  'accounts',
  'app_users',
  'app_sessions',
  'products',
  'product_price_history',
  'consumptions',
  'consumption_items',
  'consumption_void_requests',
  'financial_movements',
  'payment_applications',
  'inventory_movements',
  'fifo_cost_allocations',
  'store_finance_events',
  'audit_log'
]);
const SENSITIVE_KEY = /(pin|token|hash|salt|secret|password)/i;

function doGet() {
  return jsonResponse_({ ok: true, service: 'app-tienda-sheets-backup' });
}

function doPost(e) {
  const config = getConfig_();
  if (!e || !e.parameter || e.parameter.webhook_key !== config.webhookToken) {
    return jsonResponse_({ ok: false, error: 'unauthorized' });
  }

  const rawBody = e.postData && e.postData.contents;
  if (!rawBody) throw new Error('El webhook no contiene un cuerpo JSON.');

  const payload = JSON.parse(rawBody);
  if (payload.type === 'DASHBOARD_STATUS') {
    return jsonResponse_(getDashboardStatus());
  }
  if (payload.type === 'REFRESH_REPORTS') {
    return jsonResponse_(refreshReports());
  }
  if (payload.type === 'SNAPSHOT') {
    validateSnapshotPayload_(payload);
  } else {
    validatePayload_(payload);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
    const eventId = sha256_(rawBody);
    const events = ensureSheet_(spreadsheet, EVENT_SHEET, EVENT_HEADERS);

    if (hasEvent_(events, eventId)) {
      return jsonResponse_({ ok: true, duplicate: true, eventId: eventId });
    }

    if (payload.type === 'SNAPSHOT') {
      const snapshotRows = payload.records.map(redact_);
      replaceSnapshot_(spreadsheet, payload.table, snapshotRows);
      appendSnapshotEvent_(events, eventId, payload, snapshotRows.length);
      SpreadsheetApp.flush();
      return jsonResponse_({ ok: true, eventId: eventId, rows: snapshotRows.length });
    }

    const currentRecord = redact_(payload.record);
    const oldRecord = redact_(payload.old_record);
    mirrorRecord_(spreadsheet, payload, currentRecord, oldRecord);
    appendEvent_(events, eventId, payload, currentRecord, oldRecord);
    SpreadsheetApp.flush();

    return jsonResponse_({ ok: true, eventId: eventId });
  } finally {
    lock.releaseLock();
  }
}

function setupBackup() {
  const config = getConfig_();
  const spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  ensureSheet_(spreadsheet, EVENT_SHEET, EVENT_HEADERS);
  refreshReports();
  return { ok: true, spreadsheetName: spreadsheet.getName() };
}

function getConfig_() {
  if (
    typeof BACKUP_SPREADSHEET_ID !== 'undefined' &&
    typeof BACKUP_WEBHOOK_TOKEN !== 'undefined' &&
    BACKUP_SPREADSHEET_ID &&
    BACKUP_WEBHOOK_TOKEN
  ) {
    return {
      spreadsheetId: BACKUP_SPREADSHEET_ID,
      webhookToken: BACKUP_WEBHOOK_TOKEN
    };
  }
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
  const webhookToken = properties.getProperty('WEBHOOK_TOKEN');
  if (!spreadsheetId || !webhookToken) {
    throw new Error('Configura SPREADSHEET_ID y WEBHOOK_TOKEN en las propiedades del script.');
  }
  return { spreadsheetId: spreadsheetId, webhookToken: webhookToken };
}

function validatePayload_(payload) {
  if (!payload || payload.schema !== 'public') {
    throw new Error('Solo se aceptan eventos del esquema public.');
  }
  if (!['INSERT', 'UPDATE', 'DELETE'].includes(payload.type)) {
    throw new Error('Operacion de webhook no soportada.');
  }
  if (!ALLOWED_TABLES.has(payload.table)) {
    throw new Error('Tabla no autorizada: ' + String(payload.table));
  }
  const source = payload.type === 'DELETE' ? payload.old_record : payload.record;
  if (!source || !source.id) {
    throw new Error('El evento no incluye el id de la fila.');
  }
}

function validateSnapshotPayload_(payload) {
  if (!payload || payload.schema !== 'public') {
    throw new Error('Solo se aceptan snapshots del esquema public.');
  }
  if (!ALLOWED_TABLES.has(payload.table)) {
    throw new Error('Tabla no autorizada: ' + String(payload.table));
  }
  if (!Array.isArray(payload.records)) {
    throw new Error('El snapshot no contiene un arreglo de registros.');
  }
}

function replaceSnapshot_(spreadsheet, tableName, records) {
  const dataHeaders = [];
  const seen = new Set();
  records.forEach(function (record) {
    Object.keys(record || {}).forEach(function (key) {
      if (!seen.has(key) && key !== '_backup_status' && key !== '_backup_updated_at') {
        seen.add(key);
        dataHeaders.push(key);
      }
    });
  });
  if (seen.has('id')) {
    dataHeaders.splice(dataHeaders.indexOf('id'), 1);
    dataHeaders.unshift('id');
  }
  const headers = ['_backup_status', '_backup_updated_at'].concat(dataHeaders);
  const sheet = spreadsheet.getSheetByName(tableName) || spreadsheet.insertSheet(tableName);
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  if (records.length) {
    const receivedAt = new Date().toISOString();
    const values = records.map(function (record) {
      return headers.map(function (header) {
        if (header === '_backup_status') return 'ACTIVE';
        if (header === '_backup_updated_at') return receivedAt;
        return safeCell_(record[header]);
      });
    });
    sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  }
}

function appendSnapshotEvent_(sheet, eventId, payload, rowCount) {
  sheet.appendRow([
    eventId,
    new Date().toISOString(),
    'SNAPSHOT',
    payload.schema,
    payload.table,
    '',
    JSON.stringify({ rows: rowCount }),
    ''
  ]);
}

function mirrorRecord_(spreadsheet, payload, currentRecord, oldRecord) {
  const source = payload.type === 'DELETE' ? oldRecord : currentRecord;
  const incomingHeaders = Object.keys(source || {}).filter(function (key) {
    return key !== '_backup_status' && key !== '_backup_updated_at';
  });
  const requiredHeaders = ['_backup_status', '_backup_updated_at', 'id'].concat(
    incomingHeaders.filter(function (key) { return key !== 'id'; })
  );
  const sheet = ensureSheet_(spreadsheet, payload.table, requiredHeaders);
  const headers = readHeaders_(sheet);
  const idColumn = headers.indexOf('id') + 1;
  const rowId = String(source.id);
  let targetRow = 0;

  if (sheet.getLastRow() > 1) {
    const match = sheet
      .getRange(2, idColumn, sheet.getLastRow() - 1, 1)
      .createTextFinder(rowId)
      .matchEntireCell(true)
      .findNext();
    targetRow = match ? match.getRow() : 0;
  }

  if (!targetRow) targetRow = sheet.getLastRow() + 1;

  const values = headers.map(function (header) {
    if (header === '_backup_status') return payload.type === 'DELETE' ? 'DELETED' : 'ACTIVE';
    if (header === '_backup_updated_at') return new Date().toISOString();
    return safeCell_(source[header]);
  });
  sheet.getRange(targetRow, 1, 1, headers.length).setValues([values]);
}

function appendEvent_(sheet, eventId, payload, currentRecord, oldRecord) {
  const source = payload.record || payload.old_record || {};
  sheet.appendRow([
    eventId,
    new Date().toISOString(),
    payload.type,
    payload.schema,
    payload.table,
    safeCell_(source.id),
    JSON.stringify(currentRecord),
    JSON.stringify(oldRecord)
  ]);
}

function hasEvent_(sheet, eventId) {
  if (sheet.getLastRow() < 2) return false;
  return Boolean(
    sheet
      .getRange(2, 1, sheet.getLastRow() - 1, 1)
      .createTextFinder(eventId)
      .matchEntireCell(true)
      .findNext()
  );
}

function ensureSheet_(spreadsheet, name, requiredHeaders) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);

  const existing = readHeaders_(sheet);
  const missing = requiredHeaders.filter(function (header) {
    return existing.indexOf(header) === -1;
  });
  const headers = existing.concat(missing);

  if (headers.length > 0 && (sheet.getLastRow() === 0 || missing.length > 0)) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readHeaders_(sheet) {
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
}

function redact_(value) {
  if (Array.isArray(value)) return value.map(redact_);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).reduce(function (output, key) {
    output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact_(value[key]);
    return output;
  }, {});
}

function safeCell_(value) {
  if (value === null || value === undefined) return '';
  const normalized = typeof value === 'object' ? JSON.stringify(value) : value;
  if (typeof normalized === 'string' && /^[\t\r\n ]*[=+\-@]/.test(normalized)) {
    return "'" + normalized;
  }
  return normalized;
}

function sha256_(value) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value,
    Utilities.Charset.UTF_8
  ).map(function (byte) {
    return ((byte + 256) % 256).toString(16).padStart(2, '0');
  }).join('');
}

function jsonResponse_(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
