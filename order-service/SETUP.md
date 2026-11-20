# Setting up custom cat orders

How it fits together:

1. **Order page** (`docs/order.html` on GitHub Pages): the customer picks 1-3 cats, adds photos and their email.
2. **Order service** (this folder, a Cloudflare Worker): stores the photos, opens a Stripe Checkout, and when Stripe says it's paid, starts one job per cat.
3. **Cat job** (GitHub Actions in a private repo): runs `page-cat/tools/catmaker/run_job.py`, which asks Claude Opus to design the cat from the photos (`make_cat.py`) and sends the design back.
4. **Making page** (`docs/making.html`): where the customer lands after paying, while the cats are made.
5. **Your cat page** (`docs/status.html`): each cat next to the customer's photos, with its code (signed as soon as it's made). The customer can ask for up to 2 changes; each makes a new version with a new code. "Report a problem" opens a ticket.
6. **Admin page** (`docs/admin.html`, password-protected): every order, buyer, photo, version, code and ticket. Remake a cat with a note, paste in a hand-fixed design, give extra changes, close tickets. `page-cat/tools/admin.py` does the same from the terminal.

Records: orders are kept for good in KV. Photos are deleted 30 days after upload by a daily cron in the Worker.

Costs: Cloudflare and GitHub free tiers cover this. Claude is about 15¢ per cat (estimate; each change is another call). Stripe takes about 2.9% + 30¢ per payment.

Do everything in **test mode** first; switch to live keys at the end.

## 1. Anthropic API key
1. Go to <https://console.anthropic.com>, sign in, add a payment method and a small credit (for example $10).
2. Settings → API keys → Create key. Name it `page-cat-orders`. Keep it for step 4.
3. Optional: set a monthly spend limit so a bug can't run up a bill.

## 2. Stripe
1. Create a Stripe account (public business name: Small Hours Studio; statement descriptor: `SMALL HOURS STUDIO`).
2. Stay in **test mode**. Developers → API keys: copy the **Secret key** (`sk_test_...`).
3. Settings → Customer emails: turn on **Successful payments**, so buyers get a receipt.

## 3. Cloudflare
From this folder (`order-service`):
```powershell
npx -y wrangler@4.156.0 login
```
```powershell
npx -y wrangler@4.156.0 kv namespace create ORDERS
```
Put the `id` it prints into `wrangler.toml` (`REPLACE_WITH_KV_ID`).

R2 (photo storage) has to be turned on once in the Cloudflare dashboard (R2 → Get started; it may ask for a card even on the free tier). Then:
```powershell
npx -y wrangler@4.156.0 r2 bucket create page-cat-photos
```
In the dashboard, open the bucket → Settings → Object lifecycle rules → add a rule deleting objects after 31 days. That's a backstop; the Worker's daily cron deletes photos after 30 days.

## 4. Private GitHub repo for the cat jobs
Customer photos must never show up in a public repo's logs, so the job runs in a private repo.
1. Create a private repo `small-hours-studio/page-cat-orders` and add `private-repo/.github/workflows/make-cat.yml` from this folder at the same path.
2. In that repo's Settings → Secrets and variables → Actions:
   - Secret `ANTHROPIC_API_KEY`: the key from step 1.
   - Secret `JOB_SECRET`: a long random string (make one with `node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"`). The Worker gets the same value in step 5.
   - Variable `WORKER_URL`: the Worker's address from step 5.
3. Create a fine-grained token (GitHub → Settings → Developer settings → Fine-grained tokens): only the `page-cat-orders` repo, permission **Actions: Read and write**. Keep it for step 5.

## 5. Deploy the order service
```powershell
npx -y wrangler@4.156.0 deploy
```
It prints the address, like `https://page-cat-orders.<you>.workers.dev`. Then add the secrets (each command asks you to paste the value):
```powershell
npx -y wrangler@4.156.0 secret put STRIPE_SECRET_KEY
```
```powershell
npx -y wrangler@4.156.0 secret put GITHUB_TOKEN
```
```powershell
npx -y wrangler@4.156.0 secret put JOB_SECRET
```
The admin page password. Pick a long one (at least 12 characters) and keep it in your password manager:
```powershell
npx -y wrangler@4.156.0 secret put ADMIN_PASSWORD
```
For `tools/admin.py`, also save it in the file `.pagecat/admin-password` in your user folder (outside the repo).

The signing key is a file, so pipe it in:
```powershell
Get-Content "$HOME\.pagecat\signing-key.pem" -Raw | npx -y wrangler@4.156.0 secret put CAT_SIGNING_KEY
```

## 6. Stripe webhook
Stripe → Developers → Webhooks → Add endpoint:
- URL: `https://page-cat-orders.<you>.workers.dev/api/stripe/webhook`
- Events: `checkout.session.completed` and `checkout.session.expired`

Copy its **Signing secret** (`whsec_...`) and:
```powershell
npx -y wrangler@4.156.0 secret put STRIPE_WEBHOOK_SECRET
```

## 7. Point the site at the service
In `docs/config.js`, set `ORDER_API` to the Worker's address. Leave `ORDERS_OPEN` false for now. Commit and push.

## 8. Test order
Open `https://small-hours-studio.github.io/page-cat/order.html`, order one cat with a real photo, and pay with Stripe's test card `4242 4242 4242 4242` (any future date, any CVC). You should land on the making page, and within a few minutes see your cat. Try a change and a ticket, paste the code into Page Cat, and open `admin.html` to see the order.

If a cat says it hit a snag, the job's log is in the private repo's Actions tab.

## 9. Email (optional, needs a domain)
Without email, customers get the status link when they pay and Stripe's receipt. To also email the cat code: buy a domain (Cloudflare Registrar sells them at cost), add it to Resend (<https://resend.com>, free for 3,000 emails a month), then:
- `secret put RESEND_API_KEY`
- in `wrangler.toml`: `EMAIL_FROM = "Small Hours Studio <cats@your-domain>"` and `OWNER_EMAIL` (where failed jobs are reported), then deploy again.

## 10. Go live
1. Stripe: switch to live mode, copy the live secret key, add the same webhook in live mode, and update `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
2. `docs/config.js`: set `ORDERS_OPEN = true`. Commit and push. The custom cats page now links to the order form.

## Testing locally
`test/e2e.py` runs a whole order (two cats, payment, a change, approval, code check, photo deletion) against `wrangler dev` with Stripe and the cat job stood in, so it needs no keys. See the comment at the top of the file.
