/**
 * The Supabase project behind accounts and sync. Both values are public by
 * design: the anon key ships in every copy of the app, and row-level security
 * on every table is what keeps one account's data away from another. Leave them
 * empty to build Quire without accounts; the File menu then says so.
 */
export const CLOUD = Object.freeze({
  supabaseUrl: '',
  supabaseAnonKey: '',
  /** Where Google sends the browser back after sign-in. Empty means this page's address. */
  redirectTo: '',
});

export function cloudConfigured() {
  return Boolean(CLOUD.supabaseUrl && CLOUD.supabaseAnonKey);
}
