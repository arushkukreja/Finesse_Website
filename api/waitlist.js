import { createHmac, randomUUID } from 'node:crypto';

const MAX_ATTEMPTS = 3;
const WINDOW_SECONDS = 10 * 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwam.com',
  'yopmail.com', 'trashmail.com', 'fakeinbox.com', '10minutemail.com',
  'sharklasers.com'
]);

function send(res, status, body, extraHeaders = {}) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  Object.entries(extraHeaders).forEach(([name, value]) => res.setHeader(name, value));
  return res.status(status).json(body);
}

function parseBody(body) {
  if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  if (typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function requestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function supabaseFetch(url, key, path, options = {}) {
  return fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      ...options.headers
    },
    signal: AbortSignal.timeout(8_000)
  });
}

async function consumeRateLimit(url, key, ipHash) {
  const response = await supabaseFetch(url, key, 'rpc/consume_waitlist_rate_limit', {
    method: 'POST',
    body: JSON.stringify({
      p_ip_hash: ipHash,
      p_limit: MAX_ATTEMPTS,
      p_window_seconds: WINDOW_SECONDS
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error('Waitlist rate-limit RPC failed', { status: response.status, detail });
    throw new Error('Rate-limit service unavailable');
  }

  return response.json();
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return send(res, 405, { error: 'Method not allowed' }, { Allow: 'POST, OPTIONS' });
  }

  if (!isSameOrigin(req)) {
    return send(res, 403, { error: 'Cross-site submissions are not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const rateLimitSecret = process.env.RATE_LIMIT_SECRET || supabaseKey;

  if (!supabaseUrl || !supabaseKey || !rateLimitSecret) {
    console.error('Waitlist configuration is incomplete');
    return send(res, 503, { error: 'Signup is temporarily unavailable' });
  }

  const body = parseBody(req.body);
  if (!body) return send(res, 400, { error: 'Invalid request body' });

  // Bots commonly fill fields hidden from people. Keep the response generic.
  if (typeof body.website === 'string' && body.website.trim()) {
    return send(res, 200, { ok: true });
  }

  const ipHash = createHmac('sha256', rateLimitSecret)
    .update(requestIp(req))
    .digest('hex');

  try {
    const allowed = await consumeRateLimit(supabaseUrl, supabaseKey, ipHash);
    if (!allowed) {
      return send(
        res,
        429,
        { error: 'Too many signup attempts. Please try again in ten minutes.' },
        { 'Retry-After': String(WINDOW_SECONDS) }
      );
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const domain = email.split('@')[1] || '';
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
      return send(res, 422, { error: 'Enter a valid email address' });
    }
    if (DISPOSABLE.has(domain)) {
      return send(res, 422, { error: 'Please use a permanent email address' });
    }

    const row = { id: randomUUID(), email };

    if (body.is_company === true) row.is_company = true;
    if (typeof body.company_name === 'string' && body.company_name.trim()) {
      row.company_name = body.company_name.trim().slice(0, 160);
    }
    if (typeof body.message === 'string' && body.message.trim()) {
      row.message = body.message.trim().slice(0, 2_000);
    }

    const response = await supabaseFetch(supabaseUrl, supabaseKey, 'Waitlist', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(row)
    });

    if (response.status === 409) {
      return send(res, 200, { ok: true, message: 'Already subscribed' });
    }

    if (!response.ok) {
      const detail = await response.text();
      console.error('Waitlist insert failed', { status: response.status, detail });
      return send(res, 502, { error: 'We could not add you right now. Please try again.' });
    }

    return send(res, 200, { ok: true, message: 'Subscribed' });
  } catch (error) {
    console.error('Waitlist request failed', { message: error?.message });
    return send(res, 503, { error: 'Signup is temporarily unavailable' });
  }
}
