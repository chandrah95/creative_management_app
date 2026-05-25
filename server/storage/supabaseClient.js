const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY;

if (!url || !key) {
  throw new Error('[supabase] SUPABASE_URL and SUPABASE_KEY must be set in .env');
}

const supabase = createClient(url, key, {
  auth: {
    autoRefreshToken: false,
    persistSession:   false
  }
});

module.exports = supabase;
