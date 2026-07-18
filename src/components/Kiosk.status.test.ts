import { describe, expect, it } from 'vitest';
import { paymentStatusMeta, pendingStatusMeta } from './Kiosk';

describe('estados visibles del historial de usuario', () => {
  it.each([
    ['pending', 'Sin sincronizar', 'sync-pending'],
    ['sending', 'Sincronizando', 'sync-sending'],
    ['confirmed', 'Sincronizada', 'sync-synced'],
    ['failed', 'Error de sincronización', 'sync-failed'],
    ['needs_review', 'Requiere revisión', 'sync-review']
  ] as const)('mapea sincronizacion %s', (status, label, className) => {
    expect(pendingStatusMeta(status)).toEqual({ label, className });
  });

  it.each([
    ['unpaid', 'Sin pagar', 'payment-unpaid'],
    ['partial', 'Pago parcial', 'payment-partial'],
    ['paid', 'Pagada', 'payment-paid'],
    ['voided', 'Anulada', 'record-voided']
  ] as const)('mapea pago %s', (status, label, className) => {
    expect(paymentStatusMeta(status)).toEqual({ label, className });
  });
});
