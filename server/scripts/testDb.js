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
  section('4. Schema spot-checks (enum columns)');
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

  // ── 5. Data integrity checks ─────────────────────────────────
  section('5. Data integrity');

  // 5a. Tickets with story_points = 0 but no subtasks (deleteSubtask bug)
  {
    const { data: zeroSP, error } = await supabase
      .from('tickets')
      .select('id, ticket_id, story_points')
      .eq('story_points', 0);
    if (error) {
      warn(`story_points=0 check failed: ${error.message}`);
    } else if (!zeroSP?.length) {
      pass('No tickets with story_points = 0 (deleteSubtask SP bug not triggered)');
    } else {
      // Cross-check: do any of these have subtasks?
      let zeroOrphans = 0;
      for (const t of zeroSP) {
        const { count } = await supabase
          .from('subtasks').select('id', { count: 'exact', head: true })
          .eq('parent_id', t.id);
        if (count === 0) zeroOrphans++;
      }
      if (zeroOrphans > 0) {
        fail(`${zeroOrphans} ticket(s) have story_points=0 with no subtasks — should be NULL. Run FIX 3 in fixes.sql`);
      } else {
        pass(`${zeroSP.length} ticket(s) have story_points=0 but all have subtasks (legitimate)`);
      }
    }
  }

  // 5b. Subtasks with assigned_to_id but null snapshot
  {
    const { count, error } = await supabase
      .from('subtasks')
      .select('id', { count: 'exact', head: true })
      .not('assigned_to_id', 'is', null);
    // We can only check existence through a select + JS filter due to JSONB
    const { data: subs, error: subsErr } = await supabase
      .from('subtasks')
      .select('id, subtask_id, assigned_to_id, assigned_to_snapshot')
      .not('assigned_to_id', 'is', null);
    if (subsErr) {
      warn(`subtask snapshot check failed: ${subsErr.message}`);
    } else {
      const nullSnap = (subs || []).filter(s => !s.assigned_to_snapshot);
      if (nullSnap.length === 0) {
        pass('All assigned subtasks have assigned_to_snapshot populated');
      } else {
        fail(`${nullSnap.length} subtask(s) have assigned_to_id but NULL assigned_to_snapshot — run FIX 4d in fixes.sql`);
        for (const s of nullSnap.slice(0, 5)) {
          warn(`  subtask ${s.subtask_id} (${s.id}) — assigned_to_id=${s.assigned_to_id}`);
        }
      }
    }
  }

  // 5c. Tickets with stub assigned_to_snapshot (missing 'name' key)
  {
    const { data: tix, error } = await supabase
      .from('tickets')
      .select('id, ticket_id, assigned_to_id, assigned_to_snapshot')
      .not('assigned_to_id', 'is', null);
    if (error) {
      warn(`ticket snapshot stub check failed: ${error.message}`);
    } else {
      const stubSnap = (tix || []).filter(
        t => t.assigned_to_snapshot && !t.assigned_to_snapshot.name
      );
      if (stubSnap.length === 0) {
        pass('All assigned tickets have valid assigned_to_snapshot (includes name)');
      } else {
        fail(`${stubSnap.length} ticket(s) have stub assigned_to_snapshot without 'name' — run FIX 4c in fixes.sql`);
        for (const t of stubSnap.slice(0, 5)) {
          warn(`  ticket ${t.ticket_id} (${t.id})`);
        }
      }
    }
  }

  // 5d. SP mismatch: parent story_points vs sum of subtask story_points
  {
    const { data: tix, error } = await supabase
      .from('tickets')
      .select('id, ticket_id, story_points, subtasks(story_points)');
    if (error) {
      warn(`SP mismatch check failed: ${error.message}`);
    } else {
      const mismatched = (tix || []).filter(t => {
        const subs   = t.subtasks || [];
        const hasAny = subs.some(s => s.story_points != null);
        const sum    = hasAny ? subs.reduce((acc, s) => acc + (s.story_points || 0), 0) : null;
        return t.story_points !== sum;
      });
      if (mismatched.length === 0) {
        pass('All parent ticket story_points match sum of subtask story_points');
      } else {
        warn(`${mismatched.length} ticket(s) have story_points mismatch vs subtask sum`);
        for (const t of mismatched.slice(0, 5)) {
          const subs = t.subtasks || [];
          const sum  = subs.reduce((acc, s) => acc + (s.story_points || 0), 0);
          warn(`  ticket ${t.ticket_id}: parent SP=${t.story_points}, subtask sum=${sum}`);
        }
      }
    }
  }

  // ── 6. TICKET_SELECT column validation ───────────────────────
  section('6. TICKET_SELECT column validation');

  // Verify all columns referenced in TICKET_SELECT actually exist
  // by running a limit-0 select on each table subset
  const selectChecks = [
    {
      table: 'tickets',
      cols: 'id, ticket_id, project, status, story_points, submitted_by_id, submitted_by_snapshot, assigned_to_id, assigned_to_snapshot, submitted_at, updated_at, title, description, brief_deck_url, campaign_code, campaign_start_date, campaign_end_date, platform, posting_type, posting_date, sku_number, packaging_type, brand, dimensions, live_date',
    },
    {
      table: 'subtasks',
      cols: 'id, subtask_id, status, story_points, assigned_to_id, assigned_to_snapshot, is_need_studio, is_need_copywriting, task_type, asset_type_l1, asset_type_l2, dlp_id, banner_name, category_id, catalogue_id, reference_id, objective_type, draft_url, final_url, child_notes, child_due',
    },
    {
      table: 'subtask_status_history',
      cols: 'id, from_status, to_status, changed_at, changed_by_id, changed_by_name, changed_by_role',
    },
    {
      table: 'subtask_comments',
      cols: 'id, text, image_data, posted_at, posted_by_snapshot',
    },
    {
      table: 'ticket_status_history',
      cols: 'id, from_status, to_status, changed_at, changed_by_id, changed_by_name, changed_by_role',
    },
    {
      table: 'ticket_comments',
      cols: 'id, text, image_data, posted_at, posted_by_snapshot',
    },
  ];
  for (const { table, cols } of selectChecks) {
    const { error: e } = await supabase.from(table).select(cols).limit(0);
    if (!e) pass(`${table}: all TICKET_SELECT columns exist`);
    else    fail(`${table}: ${e.message}`);
  }

  // ── 7. buildFieldColumns column validation ────────────────────
  section('7. buildFieldColumns column validation');
  {
    const fieldCols = [
      'title', 'description', 'brief_deck_url',
      'campaign_code', 'campaign_start_date', 'campaign_end_date',
      'platform', 'posting_type', 'posting_date',
      'sku_number', 'packaging_type', 'brand', 'dimensions', 'live_date',
    ].join(', ');
    const { error: e } = await supabase.from('tickets').select(fieldCols).limit(0);
    if (!e) pass(`tickets: all buildFieldColumns columns exist`);
    else    fail(`tickets buildFieldColumns: ${e.message}`);
  }

  // ── 8. createUser insert column validation ────────────────────
  section('8. createUser column validation');
  {
    const userCols = 'id, email, password_hash, name, role, projects, department, lead_id, max_story_points';
    const { error: e } = await supabase.from('users').select(userCols).limit(0);
    if (!e) pass(`users: all createUser insert columns exist`);
    else    fail(`users createUser: ${e.message}`);
  }

  // ── 9. Summary ───────────────────────────────────────────────
  section('9. Summary');
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
