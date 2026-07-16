export function formatMoney(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(Math.round(value));
}

export function clampAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export function toNumber(value: FormDataEntryValue | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Parses a positive whole COP amount written as 50000 or 50.000. */
export function parseCopAmount(value: FormDataEntryValue | null): number | null {
  const input = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{3})*$/.test(input)) return null;

  const parsed = Number(input.replaceAll('.', ''));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}