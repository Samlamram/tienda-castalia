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
