// Generates the key pair for Web Push reminders (README §5). Run once:
//   node scripts/vapid-keys.mjs
// then paste the printed line into `supabase secrets set …`. Keep the private key secret.
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
const cron = b64url(crypto.getRandomValues(new Uint8Array(24)));
console.log(`supabase secrets set VAPID_PUBLIC_KEY=${b64url(raw)} VAPID_PRIVATE_KEY=${d} VAPID_SUBJECT=mailto:you@example.com CRON_SECRET=${cron}`);
