# Justapedia Bot Suite & ArchiveBot 🤖🛡️

A modern, high-performance automated bot management platform and link rot guardian built with **React 19**, **TypeScript**, **Next.js 15**, and **Tailwind CSS**, designed exclusively for **[Justapedia](https://justapedia.org)** (MediaWiki 1.45.3+).

Zero local database dependencies required — connects directly to the live Justapedia API (`https://justapedia.org/api.php`) and Internet Archive Wayback Machine. Ready for **1-click deployment on [Vercel](https://vercel.com)**.

---

## ✨ Core Features

### 1. 👤 User Authentication & Direct Contribution Attribution
- **Authenticated Contributions**: Logged-in users contribute edits under their own Justapedia accounts.
- **Contribution History**: All edits appear immediately on `https://justapedia.org/Special:Contributions/<username>`.
- **Zero Fallback Bot Edits**: When a user is logged in, the system **never** makes edits under a separate bot account.
- **MediaWiki Token Flow**: Directly authenticates via MediaWiki Action API login tokens and issues stateless secure JWT sessions compatible with Vercel serverless edge.
- **Strict Identity Verification**: Before every save, MediaWiki explicitly verifies user cookies via `action=query&meta=userinfo`.

### 2. ⚡ High-Speed Editing Engine (100 Edits/Minute)
- **High-Speed Burst Rate**: Makes up to **100 edits per minute** (~600ms per edit).
- **Automated Cycle Cooldown**: After 100 edits, the bot initiates a **mandatory 1-minute (60 seconds) pause** to respect MediaWiki API rate limits and prevent server throttling.
- **Continuous Auto-Resume**: Once the 60-second cooldown finishes, the bot automatically resumes the next burst cycle without requiring manual intervention.

### 3. 💾 Consistent Saving Mechanism (Birth Update Bot Compatible)
- Replicates the exact saving mechanism of the Birth Update Bot (`justapedia_client.py`):
  1. Verifies user session cookies with `action=query&meta=userinfo`.
  2. Fetches user-authenticated CSRF tokens with `action=query&meta=tokens&type=csrf`.
  3. POSTs edits to `https://justapedia.org/api.php` with `minor=1`, `bot=1`, and user attribution.
  4. Returns new revision ID (`revid`), direct diff URL, and links to the user's `Special:Contributions`.

### 4. 🎛️ Multiple Bot Management & Sequential Layout
- Clean sequential interface to manage multiple bots independently:
  1. **1. InternetBot**: Link rot detection, Wayback Machine snapshot recovery, and `{{webarchive}}` patching.
  2. **2. Birth Update Bot**: Biographical facts, birth and death date validation in `{{Infobox person}}`, and category synchronizing.
  3. **3. Citation & Source Verifier Bot**: Standardizes bare URLs into structured `{{cite web}}` templates.
  4. **4. Category & Maintenance Bot**: Resolves double redirects, tags stubs, and organizes categories.
- Independent **Start/Stop controls** and **ON / OFF / PAUSED** status monitoring per bot.
- **Scalable Architecture**: Easily register new numbered bots in `src/lib/bot-registry.ts`.

### 5. 💻 Live Terminal for Every Bot
- Each bot has its own dedicated interactive live terminal console.
- Displays real-time activities:
  - Article edits and processing queues
  - Processing status and latency
  - `[SAVED SUCCESS]` logs with clickable revision diff links
  - `[CYCLE COOLDOWN]` countdown timers
  - Error logs and authentication status
- Features auto-scroll, log level filtering (`All`, `Edits`, `Success`, `Error`, `Auth`, `Cycle`), and one-click log export to `.txt`.

---

## 🚀 Quick Start (Local Development)

### Prerequisites

- **Node.js**: v18.18+ or v20+ (tested on Node v24)
- **npm** or **pnpm**

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/justapedia/archivebot.git
   cd archivebot
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the local development server:**
   ```bash
   npm run dev
   ```

4. Open your browser to **`http://localhost:3000`**.

---

## ⚡ Deployment to Vercel

This repository is optimized for zero-config serverless deployment on Vercel:

### Option 1: Vercel CLI

```bash
npm install -g vercel
vercel
```

Follow the prompts. Vercel automatically detects Next.js, compiles TypeScript, and provisions serverless API routes.

### Option 2: GitHub / Vercel Dashboard

1. Push your repository to GitHub.
2. In the [Vercel Dashboard](https://vercel.com/new), import your `archivebot` repository.
3. Keep the default settings (Framework: Next.js).
4. Click **Deploy**.

---

## 📁 Project Architecture

```
archivebot/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   ├── login/route.ts      # Action API login & token retrieval
│   │   │   │   ├── logout/route.ts     # Session termination
│   │   │   │   └── me/route.ts         # Live Justapedia profile & identity check
│   │   │   ├── bot/
│   │   │   │   └── save-edit/route.ts  # Consistent saving engine (Birth Update Bot compatible)
│   │   │   ├── analyze/route.ts        # Wikitext parser & citation checker
│   │   │   ├── check-url/route.ts      # Live URL rot & Wayback checker
│   │   │   ├── save-archive/route.ts   # Wayback Save Page Now
│   │   │   └── search/route.ts         # Justapedia prefix & title search
│   │   ├── analyzer/page.tsx           # Single Page Citation Analyzer
│   │   ├── domains/page.tsx            # Domain rules & paywalls
│   │   ├── inspector/page.tsx          # Real-time URL rot inspector
│   │   ├── settings/page.tsx           # Global preferences
│   │   ├── layout.tsx                  # Root layout with AuthProvider & AuthModal
│   │   └── page.tsx                    # Numbered Bot Dashboard & cycle monitor
│   ├── components/
│   │   ├── AuthModal.tsx               # Justapedia user login & contribution dialog
│   │   ├── DiffViewer.tsx              # Wikitext diff viewer with direct save
│   │   ├── Footer.tsx                  # Clean minimal footer
│   │   ├── LiveTerminal.tsx            # Per-bot live activity terminal console
│   │   ├── Navbar.tsx                  # Navigation & live user attribution badge
│   │   └── ScanProgress.tsx            # Multi-step progress animation
│   ├── context/
│   │   └── AuthContext.tsx             # User session & contribution state
│   └── lib/
│       ├── auth.ts                     # MediaWiki login token & cookie handling
│       ├── bot-registry.ts             # Numbered bot definitions & cycle states
│       ├── justapedia.ts               # Direct Action API client
│       ├── link-checker.ts             # Dead link rot detection
│       ├── parser.ts                   # Wikitext citation regex engine
│       ├── save-engine.ts              # Consistent save mechanism
│       ├── types.ts                    # Complete TypeScript definitions
│       └── wayback.ts                  # Internet Archive Wayback Machine integration
├── vercel.json                         # Vercel deployment configuration
├── package.json
└── tsconfig.json
```

---

## 🔒 Security & Contribution Privacy

- Passwords and bot tokens are **never stored in any persistent local database**.
- Sessions are securely signed with HMAC SHA-256 JWTs stored in client memory and verified against live MediaWiki cookies.
- All edits directly reflect the logged-in user's identity on Justapedia.

---

## 📜 License

Licensed under the [GNU General Public License v3.0](LICENSE). Built for the Justapedia Open Knowledge community.
