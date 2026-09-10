import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Reported rather than thrown, so a missing variable surfaces as a clear
// message in the UI instead of crashing the page that imports this.
// Names only - never the values.
export const supabaseConfigError = !supabaseUrl
  ? "NEXT_PUBLIC_SUPABASE_URL is missing"
  : !supabaseAnonKey
    ? "NEXT_PUBLIC_SUPABASE_ANON_KEY is missing"
    : null;

// One shared browser client for the whole app. Only the public anon key
// belongs here; the service-role key must never reach the browser.
export const supabase = supabaseConfigError
  ? null
  : createClient(supabaseUrl, supabaseAnonKey);

