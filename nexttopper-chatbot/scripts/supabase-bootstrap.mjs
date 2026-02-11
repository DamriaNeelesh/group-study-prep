import fs from 'node:fs/promises';
import path from 'node:path';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'avtmohfcixlzriichofq';
const MANAGEMENT_API = process.env.SUPABASE_MANAGEMENT_API ?? 'https://api.supabase.com';

const DEFAULT_CLINE_SETTINGS_PATH =
  'C:\\\\Users\\\\Asus\\\\AppData\\\\Roaming\\\\Code\\\\User\\\\globalStorage\\\\saoudrizwan.claude-dev\\\\settings\\\\cline_mcp_settings.json';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function getSupabaseAccessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;

  const clinePath = process.env.CLINE_MCP_SETTINGS_PATH ?? DEFAULT_CLINE_SETTINGS_PATH;
  const data = await readJson(clinePath);

  const authHeader = data?.mcpServers?.supabase?.headers?.Authorization;
  if (typeof authHeader === 'string') {
    const m = authHeader.match(/^Bearer\\s+(.+)$/);
    if (m?.[1]) return m[1];
  }

  const envToken =
    data?.mcpServers?.['github.com/supabase-community/supabase-mcp']?.env?.SUPABASE_ACCESS_TOKEN;
  if (typeof envToken === 'string' && envToken.trim()) return envToken.trim();

  throw new Error(
    `SUPABASE_ACCESS_TOKEN not found. Set env SUPABASE_ACCESS_TOKEN or ensure ${clinePath} contains your token.`
  );
}

async function mgmtFetch(token, method, pathname, { query, body, headers } = {}) {
  const url = new URL(MANAGEMENT_API);
  url.pathname = pathname;
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      ...(headers ?? {}),
    },
    body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
  });

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`${method} ${url} -> ${res.status} ${res.statusText}\n${text}`);
  }

  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function getApiKeys(token) {
  const keys = await mgmtFetch(
    token,
    'GET',
    `/v1/projects/${PROJECT_REF}/api-keys`,
    { query: { reveal: 'true' } }
  );
  assert(Array.isArray(keys), 'Unexpected api-keys response');

  const anon = keys.find((k) => k.name === 'anon')?.api_key;
  const service = keys.find((k) => k.name === 'service_role')?.api_key;
  assert(anon, 'anon key not found');
  assert(service, 'service_role key not found');

  return { anon, service };
}

async function listMigrations(token) {
  const migs = await mgmtFetch(
    token,
    'GET',
    `/v1/projects/${PROJECT_REF}/database/migrations`
  );
  return Array.isArray(migs) ? migs : [];
}

async function applyMigrations(token, migrationsDir) {
  const files = (await fs.readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  const existing = new Set((await listMigrations(token)).map((m) => m?.name).filter(Boolean));
  const results = [];

  for (const f of files) {
    const name = path.basename(f, path.extname(f));
    if (existing.has(name)) {
      results.push({ applied: false, name });
      continue;
    }

    const query = await fs.readFile(path.join(migrationsDir, f), 'utf8');
    await mgmtFetch(token, 'POST', `/v1/projects/${PROJECT_REF}/database/migrations`, {
      body: { name, query },
    });

    existing.add(name);
    results.push({ applied: true, name });
  }

  return results;
}

async function upsertSecrets(token, secrets) {
  // Delete first to avoid conflicts, then create.
  const names = secrets.map((s) => s.name);
  await mgmtFetch(token, 'DELETE', `/v1/projects/${PROJECT_REF}/secrets`, { body: names }).catch(
    () => {}
  );
  await mgmtFetch(token, 'POST', `/v1/projects/${PROJECT_REF}/secrets`, { body: secrets });
}

async function deployEdgeFunction(token, name, filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  const form = new FormData();
  form.append(
    'metadata',
    new Blob(
      [
        JSON.stringify({
          name,
          entrypoint_path: 'index.ts',
          verify_jwt: false,
        }),
      ],
      { type: 'application/json' }
    )
  );
  form.append('file', new Blob([content], { type: 'application/typescript' }), 'index.ts');

  await mgmtFetch(token, 'POST', `/v1/projects/${PROJECT_REF}/functions/deploy`, {
    query: { slug: name },
    body: form,
  });
}

async function execSql(token, query) {
  return await mgmtFetch(token, 'POST', `/v1/projects/${PROJECT_REF}/database/query`, {
    body: { query, read_only: false },
  });
}

async function ensureAuthUser({ projectRef, serviceRoleKey, anonKey }, email, password) {
  const adminUrl = `https://${projectRef}.supabase.co/auth/v1/admin/users`;
  const createRes = await fetch(adminUrl, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
    }),
  });

  if (createRes.ok) {
    const json = await createRes.json();
    return { id: json?.id, created: true };
  }

  const bodyText = await createRes.text().catch(() => '');
  // If already exists, login to get user id.
  const alreadyExists =
    (createRes.status === 400 && bodyText.toLowerCase().includes('already')) ||
    (createRes.status === 422 && bodyText.toLowerCase().includes('email_exists'));
  if (alreadyExists) {
    const tokenUrl = `https://${projectRef}.supabase.co/auth/v1/token?grant_type=password`;
    const loginRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
    if (!loginRes.ok) {
      const t = await loginRes.text().catch(() => '');
      throw new Error(`User exists but login failed for ${email}: ${t || loginRes.statusText}`);
    }
    const loginJson = await loginRes.json();
    return { id: loginJson?.user?.id, created: false };
  }

  throw new Error(`Failed to create user ${email}: ${createRes.status} ${bodyText}`);
}

