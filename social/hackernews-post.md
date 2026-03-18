# Hacker News Submission

## Title
Show HN: AiNFL GM -- Free AI-powered NFL offseason simulator

## URL
https://ainflgm.com

## Comment Text

I built a browser-based NFL general manager simulator that uses real salary cap data and AI-driven evaluations. You can manage any of the 32 NFL teams through a full offseason: cut/restructure players, sign free agents, make trades, run the draft, then simulate a 17-game season.

**Technical details:**
- React SPA with client-side routing (Vite + React Router)
- All game logic runs in the browser -- no backend server needed
- Real financial data scraped from Over The Cap (salary caps, dead money, contract structures)
- Roster data from ESPN
- AI player evaluations and market valuations generated via custom scoring models
- PWA-enabled for mobile use
- Hosted on GitHub Pages with custom domain

**What makes it different from other NFL simulators:**
- Uses actual 2026 salary cap numbers, not made-up values
- Dead money calculations are accurate -- you can't just cut a player without consequences
- The free agent market uses AI to generate realistic contract demands based on age, position, and performance
- Trade values factor in draft pick compensation, positional need, and contract implications
- No account needed, no paywall, no ads -- just pick a team and go

The entire app is ~2MB and loads instantly. I'd love feedback on the AI evaluation models and any UX improvements. The codebase is a single-page React app, so everything from cap math to draft logic lives on the client.

Try it: https://ainflgm.com
