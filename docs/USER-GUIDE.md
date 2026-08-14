# AICut — User Onboarding Guide

Welcome to AICut: your AI video editor and social media automation studio in one desktop
app. Everything runs on **your** machine — your videos never upload to a cloud editor, and
there's no subscription or watermark.

This guide takes you from zero to your first published post in about 20 minutes.

---

## Step 1 — Launch AICut

Double-click the **AICut** desktop shortcut (or run `AICut.exe`). You'll land on the Home
screen with two halves:

- **What you can do** — the video editor (timeline, AI auto-edit, captions, export).
- **Social Hub** — publishing, scheduling, scrapers, analytics, and your brand tools.

> First time? Click **"First time? Setup guide →"** at the top of the Social Hub section.

## Step 2 — Connect your AI (5 min, optional but recommended)

AICut's AI features (post writing, carousels, listing ads, clip picking) use an AI
provider **you** control. Open the setup guide (or Social Hub → Onboarding) and pick one:

| Option | Cost | Setup |
|---|---|---|
| **OpenRouter** (recommended) | pay-per-use, no monthly fee | Click Sign In — browser login, no key to copy |
| **Ollama** | free, runs locally | Install Ollama, AICut auto-detects it |
| OpenAI / Anthropic key | pay-per-use | Paste your API key |

**No AI configured?** That's fine — capture, reels, template ads, scheduling, best-times,
and auto-clip (with a pasted transcript) all still work.

## Step 3 — Set your Brand Kit (2 min)

Social Hub → **Brand**. Fill in:

1. **Voice & tone** — e.g. "confident, warm, no hype"
2. **Target audience** — e.g. "first-time homebuyers in Houston"
3. **Preferred hashtags** — always suggested on your posts
4. **Banned words** — the AI will never use them
5. **Signature/CTA** — e.g. "DM 'HOME' for a free consult"

Click **Save Brand Kit**. From now on, *every* AI generation follows these rules
automatically — posts, carousels, and listing ads.

## Step 4 — Connect your social accounts (2 min per platform)

Social Hub → **Publish** → account picker, or the **Accounts** button in the editor.

- **Easy way (webview login):** click **Sign In** on a platform — a real login window for
  Facebook/Instagram/X/etc. opens. Log in like you normally would. Done — AICut can now
  post through your session.
- **Advanced way (API):** expand the "API" section for a guided walkthrough of registering
  a developer app per platform (needed only for scheduled auto-posting, analytics capture,
  and the inbox).

## Step 5 — Install the Listing Scraper extension (3 min, real-estate users)

1. In a terminal: `npm run build:ext` (already done on most installs — look for the
   `dist-ext` folder in the AICut folder).
2. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   select the `dist-ext` folder.
3. Browse any listing on **Zillow**. A green **Capture Listing**
   button appears — click it while USCut is running.
4. The listing (photos, price, specs, agent info) appears in Social Hub → **Listings**.

> No extension? Paste the listing URL into the **Capture URL** box on the Listings page —
> works on most listing pages.

Every captured listing is automatically checked against **Fair Housing Act and RESPA**
rules — a red shield means the description contains language you should not advertise.

## Step 6 — Your first listing campaign (the magic 3 clicks)

On the **Listings** page, each captured listing has two buttons:

1. **Generate Ad** — platform-ready ad copy for Facebook, Instagram, and LinkedIn, each
   compliance-checked (green shield = safe to post; red = blocked, with the reason).
   Click **Copy** to grab any variant.
2. **Create Reel** — builds a vertical video from the listing photos: cinematic motion,
   price banner, closing call-to-action card, and **spoken narration** (generated on your
   PC — no key needed). The finished MP4 path appears under the listing; find your reels
   in `%APPDATA%\aicuts\listing-reels`.

## Step 7 — Find something to post about (Idea Scraper)

Social Hub → **Research**:

- **Trending tab** — live trending topics for your niche with relevance scores.
- **Idea Scraper tab** — type a keyword ("mortgage rates", "spring market") and pull live
  news headlines to react to.

Then click over to **Generate** and turn an idea into posts:

- Pick platforms, set a tone.
- Choose **Posts** with 1–3 **A/B variants** (each takes a different angle), or
  **Carousel** to get a hook → value → CTA slide deck with a caption.

## Step 8 — Schedule like a pro

Social Hub → **Schedule**:

1. Pick accounts, write (or paste) your post.
2. Under the date picker, click a **Best times** chip — AICut computes your top posting
   slots from your own results (until it has data, it uses proven engagement peaks).
3. **Calendar** at the bottom shows your whole queue by month.
4. Power tools:
   - **Recycle top posts** — re-queues your best performers at upcoming best-time slots.
   - **Import CSV** — bulk-schedule weeks of content (`datetime, body, hashtags` columns).

## Step 9 — Repurpose long video into shorts (Auto-Clip)

In the **editor**, import a long video (webinar, property tour, podcast), open the **AI**
panel → **Auto-Clip**:

- Paste a transcript (SRT/VTT) if you have one, or leave it empty if you've set an OpenAI
  key (Whisper transcribes automatically).
- Click **Find & Cut Clips** — AICut finds the strongest moments and cuts vertical
  1080x1920 clips with captions burned in, added straight to your media library.

## Step 10 — Track, benchmark, respond

- **Analytics** — capture metric snapshots per post; totals for reach/impressions/
  engagements/clicks. Track **competitors** at the bottom: log their follower counts
  periodically and watch the growth deltas.
- **Inbox** — comments on your posts arrive with AI-drafted replies; edit, approve, or
  dismiss. (Requires platform API connection.)
- **Brand → Link-in-Bio Page** — generate a polished one-page site with your links and
  featured listings; host the exported HTML file anywhere (GitHub Pages is free) and put
  the URL in every profile.

---

## Cheat sheet: what needs what

| Feature | Works with zero setup | Needs AI provider | Needs platform API app |
|---|---|---|---|
| Video editing + export | ✅ | | |
| Listing capture (ext/URL) + compliance check | ✅ | | |
| Listing reel with narration | ✅ | | |
| Template listing ads | ✅ | | |
| Best times / calendar / recycle / CSV | ✅ | | |
| Bio page, competitors, brand kit | ✅ | | |
| Auto-clip (pasted transcript) | ✅ | better with | |
| AI posts / variants / carousels / AI listing ads | | ✅ | |
| Whisper auto-transcription, AI images | | OpenAI key | |
| Scheduled auto-posting, analytics capture, Inbox | | | ✅ |

## Troubleshooting

- **"API not ready"** — the embedded server starts a few seconds after launch; refresh.
- **Capture button doesn't appear on Zillow** — make sure AICut is running and the
  extension is loaded; refresh the listing page.
- **Reel has no voice** — narration uses Windows text-to-speech (Windows only); check
  that audio output works, or regenerate.
- **"No AI provider configured"** — Step 2 above; or use the template/keyless paths.
- **Database errors after an update** — close AICut fully (system tray too) and relaunch.
