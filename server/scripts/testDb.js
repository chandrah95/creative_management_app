/**
 * Supabase connection & schema test
 * Run with:  node server/scripts/testDb.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const supabase = require('../storage/supabaseClient');

const CHECK = '✓';
const FAIL  = '✗';
const WARN  = '⚠';

function pass(msg)  { console.log(`  ${CHECK}  ${msg}`); }
function fail(msg)  { console.log(`  ${FAIL}  ${msg}`); }
function warn(msg)  { console.log(`  ${WARN}  ${msg}`); }
function section(t) { console.log(`\n── ${t} ${'─'.repeat(50 - t.length)}`); }

async function checkTable(name) {
  const { data, error, count } = await supabase
    .from(name)
    .select('*', { count: 'exact', head: true });

  if (error) {
    if (error.code === '42P01') {
      fail(`${name}  →  table does not exist (schema not applied?)`);
    } else if (error.code === 'PGRST301') {
      warn(`${name}  →  exists but no SELECT policy (anon key / RLS blocks read) — row count unknown`);
    } else {
      fail(`${name}  →  ${error.message}`);
    }
    return false;
  }

  pass(`${name}  →  ${count} row(s)`);
  return true;
}

async function run() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Supabase DB Test');
  console.log(`  URL: ${process.env.SUPABASE_URL}`);
  const keyType = process.env.SUPABASE_KEY?.startsWith('sb_publishable')
    ? 'anon / publishable  ⚠  (service_role recommended for server)'
    : process.env.SUPABASE_KEY?.startsWith('sb_secret') || process.env.SUPABASE_KEY?.startsWith('eyJ')
      ? 'service_role  ✓'
      : 'unknown format';
  console.log(`  Key: ${keyType}`);
  console.log('══════════════════════════════════════════════════════');

  // ── 1. Basic connectivity ────────────────────────────────────
  section('1. Connectivity');
  const { error: pingErr } = await supabase.from('users').select('id').limit(1);
  if (pingErr && pingErr.code !== 'PGRST301') {
    if (pingErr.code === '42P01') {
      fail(`Cannot reach 'users' table — schema has not been applied yet.`);
      console.log('\n  → Run supabase_schema.sql in Supabase Dashboard → SQL Editor → New Query → Run\n');
      process.exit(1);
    }
    fail(`Connection failed: ${pingErr.message}`);
    process.exit(1);
  }
  pass('Connected to Supabase successfully');

  // ── 2. Table existence & row counts ─────────────────────────
  section('2. Tables');
  const tables = [
    'users',
    'ticket_counters',
    'tickets',
    'subtasks',
    'ticket_comments',
    'subtask_comments',
    'ticket_status_history',
    'subtask_status_history',
    'ai_settings'
  ];
  const results = [];
  for (const t of tables) results.push(await checkTable(t));
  const allOk = results.every(Boolean);

  // ── 3. Users sample ─────────────────────────────────────────
  section('3. Seed users');
  const { data: users, error: usersErr } = await supabase
    .from('users')
    .select('id, email, name, role, projects')
    .order('role');

  if (usersErr) {
    warn(`Cannot read users: ${usersErr.message}`);
    warn('This is expected with an anon key when RLS is enabled — use service_role key to bypass.');
  } else if (!users?.length) {
    warn('users table is empty — seed data not inserted yet');
  } else {
    for (const u of users) {
      pass(`[${u.role.padEnd(18)}]  ${u.email}  (projects: ${(u.projects || []).join(', ') || 'none'})`);
    }
  }

  // ── 4. Enum / schema spot-checks ────────────────────────────
  section('4. Schema spot-checks');
  const spotChecks = [
    { table: 'tickets',  cols: 'project, status, title, brief_deck_url' },
    { table: 'subtasks', cols: 'task_type, asset_type_l1, asset_type_l2, is_need_studio, is_need_copywriting' },
    { table: 'users',    cols: 'role, projects, lead_id, max_story_points' }
  ];
  for (const { table, cols } of spotChecks) {
    const { error: e } = await supabase.from(table).select(cols).limit(0);
    if (!e) pass(`${table} (${cols})`);
    else    fail(`${table}: ${e.message}`);
  }

  // ── 5. Summary ───────────────────────────────────────────────
  section('5. Summary');
  if (allOk) {
    pass('All tables exist and are reachable.');
    if (process.env.SUPABASE_KEY?.startsWith('sb_publishable')) {
      warn('Using anon key — swap to service_role key (sb_secret_...) in .env for full server access.');
      warn('Find it in: Supabase Dashboard → Project Settings → API → service_role (secret).');
    }
  } else {
    warn('Some tables are missing. If the schema has not been applied yet:');
    console.log('    1. Open Supabase Dashboard → SQL Editor → New Query');
    console.log('    2. Paste the full contents of supabase_schema.sql');
    console.log('    3. Click Run, then re-run this script\n');
  }

  console.log('');
}

run().catch(err => {
  console.error('\nUnhandled error:', err.message);
  process.exit(1);
});
