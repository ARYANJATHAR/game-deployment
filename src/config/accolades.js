// Accolades: long-term goals that reward XP and credits.
// check(p, s, ctx) receives progress, stats and live context.

export const ACCOLADES = [
  { id: 'first-race', name: 'Lights Out', desc: 'Complete your first race', xp: 1000, cr: 5000, check: (p, s) => s.races >= 1 },
  { id: 'first-win', name: 'Top Step', desc: 'Win a race', xp: 2000, cr: 10000, check: (p, s) => s.wins >= 1 },
  { id: 'wins-5', name: 'Festival Favourite', desc: 'Win 5 races', xp: 5000, cr: 25000, check: (p, s) => s.wins >= 5, progress: (p, s) => [s.wins, 5] },
  { id: 'all-events', name: 'Island Champion', desc: 'Complete every event', xp: 15000, cr: 100000, check: (p) => Object.keys(p.events).length >= 12, progress: (p) => [Object.keys(p.events).length, 12] },
  { id: 'jet', name: 'Faster Than Flight', desc: 'Beat the jet in the showcase', xp: 5000, cr: 30000, check: (p) => p.events['jet-showcase'] && p.events['jet-showcase'].position === 1 },
  { id: 'speed-200', name: 'Double Ton', desc: 'Reach 200 km/h', xp: 800, cr: 2000, check: (p, s) => s.topSpeed >= 200 },
  { id: 'speed-300', name: 'Triple Ton', desc: 'Reach 300 km/h', xp: 2500, cr: 10000, check: (p, s) => s.topSpeed >= 300 },
  { id: 'speed-400', name: 'Hyperspace', desc: 'Reach 400 km/h', xp: 6000, cr: 40000, check: (p, s) => s.topSpeed >= 400 },
  { id: 'drift-big', name: 'Sideways Legend', desc: 'Score 8,000 points in a single drift', xp: 2000, cr: 8000, check: (p, s, c) => c.bestDrift >= 8000 },
  { id: 'drift-total', name: 'Tyre Shredder', desc: 'Earn 250,000 drift points', xp: 4000, cr: 20000, check: (p, s) => s.drifts >= 250000, progress: (p, s) => [s.drifts, 250000] },
  { id: 'air', name: 'Frequent Flyer', desc: 'Get 2 seconds of air in one jump', xp: 1500, cr: 6000, check: (p, s, c) => c.bestAir >= 2 },
  { id: 'boards-10', name: 'Board Breaker', desc: 'Smash 10 XP boards', xp: 2000, cr: 10000, check: (p) => p.boards.length >= 10, progress: (p) => [p.boards.length, 10] },
  { id: 'boards-all', name: 'Collector', desc: 'Smash all 40 XP boards', xp: 10000, cr: 75000, check: (p) => p.boards.length >= 40, progress: (p) => [p.boards.length, 40] },
  { id: 'smash-100', name: 'Wrecking Ball', desc: 'Smash 100 objects', xp: 2000, cr: 8000, check: (p, s) => s.smashed >= 100, progress: (p, s) => [s.smashed, 100] },
  { id: 'distance-50', name: 'Road Tripper', desc: 'Drive 50 km', xp: 3000, cr: 15000, check: (p, s) => s.distance >= 50000, progress: (p, s) => [Math.floor(s.distance / 1000), 50] },
  { id: 'night', name: 'Night Owl', desc: 'Drive 10 km at night', xp: 2000, cr: 10000, check: (p, s) => (s.nightDistance || 0) >= 10000, progress: (p, s) => [Math.floor((s.nightDistance || 0) / 1000), 10] },
  { id: 'near-25', name: 'Close Call', desc: '25 near misses', xp: 2000, cr: 8000, check: (p, s) => (s.nearMisses || 0) >= 25, progress: (p, s) => [s.nearMisses || 0, 25] },
  { id: 'chain-50k', name: 'Skill Master', desc: 'Bank a 50,000 point skill chain', xp: 4000, cr: 20000, check: (p, s) => (s.bestChain || 0) >= 50000 },
  { id: 'stars-3', name: 'Star Performer', desc: 'Earn 3 stars on any activity', xp: 1500, cr: 6000, check: (p) => Object.values(p.activities).some((a) => a.stars >= 3) },
  { id: 'stars-all', name: 'Perfectionist', desc: 'Earn 3 stars on every speed trap, zone and drift zone', xp: 15000, cr: 100000, check: (p) => Object.values(p.activities).filter((a) => a.stars >= 3).length >= 11, progress: (p) => [Object.values(p.activities).filter((a) => a.stars >= 3).length, 11] },
  { id: 'garage-5', name: 'Car Collector', desc: 'Own 5 cars', xp: 3000, cr: 15000, check: (p) => p.garage.length >= 5, progress: (p) => [p.garage.length, 5] },
  { id: 'barns', name: 'Barn Hunter', desc: 'Find every barn find', xp: 8000, cr: 50000, check: (p) => (p.barns || []).length >= 4, progress: (p) => [(p.barns || []).length, 4] },
  { id: 'level-10', name: 'Rising Star', desc: 'Reach level 10', xp: 0, cr: 50000, check: (p) => p.level >= 10 },
  { id: 'upgrade', name: 'Tuner', desc: 'Fully upgrade the engine of any car', xp: 1500, cr: 5000, check: (p) => p.garage.some((c) => (c.upgrades || {}).engine >= 3) },
];
