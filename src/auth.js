/**
 * auth.js
 * Apps Script ใช้ PIN ตรงๆ ทุก request (ไม่มี session)
 * Worker ใช้ JWT — login ครั้งเดียว, ถือ token ไว้ใช้ต่อ
 */

// ── Sign JWT ──────────────────────────────────────────────
export async function signToken(user, secret) {
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    sub:  user.id,
    name: user.name,
    role: user.role,
    exp:  Math.floor(Date.now() / 1000) + 60 * 60 * 12, // 12 ชั่วโมง
  }));
  const data = `${header}.${payload}`;
  const sig  = await hmac(data, secret);
  return `${data}.${sig}`;
}

// ── Verify JWT ────────────────────────────────────────────
export async function verifyToken(token, secret) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts;
    const expected = await hmac(`${header}.${payload}`, secret);
    if (sig !== expected) return null;
    const data = JSON.parse(atob(payload.replace(/-/g,'+').replace(/_/g,'/')));
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return { id: data.sub, name: data.name, role: data.role };
  } catch {
    return null;
  }
}

// ── HMAC-SHA256 (Web Crypto) ──────────────────────────────
async function hmac(data, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64url(sig);
}

function b64url(input) {
  const str = input instanceof ArrayBuffer
    ? String.fromCharCode(...new Uint8Array(input))
    : (typeof input === 'string' ? input : JSON.stringify(input));
  return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
