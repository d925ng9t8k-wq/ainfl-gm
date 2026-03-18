#!/bin/bash
# Run this script to open pre-written tweets in Safari
# Just click "Post" on each one!

TWEETS=(
"Can you build a better offseason than your team's GM? 🏈🤖

AiNFL GM lets you manage ANY NFL team's salary cap, sign free agents, make trades, and run a full mock draft.

Try it free — no signup required
ainflgm.com"

"Lions fans — can you fix this roster? 🦁

\$27M cap space. No RB1 after trading Montgomery. 7 draft picks.

Build Detroit's offseason 👇
ainflgm.com/detroitlions"

"The AI just told me to draft a CB in Round 1 and trade my overpaid DT 🤖

AiNFL GM has AI-powered roster recommendations on every page

ainflgm.com"

"Raiders fans — who should go #1 overall? 🏴‍☠️

Run the mock draft simulator and find out. 224 real 2026 prospects, trade up/down mid-draft.

ainflgm.com/raiders"
)

for tweet in "${TWEETS[@]}"; do
  ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$tweet'''))")
  open "https://x.com/intent/tweet?text=$ENCODED"
  echo "Tweet composer opened. Click Post, then press Enter here for the next one."
  read
done

echo "All tweets queued!"
