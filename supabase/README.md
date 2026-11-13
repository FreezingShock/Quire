# Accounts and sync: setup

Quire's accounts and sync run on a Supabase project. The app ships two public
values in `src/cloud/config.js`: the project URL and the anon key. Both are safe
to publish, because every table is protected by row-level security (see
`migrations/0001_accounts_and_sync.sql`).

## One-time setup

1. **Create the project.** supabase.com, New project. Free tier is enough.
2. **Run the migration.** SQL Editor, paste `migrations/0001_accounts_and_sync.sql`, Run.
3. **Turn on sign-in methods.** Authentication, Providers:
   - Email: on. Leave "Confirm email" on.
   - Google: on. Needs a Google OAuth client. In Google Cloud Console, create an
     OAuth client (Web application). Add the Supabase callback
     `https://<project-ref>.supabase.co/auth/v1/callback` as an authorized redirect URI.
     Paste the client ID and secret into Supabase.
4. **Allow the redirect addresses.** Authentication, URL Configuration:
   - Site URL: the web app address (for example `https://quirejournal.com/`).
   - Redirect URLs: the web app address, and for the desktop app
     `http://127.0.0.1:53847/callback` (the desktop listens on that port).
5. **Email templates.** Authentication, Email Templates: paste each file from
   `templates/` into the matching slot (Confirm signup, Magic link, Reset password).
6. **Custom sender.** Project Settings, Auth, SMTP Settings: use a custom SMTP
   provider (Resend's free tier works) on a domain you own, so mail comes from
   Quire's address and not Supabase's default sender.
7. **Put the values in the app.** Copy the Project URL and the anon key (API
   settings) into `src/cloud/config.js`.

## Checks

- Sign up with a new address, confirm it from the email, and sign in.
- Turn on the passcode lock, then sync. The `entries` table should hold only
  `payload` ciphertext, never titles or text.
- Sign in on a second browser profile. It should ask for the account passcode.
