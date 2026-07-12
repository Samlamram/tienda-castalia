import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { db } from './data/db';

async function resetDb() {
  await db.delete();
  await db.open();
}

describe('App demo flow', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    cleanup();
  });

  it('lets a demo user enter the catalog and see product images', async () => {
    const { container } = render(<App />);

    fireEvent.change(await screen.findByPlaceholderText('Usuario'), { target: { value: 'Papa' } });
    fireEvent.change(screen.getByPlaceholderText(/PIN/), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await screen.findByText('Tienda');
    await screen.findByText('Agua Cristal 600 ml');

    await waitFor(() => {
      const imageElements = Array.from(container.querySelectorAll<HTMLImageElement>('.product-image-slot img'));
      expect(imageElements.length).toBeGreaterThanOrEqual(50);
      expect(imageElements.every((image) => image.src.startsWith('https://'))).toBe(true);
      expect(imageElements.some((image) => image.src.startsWith('https://images.openfoodfacts.org/'))).toBe(true);
    });
  });

  it('shows only the admin panel when the admin logs in', async () => {
    render(<App />);

    fireEvent.change(await screen.findByPlaceholderText('Usuario'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText(/PIN/), { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await screen.findByRole('heading', { name: 'Cuentas' });

    expect(screen.queryByRole('button', { name: 'Kiosko' })).toBeNull();
    expect(screen.queryByText(/Vista kiosko para admin/i)).toBeNull();
  });
});
