import { readFileSync, writeFileSync } from 'fs';

const CONTENT_PATH = new URL('../social/content.json', import.meta.url);

// Tweet templates organized by category
const TEMPLATES = {
  teamScenarios: [
    `The {team} have {cap} in cap space and pick #{pick} in the draft.\n\nHow do you build this roster? Try it free at ainflgm.com`,
    `{team} fans — your team has {cap} in cap space.\n\nDo you go all-in on free agency or save for the draft?\n\nRun the scenario: ainflgm.com`,
    `If you were the {team} GM, what's your first move?\n\nSign a big-name free agent? Trade up in the draft? Cut dead weight?\n\nMake the call: ainflgm.com`,
    `The {team} need help at multiple positions. With {cap} in cap space, how do you prioritize?\n\nBuild your plan: ainflgm.com`,
    `Can the {team} compete next year? You have {cap} and pick #{pick} to work with.\n\nProve it: ainflgm.com`,
  ],
  featureHighlights: [
    `AiNFL GM features you might not know about:\n\n- Full 7-round mock draft\n- Real salary cap numbers\n- AI-powered roster suggestions\n- Trade engine for picks & players\n\nAll free. No signup.\n\nainflgm.com`,
    `Want to see how your team's draft could play out?\n\nAiNFL GM runs a full 7-round mock draft with AI opponents making realistic picks.\n\nainflgm.com/draft`,
    `The salary cap simulator in AiNFL GM does all the math for you.\n\nCut players, restructure deals, and see your cap space update instantly.\n\nainflgm.com/cap`,
    `AiNFL GM's trade engine lets you swap picks and players between any two teams.\n\nTrade up for your guy. Trade down for extra picks. Your call.\n\nainflgm.com/trades`,
    `Our AI analyzes your roster and recommends the best free agent signings and draft picks for your team.\n\nLike having a real front office advisor.\n\nainflgm.com`,
  ],
  engagementQuestions: [
    `Which NFL team has the best offseason setup right now?\n\nQuote tweet with your pick and why.\n\nRun any team's offseason: ainflgm.com`,
    `Hot take time: Which team will have the best draft this year?\n\nDrop your answer below.\n\nRun your own mock draft: ainflgm.com/draft`,
    `If you could be GM of any NFL team for one offseason, which team would you pick?\n\nTry it for real: ainflgm.com`,
    `What's more important for building a contender — free agency or the draft?\n\nTest both strategies: ainflgm.com`,
    `Name one player your team NEEDS to sign this offseason.\n\nSee if you can make it work under the cap: ainflgm.com`,
  ],
  draftSpeculation: [
    `The #1 overall pick is always the biggest decision of the draft.\n\nWho goes first in your mock? Run it and find out.\n\nainflgm.com/draft`,
    `Draft trades change everything. One trade can reshape the entire first round.\n\nIn AiNFL GM, you control the trades.\n\nainflgm.com/trades`,
    `Every GM thinks they know who the best prospect is.\n\nBut the draft board changes when you factor in team needs, cap space, and trade offers.\n\nSee for yourself: ainflgm.com/draft`,
    `Round 1 gets all the hype, but rounds 2-7 are where GMs really earn their money.\n\nAiNFL GM lets you run all 7 rounds.\n\nainflgm.com/draft`,
    `The best draft pick is the one that fills your biggest need at the best value.\n\nOur AI helps you find it.\n\nainflgm.com/draft`,
  ],
};

