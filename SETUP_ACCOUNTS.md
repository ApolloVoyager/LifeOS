# LifeOS — Accounts setup (do this once, after deploy)

This adds login to LifeOS. Each approved account gets its **own private** LifeOS.
All existing data is migrated to a single **master account** (you). New people can sign
up, but they can't see anything until **you approve them** in the Supabase dashboard —
no admin login lives inside the app.
Everything below happens in your Supabase project dashboard + SQL Editor. All on the free tier.

## Order matters (so you don't lock yourself out)

1. **Run STEP 1** of [`supabase-accounts-setup.sql`](supabase-accounts-setup.sql) in the SQL Editor.
   (Creates `profiles`, the signup trigger, the `is_approved()` helper, and adds the nullable
   `user_id` column. RLS is still off, so the site keeps working.)

2. **Create your master account.** Dashboard → **Authentication → Users → Add user**.
   Enter the **email + password you want** (these are *your* credentials). Then copy its
   **User UID**.

3. **Disable email confirmation.** Dashboard → **Authentication → Providers → Email** →
   turn **"Confirm email" OFF**, and make sure **Email** sign-ups are **enabled**.
   (Avoids the free-tier email limits; approval is manual anyway.)

4. **Run STEP 3** of the SQL file — first replace every `MASTER_UUID` with the UID from step 2.
   This assigns all your existing data to your account, marks you approved, and locks the table
   to a `(user_id, key)` primary key.

5. **Run STEP 4** of the SQL file — enables Row Level Security + policies. From here on, every
   account can only read/write its own rows.

6. **Deploy the code** (push to GitHub → Vercel). The new files are `auth.js`, `login.html`,
   and the updated `sync.js` / `topbar.js` / `gym.html`.

7. **Verify:** open the site in a fresh browser → you're sent to the login page → log in with
   your master credentials → all your old data is there.

## Approving someone later

Dashboard → **Table Editor → `profiles`** → find their row → set **`approved` = true**.
That's it — outside the app, no master login. They'll have access on their next page load.

To reject/remove someone: delete their row in **Authentication → Users** (cascades to their data).

## Notes

- **Stay logged in:** sessions persist in the browser and auto-refresh, so each device only
  logs in once and stays logged in indefinitely (until they sign out or clear browser storage).
- **Password resets:** no reset emails are configured. If someone's locked out, reset their
  password in **Authentication → Users**.
- **Free tier:** auth, RLS, realtime, and storage are all included. No billing change.
- **Progress photos** are stored under a per-user folder in the public `progress-photos`
  bucket. To make them fully private later, switch the bucket to private, uncomment the storage
  policies in the SQL file, and the app will need to use signed URLs (small follow-up).
