# 9 Enterprises Command Hub

Full-stack operations dashboard for 9 Enterprises LLC.
Built with Next.js 15 (App Router), Supabase, and Tailwind CSS v4.

---

## Stack

| Layer      | Technology                |
|------------|---------------------------|
| Framework  | Next.js 15 (App Router)   |
| Database   | Supabase (Postgres + Realtime) |
| Auth       | Supabase Auth (Phase 2)   |
| Styles     | Tailwind CSS v4           |
| Hosting    | Vercel                    |
| Language   | TypeScript 5              |

---

## Local Setup

### 1. Install dependencies

```bash
cd command-hub
npm install
```

### 2. Create your Supabase project

1. Go to https://supabase.com and create a new project.
2. In the SQL Editor, run the full contents of `supabase/schema.sql`.
   This creates all five tables and seeds starter data.

### 3. Configure environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and fill in your values:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

Find these in your Supabase project under Settings > API.

### 4. Run the dev server

```bash
npm run dev
```

Open http://localhost:3000. The app redirects to `/mission-control`.

---

## Pages

| Route              | Description                                      |
|--------------------|--------------------------------------------------|
| `/`                | Redirects to `/mission-control`                  |
| `/mission-control` | KPI strip, daily briefing, task list, chat prompt |
| `/companies`       | Portfolio grid with revenue and burn              |
| `/draft-room`      | Kanban board — Idea to Ready to Market            |
| `/roster`          | Org chart — Owner, 9, Front Office, Build Agents  |
| `/log`             | Audit trail of decisions, deploys, and briefings  |

---

## Database Schema

See `supabase/schema.sql` for the full schema with comments.

Tables:
- `companies` — portfolio entities with revenue and burn
- `tasks` — action items with status, priority, due date, owner notes
- `draft_room` — idea pipeline with projected MRR and go/no-go criteria
- `messages` — chat history between Owner and 9
- `daily_briefings` — wins, blockers, and recommended actions

---

## Deploy to Vercel

### One-click (recommended)

1. Push this directory to a GitHub repo.
2. Import the repo at https://vercel.com/new.
3. Set the root directory to `command-hub`.
4. Add environment variables in Vercel dashboard (same as `.env.local`).
5. Deploy.

### CLI

```bash
npm install -g vercel
vercel --cwd /path/to/command-hub
```

Follow the prompts. Set environment variables when asked, or add them later in the Vercel dashboard.

---

## Phased Roadmap

| Phase | Scope                                                                 | ETA    |
|-------|-----------------------------------------------------------------------|--------|
| 1     | Wire checkboxes to Supabase. Task CRUD. 9 webhook alerts on completion. | 72 hrs |
| 2     | Live chat (Supabase Realtime). Real-time KPIs. Draft Room drag-and-drop. | 7 days |
| 3     | Supabase Auth (Owner-only). Risk hub. PDF/CSV export. Notifications.  | 14 days |

---

## Development Notes

- All pages are Server Components by default. Add `"use client"` only when interactivity requires it.
- Types in `lib/types.ts` mirror the Supabase schema exactly — keep them in sync.
- Supabase client helpers are in `lib/supabase/client.ts` (browser) and `lib/supabase/server.ts` (server).
- Dark theme tokens are CSS variables defined in `app/globals.css`. Use those, not hardcoded hex values.
