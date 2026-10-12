// Static layout of the island: road control points and points of interest.
// Coordinates are metres; -Z is north on the map.

export const WORLD = {
  size: 4096,
  half: 2048,
  cell: 4,
  seed: 1337,
  seaLevel: 0,
};

export const POI = {
  festival: { x: -230, z: -170, r: 190, name: 'Horizon Rush Festival' },
  town: { x: 800, z: 450, r: 360, name: 'Port Solano' },
  lake: { x: -1050, z: 700, r: 230, name: 'Mirror Lake' },
  mountain: { x: -950, z: -950, r: 900, name: 'Sierra Alta' },
  forest: { x: 950, z: -900, r: 520, name: 'Pinewood' },
  fields: { x: 300, z: 950, r: 600, name: 'Golden Fields' },
  airstrip: { x0: 260, x1: 1260, z: 980, name: 'Solano Airfield' },
  lighthouse: { x: 1840, z: 1420, name: 'Cape Lighthouse' },
};

// Hidden barn finds: each holds a classic car to restore.
export const BARNS = [
  { id: 'barn-fields', x: 520, z: 1180, car: 'mira', paint: '#8a5a2b', hint: 'Golden Fields' },
  { id: 'barn-forest', x: 1180, z: -980, car: 'kaito', paint: '#3d5a3a', hint: 'Pinewood' },
  { id: 'barn-hills', x: -560, z: -720, car: 'stallion', paint: '#7a1020', hint: 'Sierra foothills' },
  { id: 'barn-coast', x: -1420, z: 860, car: 'zenith', paint: '#0b0b0c', hint: 'West coast' },
];

// type: highway | road | street | dirt | runway
export const ROAD_DEFS = [
  {
    id: 'highway',
    name: 'Coastal Highway',
    type: 'highway',
    closed: true,
    halfWidth: 7.5,
    smooth: 110,
    points: [
      [-1500, -1450], [-1050, -1640], [-450, -1590], [100, -1660], [650, -1610], [1100, -1700],
      [1500, -1400], [1700, -950], [1640, -450], [1560, 0], [1700, 500], [1720, 900],
      [1520, 1320], [1100, 1530], [600, 1480], [150, 1520], [-350, 1560], [-800, 1480],
      [-1200, 1420], [-1600, 1100], [-1720, 600], [-1560, 250], [-1700, -250], [-1760, -700],
      [-1660, -1100],
    ],
  },
  {
    id: 'central',
    name: 'Central Avenue',
    type: 'road',
    halfWidth: 6,
    smooth: 70,
    points: [
      [80, -1640], [60, -1250], [-40, -900], [20, -620], [-60, -330], [-20, -80], [60, 200],
      [150, 520], [110, 820], [130, 1150], [140, 1530],
    ],
  },
  {
    id: 'sunset',
    name: 'Sunset Boulevard',
    type: 'road',
    halfWidth: 6,
    smooth: 70,
    points: [
      [-1580, 260], [-1250, 300], [-900, 250], [-560, 160], [-250, 140], [60, 60], [450, 80],
      [800, 120], [1150, 20], [1400, -40], [1570, 0],
    ],
  },
  {
    id: 'pass',
    name: 'Sierra Alta Pass',
    type: 'road',
    halfWidth: 5,
    smooth: 40,
    rails: true,
    points: [
      [-1490, -1460], [-1280, -1300], [-1360, -1080], [-1150, -1000], [-1220, -780],
      [-980, -760], [-1040, -560], [-790, -540], [-820, -330], [-600, -300], [-520, -60],
      [-560, 150],
    ],
  },
  {
    id: 'harbor',
    name: 'Harbor Road',
    type: 'road',
    halfWidth: 6,
    smooth: 60,
    points: [
      [150, 520], [380, 470], [650, 450], [800, 450], [950, 450], [1200, 430], [1450, 470], [1700, 480],
    ],
  },
  { id: 'town1', name: 'Marina Street', type: 'street', halfWidth: 5.5, smooth: 10, points: [[650, 300], [800, 300], [950, 300]] },
  { id: 'town2', name: 'Plaza Street', type: 'street', halfWidth: 5.5, smooth: 10, points: [[650, 600], [800, 600], [950, 600]] },
  { id: 'town3', name: 'West Lane', type: 'street', halfWidth: 5.5, smooth: 10, points: [[650, 300], [650, 450], [650, 600]] },
  { id: 'town4', name: 'Main Street', type: 'street', halfWidth: 5.5, smooth: 10, points: [[800, 120], [800, 300], [800, 450], [800, 600], [800, 760]] },
  { id: 'town5', name: 'East Lane', type: 'street', halfWidth: 5.5, smooth: 10, points: [[950, 300], [950, 450], [950, 600]] },
  {
    id: 'forest',
    name: 'Pinewood Trail',
    type: 'dirt',
    closed: true,
    halfWidth: 4.5,
    smooth: 25,
    points: [
      [560, -1120], [880, -1320], [1240, -1180], [1330, -870], [1150, -560], [880, -700],
      [760, -500], [520, -620], [600, -880],
    ],
  },
  {
    id: 'ridge',
    name: 'Ridge Track',
    type: 'dirt',
    halfWidth: 4.5,
    smooth: 25,
    points: [[1240, -1180], [1380, -1310], [1500, -1400]],
  },
  {
    id: 'forestlink',
    name: 'Logging Road',
    type: 'dirt',
    halfWidth: 4.5,
    smooth: 25,
    points: [[20, -620], [300, -640], [520, -620]],
  },
  {
    id: 'canyon',
    name: 'Golden Canyon Run',
    type: 'dirt',
    halfWidth: 4.5,
    smooth: 25,
    points: [
      [-1200, 1420], [-960, 1180], [-640, 1060], [-420, 1240], [-220, 1000], [-330, 760],
      [-560, 620], [-700, 420], [-900, 250],
    ],
  },
  {
    id: 'runway',
    name: 'Solano Airstrip',
    type: 'runway',
    halfWidth: 14,
    smooth: 200,
    points: [[120, 980], [500, 980], [900, 980], [1260, 980]],
  },
];
