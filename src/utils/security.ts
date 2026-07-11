export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`app-tienda:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyPin(pin: string, pinHash: string): Promise<boolean> {
  return (await hashPin(pin)) === pinHash;
}
