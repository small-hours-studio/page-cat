# Setting up the Ko-fi page

Files are in `store/kofi/`. Text is ready to paste; edit freely.

## 1. Account and page
1. Sign up at <https://ko-fi.com> with the email alias you use for Small Hours Studio, not your personal Gmail.
2. **Page name:** `Small Hours Studio`
3. **Username / page link:** something like `smallhoursstudio` (your page becomes `ko-fi.com/smallhoursstudio`). Check it's free.
4. **Profile picture:** `avatar.png`
5. **Cover image / header:** `banner.png` (3:1). If Ko-fi crops it, keep the cats in view.
6. **Theme color:** `#C46D17` (the Page Cat orange).

**About / bio:**

> I make Page Cat, a Chrome extension that puts a little cat on the websites you visit. Send me a photo of your cat and I'll make a Page Cat that looks like them.

## 2. Getting paid (keep your name private)
- Connect **Stripe** and/or **PayPal** under Settings → Payments.
- A **personal** PayPal account shows your legal name to buyers on their receipt. To stay anonymous, use a PayPal **business** account named Small Hours Studio, or use Stripe only and set its public business name and statement descriptor to `SMALL HOURS STUDIO`.
- Ko-fi's free plan takes a small cut of commission sales (about 5%) on top of Stripe or PayPal's fee. Check the current rates on Ko-fi's pricing page.

## 3. Commissions
Turn on **Commissions** in your Ko-fi settings, then make three listings. Use `commission.png` as the image on all three.

| Title | Price | Slots |
| --- | --- | --- |
| Custom Page Cat: one cat | $3 | 10 |
| Custom Page Cat: two cats | $4 | 10 |
| Custom Page Cat: three cats | $5 | 10 |

Slots cap how many open orders you can have; raise them once you know how long orders take.

**Description (same for all three, change the count):**

> A Page Cat that looks like your cat, with their coat, markings and eye color.
>
> After you order, send me:
> - A clear photo of each cat from the side
> - A photo of the face if they have markings there
> - Each cat's name
>
> I'll send you a cat code within 3 days. Open Page Cat from your toolbar, paste the code under "Your cats", and press Import. One round of changes is included, and if I can't get it right you get your money back.
>
> I only use your photos to make your cat and delete them once you have your code.
>
> You need the free Page Cat extension for Chrome: https://tsassypants.github.io/page-cat/

If Ko-fi lets buyers attach files to a commission request, ask for the photos there. If it doesn't, add: "Reply to your order confirmation with the photos."

## 4. Hook it up
Send me your Ko-fi link. I'll put it in `docs/custom.html` (the `KOFI` line near the bottom), which turns the "Orders open soon" buttons into "Order your cat". The button in the extension goes to that page, so the Ko-fi link can change later without an extension update.

## 5. Handling an order
1. Save the photos somewhere private (not the repo).
2. Ask Claude: "Make a cat code for Mittens" with the photos.
3. Paste the `PC1.` code to the buyer on Ko-fi and mark the commission complete.
4. Delete the photos.
