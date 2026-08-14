# Chrome Web Store submission — USCut Zillow Scraper

Everything needed to publish the extension so users get a real one-click
"Add to Chrome" install instead of the manual sideload flow. Nothing here has
been submitted — Mick cannot create accounts, pay fees, or publish on Dale's
behalf, so this is prep material for Dale to execute when ready.

## What's already done

- Extension is scoped to Zillow only (2026-08-14) — this also happens to help
  with the Chrome Web Store's "single purpose" policy: a listing that says
  "captures Zillow property data into USCut" is a clean, narrow, easy-to-review
  claim. A three-site scraper would have been a harder sell.
- `chrome-extension/manifest.json` — Manifest V3, minimal permissions
  (`activeTab`, `scripting`, `storage` + host permissions for `zillow.com` and
  `localhost:7474`), no remote code execution (everything is bundled at build
  time by `scripts/build-ext.mjs`).
- Icons exist at 16/48/128px (`dist-ext/icons/` after `npm run build:ext`) —
  **these are solid emerald placeholder squares**, functional but not
  polished. Worth a real icon design pass before submitting; a generic solid
  square can read as low-effort in review and in the store listing itself.
  Not a blocker, just flagged.

## 1. Privacy policy

Chrome Web Store requires a hosted, public privacy policy URL for any
extension with host permissions / page-content access — this one qualifies.
Draft below; Dale needs to host it somewhere public (a page on the USCut
site, a GitHub Pages doc, a Gist — any stable URL) and paste that URL into
the Developer Dashboard's listing form.

```markdown
# USCut Zillow Scraper — Privacy Policy

**Last updated:** August 14, 2026

USCut Zillow Scraper is a browser extension that captures property listing
details from Zillow.com into the USCut desktop application, which runs
locally on your own computer.

## What the extension does

When you click "Capture Listing" on a Zillow property page, the extension
reads listing information already displayed on that page — address, price,
bedrooms/bathrooms, square footage, description, photos, and agent contact
info — and sends it to the USCut application running on your own computer
(http://localhost:7474).

## What we collect

Nothing is collected by us. The extension has no analytics, no tracking,
and no remote server of its own.

- **Data read:** only the Zillow listing page you are actively viewing when
  you click Capture.
- **Data sent:** only to `http://localhost:7474` — a server that runs
  locally on your own machine as part of the USCut desktop app. This
  request never leaves your computer.
- **Data NOT collected:** browsing history, other tabs, personal account
  information, cookies, or data from any page other than the Zillow
  listing you capture.

## Permissions used and why

- **activeTab / scripting** — read the listing page's data when you click
  Capture.
- **storage** — remembers minor UI state (extension status) locally in
  your browser only.
- **Host permission for zillow.com** — required to detect listing pages
  and read their data.
- **Host permission for localhost:7474** — required to send the captured
  listing to your own local USCut app. No other network destination is
  ever contacted.

## Data retention

The extension itself stores nothing persistently. Captured listings are
stored by the USCut desktop application in its own local database on your
computer, entirely under your control.

## Contact

[Dale — insert support email or contact page]
```

## 2. Store listing copy

**Category:** Productivity (or "Tools", if Dale prefers — Productivity fits
a workflow utility better than Shopping, which skews consumer-facing).

**Short description** (≤132 characters, shown in search results):

> Capture Zillow listings — address, price, photos, and specs — straight into USCut with one click.

(99 characters — room to spare if Dale wants to add more.)

**Detailed description** (store listing body):

> USCut Zillow Scraper captures property listing data directly from Zillow
> into USCut — the AI-powered video editor and social media suite for real
> estate professionals.
>
> Browse any listing on Zillow, click the green "Capture Listing" button, and
> the address, price, specs, description, photos, and agent info land
> automatically in USCut. From there, turn the listing into a narrated,
> platform-ready video reel for Facebook, Instagram, and TikTok in seconds.
>
> **Requires the USCut desktop app** (uscut.app — or wherever Dale hosts
> download links), running locally on your computer. The extension only
> talks to your own local USCut instance — nothing is sent anywhere else.
>
> Built for real estate agents, teams, and brokerages who want to turn
> listing photos into social content without manual editing.

**Permission justifications** (Chrome Web Store's review form asks for a
short justification per requested permission — use these):

- `activeTab` / `scripting`: "Reads the property listing data already
  displayed on the Zillow page the user is viewing, only when the user
  clicks the extension's Capture button."
- `storage`: "Stores minor local UI state (e.g. whether the companion
  desktop app is currently reachable) — nothing leaves the browser."
- Host permission `https://www.zillow.com/*`: "Required to detect Zillow
  listing pages and read their publicly displayed data on user action."
- Host permission `http://localhost:7474/*`: "Sends captured listing data
  only to the user's own local USCut desktop application running on their
  own machine — never a remote server."

## 3. Screenshots

Chrome Web Store requires at least one screenshot (1280×800 or 640×400).
This needs the extension actually running against a real Zillow page and
USCut open — Mick can't safely drive Dale's real Chrome browser and real
desktop to capture these without Dale present and watching, so this is a
manual step: open a real Zillow listing with the extension loaded, screenshot
the "Capture Listing" button in context, and the listing landing in USCut's
Zillow Scraper page.

## 4. Submission checklist (Dale executes)

1. Create a Google Developer account at
   https://chrome.google.com/webstore/devconsole — one-time $5 fee, tied to
   Dale's own Google account and payment method. Mick cannot do this step.
2. Host the privacy policy above at a public URL.
3. Run `npm run build:ext`, then zip the contents of `dist-ext/` (the folder
   contents, not the folder itself, at the zip root).
4. In the Developer Dashboard: New Item → upload the zip.
5. Fill in: short description, detailed description, category, screenshots,
   privacy policy URL, permission justifications (all drafted above).
6. Submit for review. Google's review typically takes a few days for a new
   item; future updates go through review again too, so build in that lag
   when planning any change that needs to reach users fast.
7. Once approved and live, the Web Store listing URL is what an in-app
   "Add to Chrome" button (or link) should point to — replacing the current
   guided-sideload flow for anyone who isn't Dale doing local dev testing.

## Not done, and why

- No account created, nothing submitted, no payment made — all require
  Dale's own identity and are his call on timing.
- Icons are placeholder-quality; recommend a real design pass before the
  public listing goes live, since this is the first thing users judging
  trustworthiness will see.
- Screenshots need to be captured by Dale (or with Dale actively driving/
  watching a session) against his real Chrome + real USCut, not automated.
