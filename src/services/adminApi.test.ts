import { describe, expect, it } from 'vitest';
import { mapAdminSnapshot } from './adminApi';

describe('mapper del snapshot administrativo', () => {
  it('normaliza numeric de Supabase y completa las vistas derivadas', () => {
    const snapshot = mapAdminSnapshot({
      generated_at: '2026-07-14T12:00:00.000Z',
      catalog_version: '7',
      accounts: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Familia',
          status: 'active',
          version: '3',
          created_at: '2026-07-14T10:00:00.000Z',
          updated_at: '2026-07-14T11:00:00.000Z'
        }
      ],
      users: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          account_id: '00000000-0000-4000-8000-000000000001',
          username: 'papa',
          name: 'Papa',
          role: 'user',
          status: 'active',
          version: '2',
          created_at: '2026-07-14T10:00:00.000Z',
          updated_at: '2026-07-14T11:00:00.000Z'
        }
      ],
      products: [
        {
          id: '00000000-0000-4000-8000-000000000003',
          name: 'Agua',
          category: 'Bebidas',
          price: '200.50',
          stock_min: '2.500',
          status: 'active',
          version: '4',
          created_at: '2026-07-14T10:00:00.000Z',
          updated_at: '2026-07-14T11:00:00.000Z'
        }
      ],
      consumptions: [
        {
          id: '00000000-0000-4000-8000-000000000004',
          client_operation_id: '00000000-0000-4000-8000-000000000005',
          account_id: '00000000-0000-4000-8000-000000000001',
          user_id: '00000000-0000-4000-8000-000000000002',
          status: 'confirmed',
          total: '100.00',
          created_at: '2026-07-14T12:00:00.000Z'
        }
      ],
      financial_movements: [
        {
          id: '00000000-0000-4000-8000-000000000006',
          account_id: '00000000-0000-4000-8000-000000000001',
          scope: 'user',
          user_id: '00000000-0000-4000-8000-000000000002',
          paid_by_user_id: '00000000-0000-4000-8000-000000000002',
          movement_type: 'payment',
          amount: '60.00',
          request_id: '00000000-0000-4000-8000-000000000007',
          created_at: '2026-07-14T13:00:00.000Z'
        }
      ],
      payment_applications: [
        {
          id: '00000000-0000-4000-8000-000000000008',
          financial_movement_id: '00000000-0000-4000-8000-000000000006',
          account_id: '00000000-0000-4000-8000-000000000001',
          user_id: '00000000-0000-4000-8000-000000000002',
          consumption_id: '00000000-0000-4000-8000-000000000004',
          amount: '60.00',
          created_at: '2026-07-14T13:00:00.000Z'
        }
      ],
      inventory_movements: [
        {
          id: '00000000-0000-4000-8000-000000000009',
          product_id: '00000000-0000-4000-8000-000000000003',
          movement_type: 'purchase',
          quantity_delta: '10.500',
          unit_cost: '100.00',
          request_id: '00000000-0000-4000-8000-000000000010',
          created_at: '2026-07-14T09:00:00.000Z'
        }
      ]
    });

    expect(snapshot.catalogVersion).toBe(7);
    expect(snapshot.accounts[0].version).toBe(3);
    expect(snapshot.products[0]).toMatchObject({ price: 200.5, stockMin: 2.5 });
    expect(snapshot.productStocks[0]).toMatchObject({ stock: 10.5, isLow: false });
    expect(snapshot.userBalances[0]).toMatchObject({ consumed: 100, paid: 60, balance: 40 });
    expect(snapshot.consumptionPaymentStatuses[0]).toMatchObject({
      paid: 60,
      openAmount: 40,
      status: 'partial'
    });
  });

  it('elimina secretos aunque una respuesta o auditoria defectuosa los incluya', () => {
    const snapshot = mapAdminSnapshot({
      users: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          username: 'admin',
          name: 'Administrador',
          role: 'admin',
          status: 'active',
          version: 1,
          created_at: '2026-07-14T10:00:00.000Z',
          updated_at: '2026-07-14T10:00:00.000Z',
          pin_hash: 'user-top-secret',
          pin_salt: 'user-secret-salt',
          token_hash: 'user-token-hash'
        }
      ],
      audit_log: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          request_id: '00000000-0000-4000-8000-000000000003',
          actor_user_id: '00000000-0000-4000-8000-000000000001',
          action: 'update',
          entity_type: 'app_users',
          record_id: '00000000-0000-4000-8000-000000000001',
          before_data: { name: 'Admin', pin_hash: 'audit-old-secret', pin_salt: 'audit-old-salt' },
          after_data: { name: 'Administrador', newPin: '9876', token: 'audit-token' },
          metadata: { session_token: 'raw-session-token', safe: 'ok' },
          changed_fields: ['name', 'pin_hash', 'newPin'],
          created_at: '2026-07-14T12:00:00.000Z'
        }
      ]
    });

    expect(snapshot.users[0]).not.toHaveProperty('pinHash');
    expect(snapshot.users[0]).not.toHaveProperty('pinSalt');
    expect(snapshot.auditLog[0]).toMatchObject({
      beforeData: { name: 'Admin' },
      afterData: { name: 'Administrador' },
      metadata: { safe: 'ok' },
      changedFields: ['name']
    });

    const serialized = JSON.stringify(snapshot);
    for (const secret of [
      'user-top-secret',
      'user-secret-salt',
      'user-token-hash',
      'audit-old-secret',
      'audit-old-salt',
      '9876',
      'audit-token',
      'raw-session-token'
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
