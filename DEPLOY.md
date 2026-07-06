# Deploying Traitfolio — step by step (zero experience assumed)

You already have: a GitHub repo (`ThiccLiquidity/Misfitz-Platform`), git installed and configured,
and all your code committed. You just need to (A) push it to GitHub, (B) connect Vercel, (C) add your
domain. Follow each step in order. Don't skip.

---

## STEP 1 — Open PowerShell in your project folder

1. Open the folder `C:\Users\DubT1\Claude\Projects\Chia NFT Platform` in File Explorer.
2. Click the address bar at the top, type `powershell`, and press Enter.
3. A blue/black terminal window opens, already pointed at your project. Keep it open for the next steps.

(You can confirm you're in the right place by typing `dir` and pressing Enter — you should see files
like `package.json` and folders like `src`.)

---

## STEP 2 — Push your code to GitHub

In that PowerShell window, type this and press Enter:

```
git push
```

- **If a browser window pops up asking you to sign in to GitHub:** sign in / authorize. That's Git
  connecting to your account. It only happens the first time.
- **If it just prints a few lines and returns to a normal prompt:** it worked. Your code is now on GitHub.
- **If you see "Everything up-to-date":** also fine — it means GitHub already has your latest code.

You can verify by opening https://github.com/ThiccLiquidity/Misfitz-Platform in your browser — you
should see your files and recent commit messages.

---

## STEP 3 — Create a Vercel account (free)

1. Go to https://vercel.com in your browser.
2. Click **Sign Up**.
3. Choose **Continue with GitHub** (this is the easy path — it links Vercel to your repos automatically).
4. Authorize Vercel when GitHub asks. You'll land on the Vercel dashboard.

---

## STEP 4 — Import your project

1. On the Vercel dashboard, click **Add New…** → **Project**.
2. You'll see a list of your GitHub repositories. Find **Misfitz-Platform** and click **Import**.
   - If you don't see it, click **Adjust GitHub App Permissions** / **Configure GitHub App** and give
     Vercel access to that repo, then come back.
3. Vercel auto-detects it's a Next.js app. **Do not change** the Framework Preset, Build Command, or
   Output Directory — the defaults are correct.

**Do not click Deploy yet.** Do Step 5 first (add the environment variable on this same screen).

---

## STEP 5 — Add the one environment variable

On the import screen there's a section called **Environment Variables**. Add one:

- **Name:**  `NEXT_PUBLIC_SITE_URL`
- **Value:** `https://YOURDOMAIN.com`   ← use your real domain, with `https://`, no slash at the end

Click **Add**. (If you haven't set your domain up yet, you can put your future domain here now — it's
just used for share-link previews and the sitemap; it won't block the deploy.)

---

## STEP 6 — Deploy

1. Click **Deploy**.
2. Wait ~1–3 minutes while it builds. You'll see logs scrolling — that's normal.
3. When it finishes you'll see a **Congratulations** screen with a preview and a link like
   `misfitz-platform.vercel.app`. Click it — your site is live on the internet at that address.

At this point you have a working live site. The domain steps below just put it on YOUR domain.

---

## STEP 7 — Add your domain

1. In your Vercel project, click **Settings** (top menu) → **Domains** (left menu).
2. Type your domain (e.g. `yourdomain.com`) in the box and click **Add**.
3. Vercel will show you **DNS records** to add. It's usually one of:
   - An **A record** pointing `@` to an IP address Vercel gives you, and/or
   - A **CNAME record** pointing `www` to `cname.vercel-dns.com`.
   Leave this Vercel page open — you'll copy these values in the next step.

---

## STEP 8 — Point your domain at Vercel (at your registrar)

"Registrar" = wherever you bought the domain (GoDaddy, Namecheap, Google Domains, Cloudflare, etc.).

1. Log in to your registrar in another browser tab.
2. Find the **DNS** / **DNS settings** / **Manage DNS** section for your domain.
3. Add the record(s) **exactly** as Vercel showed you in Step 7:
   - For the A record: Type `A`, Name/Host `@`, Value = the IP Vercel gave.
   - For the CNAME: Type `CNAME`, Name/Host `www`, Value `cname.vercel-dns.com`.
4. Save.
5. Go back to the Vercel Domains page. Within minutes to a couple hours it flips from "Invalid
   Configuration" to a green **Valid**. When it's green, your domain is live (Vercel adds the HTTPS
   lock automatically).

---

## STEP 9 — Verify

1. Open `https://yourdomain.com` — your site should load.
2. Open it on your phone too.
3. Paste your URL into https://www.opengraph.xyz to see how the share card looks when posted.

You're live. 🎉

---

## Pushing future updates (when we change things)

Every time we make changes to the code, you get them live by doing this in PowerShell (in the project
folder):

```
git push
```

Vercel watches your GitHub repo and **auto-deploys** every push — no extra steps. In ~2 minutes the
new version is live on your domain.

---

## Troubleshooting

- **`git push` says "rejected" / "fetch first":** type `git pull --no-edit` then `git push` again.
- **Vercel build fails:** open the failed deployment, copy the red error text, and send it to me.
- **Domain stuck on "Invalid Configuration":** DNS can take a bit to propagate. Double-check the record
  values match Vercel exactly. If it's been over a few hours, send me a screenshot.
- **Site loads but looks unstyled or errors:** hard-refresh (Ctrl+Shift+R). If it persists, send me the
  URL and what you see.
