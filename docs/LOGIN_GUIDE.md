# How to sign in (simple guide)

## 1. The very first time (you, the owner)
1. Open your website. You will see only the **sign-in page**.
2. Press **Request access** (top right tab).
3. Enter your name, your email and a password (at least 8 characters). Press **Request access**.
4. Because you are the first person, you become the **administrator** and are approved automatically. You are signed in at once.
5. A **Settings** tab now appears in the top menu. Only you (and other administrators) can see it.

## 2. A new person who wants access
1. They open the website, press **Request access**, and enter name, email and password.
2. They see "Access request sent". They cannot enter yet.
3. **You** open **Settings > Users**. Their row says "Waiting for approval". Press **Approve** (or **Reject** to remove the request).
4. They go back to the website and press **Sign in** with the same email and password.

## 3. Signing in every day
Open the website, type email and password, press **Sign in**. If email codes are switched on, a 6-digit code is emailed to you: type it and press **Verify and continue**. Codes last 10 minutes and work once. Press "Send a new code" if it does not arrive (check the spam folder).

## 4. Switch on email codes (optional, administrator)
Settings > Email > "Use Gmail settings" > your Gmail address + a Google **app password** (Google Account > Security > 2-Step Verification > App passwords) > Save > **Send test** > when the test email arrives, tick "Send email codes" > Save.

## 5. Forgot password
Sign-in page > **Forgot password?** > enter your email > type the code that is emailed > choose a new password. (Needs email codes to be switched on. If not, the administrator sets a new password in Settings > Users > Set password.)

## 6. Problems
- "Waiting for approval": the administrator has not approved you yet.
- "Wrong email or password": after 8 wrong tries you must wait 15 minutes.
- No code email: check spam; ask the administrator to press Send test in Settings > Email.
- Locked out because email broke: see docs/LIMITATIONS.md (SQL line to switch email off in Neon).
