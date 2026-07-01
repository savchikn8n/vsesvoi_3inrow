const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const DEV_SESSION_TTL_MS = 6 * 60 * 60 * 1000;

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function passwordsMatch(input: string, expected: string) {
  const [inputHash, expectedHash] = await Promise.all([sha256Hex(input), sha256Hex(expected)]);
  return inputHash === expectedHash;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    const expectedPassword = Deno.env.get('MAINTENANCE_DEV_PASSWORD') || '';
    if (!expectedPassword) {
      return new Response(JSON.stringify({ error: 'Dev access is not configured' }), {
        status: 503,
        headers: corsHeaders,
      });
    }

    const body = await req.json().catch(() => ({}));
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!password) {
      return new Response(JSON.stringify({ error: 'password is required' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    if (!(await passwordsMatch(password, expectedPassword))) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      expiresAt: Date.now() + DEV_SESSION_TTL_MS,
    }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (_) {
    return new Response(JSON.stringify({ error: 'Dev access error' }), {
      status: 400,
      headers: corsHeaders,
    });
  }
});
