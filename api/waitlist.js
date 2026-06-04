const BASE_COUNT = 20;

// Simple in-memory rate limit: max 3 attempts per IP per 10 minutes
const rateLimit = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const window = 10 * 60 * 1000;
  const entry = rateLimit.get(ip) || { count: 0, start: now };
  if (now - entry.start > window) {
    rateLimit.set(ip, { count: 1, start: now });
    return false;
  }
  if (entry.count >= 3) return true;
  entry.count++;
  rateLimit.set(ip, entry);
  return false;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISPOSABLE = new Set([
  'mailinator.com','guerrillamail.com','tempmail.com','throwam.com',
  'yopmail.com','trashmail.com','fakeinbox.com','10minutemail.com','sharklasers.com'
]);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const sbHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
  };

  if (req.method === 'GET') {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/Waitlist?select=id`, {
      method: 'HEAD',
      headers: { ...sbHeaders, 'Prefer': 'count=exact' },
    });
    const dbCount = parseInt(response.headers.get('content-range')?.split('/')[1] || '0', 10);
    return res.status(200).json({ count: BASE_COUNT + dbCount });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(200).json({ ok: true }); // silent reject
  }

  const { email, is_company, company_name, message } = req.body;
  const domain = email?.split('@')[1]?.toLowerCase();

  if (!email || !EMAIL_RE.test(email) || DISPOSABLE.has(domain)) {
    return res.status(200).json({ ok: true }); // silent reject
  }

  const row = { id: crypto.randomUUID(), email };
  if (is_company) row.is_company = true;
  if (company_name) row.company_name = company_name;
  if (message) row.message = message;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/Waitlist`, {
    method: 'POST',
    headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
    body: JSON.stringify(row),
  });

  if (response.status === 409) {
    return res.status(200).json({ ok: true, message: 'Already on the list' });
  }

  if (!response.ok) {
    const err = await response.text();
    console.error('Supabase error:', err);
    return res.status(500).json({ error: 'Failed to join waitlist' });
  }

  return res.status(200).json({ ok: true });
}