function generateTweets(count) {
  const categories = Object.keys(TEMPLATES);
  const tweets = [];

  for (let i = 0; i < count; i++) {
    const category = categories[i % categories.length];
    const templateList = TEMPLATES[category];
    const template = templateList[Math.floor(Math.random() * templateList.length)];

    // For team scenarios, fill in placeholder values
    let text = template;
    if (category === 'teamScenarios') {
      const teams = [
        { team: 'Raiders', cap: '$24.7M', pick: '1' },
        { team: 'Jets', cap: '$43.8M', pick: '2' },
        { team: 'Cardinals', cap: '$54.1M', pick: '3' },
        { team: 'Titans', cap: '$57.5M', pick: '4' },
        { team: 'Giants', cap: '$25.8M', pick: '5' },
        { team: 'Browns', cap: '$21.1M', pick: '6' },
        { team: 'Commanders', cap: '$61.7M', pick: '7' },
        { team: 'Saints', cap: '$17.3M', pick: '8' },
        { team: 'Chiefs', cap: '$10.9M', pick: '9' },
        { team: 'Bengals', cap: '$31.3M', pick: '10' },
        { team: 'Dolphins', cap: '$8.7M', pick: '11' },
        { team: 'Cowboys', cap: '$18.8M', pick: '12' },
        { team: 'Rams', cap: '$19.6M', pick: '13' },
        { team: 'Ravens', cap: '$28.5M', pick: '14' },
        { team: 'Buccaneers', cap: '$40.7M', pick: '15' },
        { team: 'Texans', cap: '$31.3M', pick: '28' },
        { team: 'Chargers', cap: '$62.1M', pick: '22' },
        { team: 'Seahawks', cap: '$44.1M', pick: '32' },
        { team: '49ers', cap: '$39.2M', pick: '27' },
        { team: 'Patriots', cap: '$42.2M', pick: '31' },
      ];
      const team = teams[Math.floor(Math.random() * teams.length)];
      text = text.replace('{team}', team.team)
                 .replace('{cap}', team.cap)
                 .replace('{pick}', team.pick);
      // Handle any remaining {cap} or {pick} in case template uses them twice
      text = text.replace(/{team}/g, team.team)
                 .replace(/{cap}/g, team.cap)
                 .replace(/{pick}/g, team.pick);
    }

    tweets.push(text);
  }

  return tweets;
}

function main() {
  // Read current content
  const content = JSON.parse(readFileSync(CONTENT_PATH, 'utf-8'));

  // Count remaining unposted tweets
  const unpostedCount = content.posts.filter(p => !p.posted).length;
  console.log(`Current unposted tweets: ${unpostedCount}`);

  if (unpostedCount >= 5) {
    console.log('Queue has 5 or more tweets remaining. No new content needed.');
    return;
  }

  console.log('Fewer than 5 tweets remaining. Generating 10 new tweets...');

  // Find the highest existing ID
  const maxId = Math.max(...content.posts.map(p => p.id));

  // Find the last scheduled date to continue from
  const lastScheduled = content.posts
    .filter(p => p.scheduled)
    .map(p => new Date(p.scheduled))
    .sort((a, b) => b - a)[0] || new Date();

  // Generate new tweets
  const newTweets = generateTweets(10);

  // Create post entries with incrementing IDs and scheduled times
  // Schedule two per day: 10am ET (14:00 UTC) and 6pm ET (22:00 UTC)
  let scheduleDate = new Date(lastScheduled);
  const timeSlots = ['T14:00:00', 'T22:00:00']; // 10am ET and 6pm ET in UTC
  let slotIndex = 1; // Start with the next slot after the last one

  newTweets.forEach((text, i) => {
    // Advance to next time slot
    if (slotIndex >= timeSlots.length) {
      slotIndex = 0;
      scheduleDate.setUTCDate(scheduleDate.getUTCDate() + 1);
    } else if (i > 0 || slotIndex > 0) {
      // Only advance on first iteration if we need to move past the current slot
    }

    const dateStr = scheduleDate.toISOString().split('T')[0];
    const scheduled = `${dateStr}${timeSlots[slotIndex]}`;

    content.posts.push({
      id: maxId + i + 1,
      text,
      posted: false,
      scheduled,
    });

    console.log(`  Added tweet id=${maxId + i + 1}: "${text.slice(0, 50)}..."`);

    slotIndex++;
    if (slotIndex >= timeSlots.length) {
      slotIndex = 0;
      scheduleDate.setUTCDate(scheduleDate.getUTCDate() + 1);
    }
  });

  // Write updated content
  writeFileSync(CONTENT_PATH, JSON.stringify(content, null, 2) + '\n', 'utf-8');
  console.log(`\nDone. Total posts: ${content.posts.length} (${content.posts.filter(p => !p.posted).length} unposted)`);
}

main();
