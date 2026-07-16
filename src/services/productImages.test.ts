import { describe, expect, it } from 'vitest';
import {
  PRODUCT_IMAGE_MAX_INPUT_BYTES,
  compressProductImage,
  productImageStoragePath
} from './productImages';

describe('imagenes de producto', () => {
  it('extrae solo rutas pertenecientes al bucket administrado', () => {
    expect(productImageStoragePath(
      'https://demo.supabase.co/storage/v1/object/public/product-images/products/a%20b.webp'
    )).toBe('products/a b.webp');
    expect(productImageStoragePath('https://images.example.com/product.webp')).toBeNull();
    expect(productImageStoragePath('data:image/png;base64,abc')).toBeNull();
  });

  it('rechaza archivos que no sean imagen antes de intentar procesarlos', async () => {
    const file = new File(['texto'], 'producto.txt', { type: 'text/plain' });
    await expect(compressProductImage(file)).rejects.toThrow('archivo de imagen');
  });

  it('rechaza originales por encima del limite antes de abrirlos', async () => {
    const oversized = new File(
      [new Uint8Array(PRODUCT_IMAGE_MAX_INPUT_BYTES + 1)],
      'grande.jpg',
      { type: 'image/jpeg' }
    );
    await expect(compressProductImage(oversized)).rejects.toThrow('15 MB');
  });
});
