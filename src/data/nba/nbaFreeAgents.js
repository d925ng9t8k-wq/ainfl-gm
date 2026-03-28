// NBA Free Agents — 2026 offseason
// Mix of unrestricted (UFA) and restricted (RFA) free agents
// askingAAV = player's likely asking price ($M/yr)
// NOTE: Players who have signed contracts are removed from this pool.
// Chet Holmgren — signed max extension with OKC
// Josh Giddey — signed 4yr $100M with CHI
// Pascal Siakam — signed 4yr $189M max with IND
// Myles Turner — signed 4yr $109M with MIL
// Kyle Lowry — re-signed with PHI
// C.J. McCollum — traded to WAS (under contract)
// Khris Middleton — traded to WAS (under contract)
// Josh Green — signed with CHA (under contract)

export const nbaFreeAgents = [
  // Premier UFAs
  { id: 'fa-nba-7', name: 'Tobias Harris', position: 'PF', age: 32, rating: 78, askingAAV: 20.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Scorer', 'Versatile', 'Steady'] },
  { id: 'fa-nba-9', name: 'Clint Capela', position: 'C', age: 32, rating: 77, askingAAV: 12.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Rebounder', 'Rim Protector', 'Lob Threat'] },

  // Quality Mid-Tier UFAs
  { id: 'fa-nba-11', name: 'Brook Lopez', position: 'C', age: 38, rating: 77, askingAAV: 14.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Rim Protector', 'Shooter', 'Veteran'] },
  { id: 'fa-nba-15', name: 'D\'Angelo Russell', position: 'PG', age: 30, rating: 79, askingAAV: 18.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Scorer', 'Playmaker', 'Shooter'] },
  { id: 'fa-nba-17', name: 'Malcolm Brogdon', position: 'PG', age: 34, rating: 76, askingAAV: 15.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['IQ', 'Veteran', 'Playmaker'] },
  { id: 'fa-nba-18', name: 'Fred VanVleet', position: 'PG', age: 32, rating: 78, askingAAV: 22.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Playmaker', 'Defender', 'Leader'] },
  { id: 'fa-nba-19', name: 'Jordan Clarkson', position: 'SG', age: 33, rating: 77, askingAAV: 16.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Scorer', 'Sixth Man', 'Clutch'] },
  { id: 'fa-nba-20', name: 'Jakob Poeltl', position: 'C', age: 31, rating: 79, askingAAV: 18.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Two-Way', 'Screen Setter', 'Rim Protector'] },
  { id: 'fa-nba-21', name: 'Nikola Vucevic', position: 'C', age: 35, rating: 76, askingAAV: 14.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Post Scorer', 'Rebounder', 'Veteran'] },
  { id: 'fa-nba-22', name: 'De\'Andre Hunter', position: 'SF', age: 28, rating: 80, askingAAV: 22.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Two-Way', 'Versatile', 'Defender'] },
  { id: 'fa-nba-24', name: 'Harrison Barnes', position: 'SF', age: 34, rating: 74, askingAAV: 13.0, contractType: 'mid', birdRights: false, freeAgentType: 'UFA', traits: ['Veteran', 'Scorer', 'Clutch'] },

  // Restricted Free Agents (younger players)
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
