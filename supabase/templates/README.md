# Quire email templates

Paste each file into Supabase: **Authentication → Email Templates**.

| Template in Supabase | File here |
| --- | --- |
| Confirm signup | `confirm-signup.html` |
| Magic link | `magic-link.html` |
| Reset password | `reset-password.html` |

Each template uses the Supabase variables `{{ .ConfirmationURL }}` and
`{{ .Email }}`. Keep those exact tokens when editing.

Sender: set up custom SMTP under **Project Settings → Auth → SMTP Settings**
(for example Resend, on a domain you own) so mail comes from Quire's own
address instead of Supabase's default sender.
