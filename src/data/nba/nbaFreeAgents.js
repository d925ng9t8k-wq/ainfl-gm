// NBA Free Agents — 2026 offseason
// Mix of unrestricted (UFA) and restricted (RFA) free agents
// askingAAV = player's likely asking price ($M/yr)

export const nbaFreeAgents = [
  // Premier UFAs
  { id: 'fa-nba-1', name: 'Jimmy Butler', position: 'SF', age: 37, rating: 86, askingAAV: 38.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Closer', 'Two-Way', 'Leader'] },
  { id: 'fa-nba-2', name: 'LeBron James', position: 'SF', age: 41, rating: 84, askingAAV: 30.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Legend', 'Playmaker', 'Veteran'] },
  { id: 'fa-nba-3', name: 'Paul George', position: 'SF', age: 36, rating: 80, askingAAV: 32.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Scorer', 'Two-Way', 'Veteran'] },
  { id: 'fa-nba-4', name: 'Klay Thompson', position: 'SG', age: 36, rating: 78, askingAAV: 22.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Shooter', 'Legend', 'Off-Ball'] },
  { id: 'fa-nba-5', name: 'Khris Middleton', position: 'SF', age: 35, rating: 77, askingAAV: 18.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Scorer', 'Clutch', 'Veteran'] },
  { id: 'fa-nba-6', name: 'Karl-Anthony Towns', position: 'C', age: 30, rating: 87, askingAAV: 48.0, contractType: 'max', birdRights: false, freeAgentType: 'UFA', traits: ['Scorer', 'Shooter', 'Big'] },
  { id: 'fa-nba-7', name: 'Tobias Harris', position: 'PF', age: 32, rating: 78, askingAAV: 20.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Scorer', 'Versatile', 'Steady'] },
  { id: 'fa-nba-8', name: 'C.J. McCollum', position: 'SG', age: 35, rating: 78, askingAAV: 18.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Scorer', 'Playmaker', 'Veteran'] },
  { id: 'fa-nba-9', name: 'Clint Capela', position: 'C', age: 32, rating: 77, askingAAV: 12.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Rebounder', 'Rim Protector', 'Lob Threat'] },
  { id: 'fa-nba-10', name: 'Draymond Green', position: 'PF', age: 36, rating: 80, askingAAV: 18.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['IQ', 'Defender', 'Facilitator'] },

  // Quality Mid-Tier UFAs
  { id: 'fa-nba-11', name: 'Brook Lopez', position: 'C', age: 38, rating: 77, askingAAV: 14.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Rim Protector', 'Shooter', 'Veteran'] },
  { id: 'fa-nba-12', name: 'Myles Turner', position: 'C', age: 30, rating: 82, askingAAV: 22.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Rim Protector', 'Shooter', 'Two-Way'] },
  { id: 'fa-nba-13', name: 'Pascal Siakam', position: 'PF', age: 31, rating: 86, askingAAV: 36.0, contractType: 'max', birdRights: false, freeAgentType: 'UFA', traits: ['Versatile', 'Scorer', 'Two-Way'] },
  { id: 'fa-nba-14', name: 'De\'Aaron Fox', position: 'PG', age: 28, rating: 87, askingAAV: 40.0, contractType: 'max', birdRights: false, freeAgentType: 'UFA', traits: ['Explosive', 'Scorer', 'Playmaker'] },
  { id: 'fa-nba-15', name: 'D\'Angelo Russell', position: 'PG', age: 30, rating: 79, askingAAV: 18.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Scorer', 'Playmaker', 'Shooter'] },
  { id: 'fa-nba-16', name: 'Kyle Lowry', position: 'PG', age: 40, rating: 67, askingAAV: 5.0, contractType: 'vet-min', birdRights: false, freeAgentType: 'UFA', traits: ['Veteran', 'IQ', 'Leader'] },
  { id: 'fa-nba-17', name: 'Malcolm Brogdon', position: 'PG', age: 34, rating: 76, askingAAV: 15.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['IQ', 'Veteran', 'Playmaker'] },
  { id: 'fa-nba-18', name: 'Fred VanVleet', position: 'PG', age: 32, rating: 78, askingAAV: 22.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Playmaker', 'Defender', 'Leader'] },
  { id: 'fa-nba-19', name: 'Jordan Clarkson', position: 'SG', age: 33, rating: 77, askingAAV: 16.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Scorer', 'Sixth Man', 'Clutch'] },
  { id: 'fa-nba-20', name: 'Jakob Poeltl', position: 'C', age: 31, rating: 79, askingAAV: 18.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Two-Way', 'Screen Setter', 'Rim Protector'] },
  { id: 'fa-nba-21', name: 'Nikola Vucevic', position: 'C', age: 35, rating: 76, askingAAV: 14.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Post Scorer', 'Rebounder', 'Veteran'] },
  { id: 'fa-nba-22', name: 'De\'Andre Hunter', position: 'SF', age: 28, rating: 80, askingAAV: 22.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Two-Way', 'Versatile', 'Defender'] },
  { id: 'fa-nba-23', name: 'Josh Green', position: 'SG', age: 25, rating: 74, askingAAV: 14.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Two-Way', 'Athletic', 'Developing'] },
  { id: 'fa-nba-24', name: 'Harrison Barnes', position: 'SF', age: 34, rating: 74, askingAAV: 13.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Veteran', 'Scorer', 'Clutch'] },

  // Restricted Free Agents (younger players)
  { id: 'fa-nba-25', name: 'Chet Holmgren', position: 'C', age: 23, rating: 88, askingAAV: 33.0, contractType: 'max', birdRights: false, freeAgentType: 'RFA', traits: ['Two-Way Big', 'Rim Protector', 'Shooter'] },
  { id: 'fa-nba-26', name: 'Josh Giddey', position: 'PG', age: 23, rating: 78, askingAAV: 22.0, contractType: 'mid', birdRights: false, freeAgentType: 'RFA', traits: ['Playmaker', 'Versatile', 'Developing'] },
  { id: 'fa-nba-27', name: 'GG Jackson', position: 'PF', age: 21, rating: 74, askingAAV: 12.0, contractType: 'mid', birdRights: false, freeAgentType: 'RFA', traits: ['Star Potential', 'Athletic', 'Developing'] },
  { id: 'fa-nba-28', name: 'Jabari Smith Jr.', position: 'PF', age: 23, rating: 79, askingAAV: 20.0, contractType: 'mid', birdRights: false, freeAgentType: 'RFA', traits: ['Versatile', 'Developing', 'Two-Way'] },

  // Veteran minimum signings
  { id: 'fa-nba-29', name: 'Reggie Jackson', position: 'PG', age: 36, rating: 67, askingAAV: 3.2, contractType: 'vet-min', birdRights: false, freeAgentType: 'UFA', traits: ['Veteran', 'Backup', 'Playmaker'] },
  { id: 'fa-nba-30', name: 'Mason Plumlee', position: 'C', age: 36, rating: 66, askingAAV: 3.2, contractType: 'vet-min', birdRights: false, freeAgentType: 'UFA', traits: ['Veteran', 'Backup', 'Passer'] },
  { id: 'fa-nba-31', name: 'Torrey Craig', position: 'SF', age: 35, rating: 67, askingAAV: 3.2, contractType: 'vet-min', birdRights: false, freeAgentType: 'UFA', traits: ['Defender', '3-and-D', 'Veteran'] },
  { id: 'fa-nba-32', name: 'Alec Burks', position: 'SG', age: 34, rating: 69, askingAAV: 5.0, contractType: 'vet-min', birdRights: false, freeAgentType: 'UFA', traits: ['Scorer', 'Creator', 'Veteran'] },
  { id: 'fa-nba-33', name: 'Joe Harris', position: 'SG', age: 35, rating: 70, askingAAV: 6.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Shooter', 'Veteran', 'Specialist'] },
  { id: 'fa-nba-34', name: 'Royce O\'Neale', position: 'SF', age: 32, rating: 73, askingAAV: 10.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['3-and-D', 'Defender', 'Veteran'] },
  { id: 'fa-nba-35', name: 'Larry Nance Jr.', position: 'PF', age: 33, rating: 72, askingAAV: 8.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Hustle', 'Versatile', 'Defender'] },
  { id: 'fa-nba-36', name: 'Dennis Schroder', position: 'PG', age: 32, rating: 74, askingAAV: 9.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Playmaker', 'Scorer', 'Backup'] },
  { id: 'fa-nba-37', name: 'Buddy Hield', position: 'SG', age: 33, rating: 75, askingAAV: 10.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Shooter', 'Specialist', 'Veteran'] },
  { id: 'fa-nba-38', name: 'P.J. Tucker', position: 'PF', age: 42, rating: 60, askingAAV: 3.2, contractType: 'vet-min', birdRights: false, freeAgentType: 'UFA', traits: ['Hustle', 'Veteran', 'Defense'] },
];