async function writeEnvFiles({ anon }) {
  const supabaseUrl = `https://${PROJECT_REF}.supabase.co`;
  const adminEnv = `VITE_SUPABASE_URL=${supabaseUrl}\nVITE_SUPABASE_ANON_KEY=${anon}\n`;
  const demoEnv = `VITE_SUPABASE_PROJECT_REF=${PROJECT_REF}\n`;

  await fs.writeFile(path.join('apps', 'admin', '.env'), adminEnv, 'utf8');
  await fs.writeFile(path.join('apps', 'demo', '.env'), demoEnv, 'utf8');
}

async function smokeTest() {
  const url = `https://${PROJECT_REF}.supabase.co/functions/v1/bot_start`;
  const visitor_id = crypto.randomUUID();

  for (let attempt = 1; attempt <= 10; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        visitor_id,
        page_url: 'https://demo.local/',
        nt_user: { id: null, name: null, mobile: null },
      }),
    });
    if (res.ok) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function main() {
  const token = await getSupabaseAccessToken();
  const keys = await getApiKeys(token);

  const migRes = await applyMigrations(token, path.join('supabase', 'migrations'));

  const supportEmail = process.env.SUPPORT_INBOX_EMAIL ?? 'support@nexttoppers.com';
  const salesEmail = process.env.SALES_ALERT_EMAIL ?? supportEmail;

  const secrets = [
    { name: 'PROJECT_REF', value: PROJECT_REF },
    { name: 'SERVICE_ROLE_KEY', value: keys.service },
    { name: 'SUPPORT_INBOX_EMAIL', value: supportEmail },
    { name: 'SALES_ALERT_EMAIL', value: salesEmail },
  ];

  if (process.env.RESEND_API_KEY) secrets.push({ name: 'RESEND_API_KEY', value: process.env.RESEND_API_KEY });
  if (process.env.RESEND_FROM) secrets.push({ name: 'RESEND_FROM', value: process.env.RESEND_FROM });
  if (process.env.OPENAI_API_KEY) secrets.push({ name: 'OPENAI_API_KEY', value: process.env.OPENAI_API_KEY });
  if (process.env.OPENAI_MODEL) secrets.push({ name: 'OPENAI_MODEL', value: process.env.OPENAI_MODEL });

  await upsertSecrets(token, secrets);

  // Deploy edge functions
  await deployEdgeFunction(token, 'bot_start', path.join('supabase', 'functions', 'bot_start', 'index.ts'));
  await deployEdgeFunction(token, 'bot_event', path.join('supabase', 'functions', 'bot_event', 'index.ts'));
  await deployEdgeFunction(token, 'lead_create', path.join('supabase', 'functions', 'lead_create', 'index.ts'));
  await deployEdgeFunction(token, 'ticket_create', path.join('supabase', 'functions', 'ticket_create', 'index.ts'));

  // Create test users + profiles
  const testPassword = process.env.NT_TEST_PASSWORD ?? 'NextToppers#1234';
  const authCtx = { projectRef: PROJECT_REF, serviceRoleKey: keys.service, anonKey: keys.anon };

  const adminUser = await ensureAuthUser(authCtx, 'admin@nexttoppers.test', testPassword);
  const counselorUser = await ensureAuthUser(authCtx, 'counselor@nexttoppers.test', testPassword);

  assert(adminUser.id, 'admin user id missing');
  assert(counselorUser.id, 'counselor user id missing');

  await execSql(
    token,
    `insert into public.nt_profiles (id, display_name, role)\n` +
      `values ('${adminUser.id}', 'Admin', 'admin')\n` +
      `on conflict (id) do update set display_name = excluded.display_name, role = excluded.role;`
  );
  await execSql(
    token,
    `insert into public.nt_profiles (id, display_name, role)\n` +
      `values ('${counselorUser.id}', 'Counselor', 'counselor')\n` +
      `on conflict (id) do update set display_name = excluded.display_name, role = excluded.role;`
  );

  await writeEnvFiles(keys);

  const ok = await smokeTest();
  assert(ok, 'Smoke test failed: bot_start not responding (functions may still be propagating).');

  // Minimal output for logs (avoid printing secrets)
  console.log(
    JSON.stringify(
      {
        project_ref: PROJECT_REF,
        migrations: migRes,
        test_users: {
          admin_email: 'admin@nexttoppers.test',
          counselor_email: 'counselor@nexttoppers.test',
          password: testPassword,
        },
        support_inbox: supportEmail,
        sales_alert: salesEmail,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e?.stack || e?.message || String(e));
  process.exit(1);
});
