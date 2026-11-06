# Neon cloud database: setup guide (for beginners)

This turns on **accounts and cloud saving**. Until you finish these steps the website keeps working exactly as before (designs are saved in the browser).

## What you get
- Sign in with your own email and password (Account page).
- Saved designs, assemblies, custom parts and Image-to-3D parts are stored in the Neon database and open on any computer.
- Pictures uploaded on the Image to 3D page are stored with your account.
- The first account that is created becomes the **administrator**. The administrator can store a copy of the catalogue, materials, chain, bearing, key and component tables in the database (Account page).

## Step 1. Create the Neon database
1. Go to https://neon.tech and sign in. Click **Create project** (any name, for example `ultraplast`). Pick the region closest to you.
2. On the project dashboard click **Connect**. Choose the **pooled connection** and copy the connection string. It starts with `postgresql://`. This is your `DATABASE_URL`. Treat it like a password: never paste it into chat, GitHub or the source code.

You do **not** have to create tables. The website creates them the first time it runs. (If you want to see them, the file `db/schema.sql` lists them. It is safe to run in Neon's SQL Editor; it never deletes data.)

## Step 2. Add the settings in Vercel
1. Open your project on https://vercel.com. Go to **Settings > Environment Variables**.
2. Add `DATABASE_URL` = the Neon string from step 1.
3. Add `AUTH_SECRET` = a long random text of at least 32 characters (for example, press random keys for a while, or use a password generator). Do not reuse a password you use elsewhere.
4. Optional: add `SIGNUP_CODE` = a code you will give only to your staff. When it exists, nobody can create an account without it.
5. Tick Production (and Preview if you use it) for each variable and save.

Alternative: in Vercel you can use **Storage > Neon** to connect the database. It adds `DATABASE_URL` for you. You still add `AUTH_SECRET` yourself.

## Step 3. Upload the new code and redeploy
1. Copy the files from the updated ZIP into your project folder (replace files with the same name; keep your own `public/assets/Logo.png`).
2. In the project folder open `cmd` and run:
   ```
   npm install
   git add .
   git commit -m "Add Neon accounts, custom parts, image to 3D"
   git push
   ```
   (`npm install` is needed once because a new package, `@neondatabase/serverless`, was added.)
3. Vercel rebuilds by itself. If you added the environment variables **after** the last deploy, open Vercel > Deployments > the latest one > **Redeploy**, because variables only apply to new deployments.

## Step 4. Create your account and test
1. Open the website, click **Sign in** (top right), choose **Create account**. This first account is the administrator.
2. Open any component, enter values and press **Save design**. Open **Saved designs**: it should be listed. Sign in on another computer: the same design appears.
3. On the Account page, if it shows designs from this browser, press **Copy them to my account**.
4. As administrator press **Store / refresh tables in the database**. In Neon (Tables > `reference_data`) you will see rows named `catalogue`, `materials`, `chains`, `bearings`, `keys`, `components`.

## If something does not work
- Account page says "Working in browser-only mode": `DATABASE_URL` or `AUTH_SECRET` is missing or too short, or the site was not redeployed after adding them.
- "Server error": in Vercel open **Logs** (Functions) and read the red line. Copy the message (without any passwords) and send it to me.
- Running locally with `npm run dev` never uses the cloud (it has no server functions). To test the cloud locally install the Vercel CLI and run `vercel dev`.

## Safety notes
- Passwords are never stored. Only a scrypt hash is kept.
- Each person can read only their own designs. The database address and secret exist only in Vercel.
- Logging out clears the cookie on that computer. A stolen cookie stays valid until it expires (30 days); if you suspect this, change `AUTH_SECRET` in Vercel and redeploy: everyone is signed out.
- There is no "forgot password" email yet. The administrator can reset an account by deleting the user row in Neon so the person can register again (their designs are deleted with the row).
