import { describe, expect, it } from 'vitest';
import { b64urlDecode, b64urlEncode, encryptPayload, vapidAuthorization } from '../../supabase/functions/_shared/webpush';

const B = (u: Uint8Array) => u as BufferSource;

// Receiver side of RFC 8291, written from the spec, to check what the server sends.
async function decrypt(body: Uint8Array, ua: CryptoKeyPair, auth: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  expect(rs).toBe(4096);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const asKey = await crypto.subtle.importKey('raw', B(asPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const hk = async (s: Uint8Array, ikm: Uint8Array, info: string | Uint8Array, n: number) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: B(s), info: B(typeof info === 'string' ? new TextEncoder().encode(info) : info) },
        await crypto.subtle.importKey('raw', B(ikm), 'HKDF', false, ['deriveBits']),
        n * 8,
      ),
    );
  const info = new Uint8Array([...new TextEncoder().encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
  const ikm = await hk(auth, secret, info, 32);
  const cek = await hk(salt, ikm, 'Content-Encoding: aes128gcm\0', 16);
  const nonce = await hk(salt, ikm, 'Content-Encoding: nonce\0', 12);
  const key = await crypto.subtle.importKey('raw', B(cek), 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: B(nonce) }, key, B(cipher)));
  expect(plain[plain.length - 1]).toBe(2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

describe('web push', () => {
  it('encrypts a message only the subscribed browser can read', async () => {
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const sub = { p256dh: b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey))), auth: b64urlEncode(auth) };
    const msg = JSON.stringify({ title: 'Training day', body: 'Push is next 💪' });
    const body = await encryptPayload(sub, new TextEncoder().encode(msg));
    expect(await decrypt(body, ua, auth)).toBe(msg);
    // Fresh salt + key every time.
    expect(b64urlEncode((await encryptPayload(sub, new TextEncoder().encode(msg))).slice(0, 16))).not.toBe(b64urlEncode(body.slice(0, 16)));
  });

  it('rejects malformed subscription keys', async () => {
    await expect(encryptPayload({ p256dh: 'AAAA', auth: 'AAAA' }, new Uint8Array(1))).rejects.toThrow('Bad subscription keys');
  });

  it('signs a VAPID token the push service can verify', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const publicKey = b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
    const header = await vapidAuthorization('https://web.push.apple.com/QGuQyavXutnMH', { publicKey, privateKey: jwk.d!, subject: 'mailto:me@example.com' }, Date.UTC(2026, 0, 1));
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m[4]).toBe(publicKey);
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(m[2])));
    expect(claims).toEqual({ aud: 'https://web.push.apple.com', exp: Date.UTC(2026, 0, 1) / 1000 + 12 * 3600, sub: 'mailto:me@example.com' });
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, B(b64urlDecode(m[3])), new TextEncoder().encode(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
  });
});
