# USCut — getting started

USCut is a Windows video editor with an AI production studio and a Zillow
listing → social-reel pipeline. Everything core runs on your PC; AI features are
optional and you bring your own provider.

## 1. Install

Run `USCut-0.1.0.exe`. It installs per-user (no admin), adds a desktop and
Start-menu shortcut, and updates itself from GitHub releases. Uninstalling keeps
your projects and settings.

## 2. First launch

- **New Project** opens the editor. Import video/images, cut on the timeline,
  export from the toolbar (renders in the background — keep working).
- Your work autosaves. **Home → Recent projects** lists everything;
  **Back up** makes a single `.uscut.zip` with all media, **Restore from backup**
  brings one back on any machine.

## 3. Connect an AI provider (optional)

**Settings → AI Providers.** Any one of:

| Option | Cost | Notes |
|---|---|---|
| Sign in with ChatGPT | your ChatGPT plan | no API key; uses the Codex backend |
| OpenRouter | pay-as-you-go | browser sign-in, no key to paste |
| Ollama | free | fully local; point USCut at your Ollama URL |
| API key (Claude / OpenAI / Groq) | pay-as-you-go | paste a key; stored encrypted on this PC |

A **vision-capable** provider (Claude or OpenAI) also unlocks frame-grounded
storyboards and subject-tracked auto-clipping.

## 4. Transcription for Auto-Edit / captions

Works with no setup — USCut ships a local Whisper engine. For faster/higher
quality, add an OpenAI API key (Settings → AI Providers) and it uses the Whisper
API instead.

## 5. Production Studio

**Studio** turns a brief + your footage into an editable project: it writes a
storyboard (grounded in what the AI sees in your clips when a vision provider is
connected), optionally adds a music bed and local narration, and builds separate
visual / headline / narration / music tracks you finish in the editor. Save it as
a **production** to keep a version history.

## 6. Listings → reels

1. **Settings → Zillow Scraper**: Build the extension, load `dist-ext/` unpacked
   in Chrome.
2. Open a Zillow listing, clear its press-and-hold check, click **Capture**.
3. In USCut: pick and reorder photos, choose a template, **Create Reel**.
4. **Post Now** opens Publish with the reel attached — sign in to Facebook /
   Instagram / TikTok inside USCut and click the final **Post** yourself.

Listing copy is checked against Fair Housing and RESPA rules; blocked text is
marked "do not publish".

## 7. Subscription

**Settings → Subscription.** Paste the licence key emailed after you subscribe.
It is verified on your PC and keeps working briefly offline while USCut
re-checks it.

## Support

- Diagnostics / logs: `%APPDATA%\aicuts\logs\`
- Config: `%APPDATA%\aicuts\config.json`
- Support: _<add support email before release>_
