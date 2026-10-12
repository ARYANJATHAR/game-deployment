# Horizon Rush

An open-world festival racing game that runs in the browser, inspired by Forza Horizon.
Everything is generated in code at load time: the 4 × 4 km island, roads, trees, buildings, cars, textures, engine sounds and the radio music. The game ships no image, model or audio files. The full build is about 240 KB gzipped.

Built with [three.js](https://threejs.org/) and [Vite](https://vitejs.dev/).

## Play

```bash
npm install
npm run dev        # http://localhost:5173
```

Production build:

```bash
npm run build      # outputs to dist/
npm run preview    # serves dist/ on http://localhost:4173
```

`dist/` is a static site. It uses relative paths, so it can be hosted anywhere (GitHub Pages, Netlify, S3 or any static server). A GitHub Pages workflow is included in `.github/workflows/deploy.yml`.

You need a browser with WebGL 2 (recent Chrome, Edge, Firefox or Safari). A dedicated GPU gives the best frame rate; use **Settings → Quality: Low** on laptops and phones.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Throttle / Brake & reverse | W / S or ↑ / ↓ | RT / LT |
| Steer | A / D or ← / → | Left stick |
| Handbrake | Space | A |
| Shift up / down (manual gearbox) | E / Q | B / X |
| Rewind | Hold R | Y |
| Reset to road | T | — |
| Change camera | C | RB |
| Look back / free look | B / drag mouse | LB / right stick |
| Pause menu | Esc | Menu |
| World map | M or Tab | View |
| Start event at a marker | Enter | A |
| Photo mode | F | — |
| Radio station | N | — |
| Horn / headlights / toggle HUD | H / L / U | — |

Touch devices get on-screen steering, pedals, handbrake and rewind buttons.

## Features

**World**
- A procedural island with coastline and beaches, the snowy Sierra Alta mountains, the Pinewood forest, the patchwork Golden Fields, Mirror Lake, the town of Port Solano, an airfield and the Horizon Rush festival site with a stage, tents, arches and a Ferris wheel.
- A road network of 15 roads (about 30 km): a 12 km coastal highway loop, avenues, a mountain pass with guard rails, town streets, dirt trails and a runway. Junction heights and road grades are solved automatically.
- About 18,000 instanced trees, plus rocks, bushes, palms, lamp posts, fences, hay bales, signs, wind turbines and a lighthouse.
- Smashable props: fences, cones, lamps, signs and hay bales, plus 40 hidden XP boards.
- A day/night cycle with a physical sky, animated procedural clouds, stars, headlights, lit windows and street lamps.
- Dynamic weather: clear, rain (wet roads with reduced grip), fog and storms.
- Four seasons that recolour the island: summer, autumn, winter and spring.

**Driving**
- 10 cars, from a hot hatch to a Le Mans prototype. Each has its own procedurally modelled body, wheels, lights and spoilers, plus its own drivetrain (FWD, RWD or AWD), torque curve, gearbox, weight distribution, downforce and off-road ability.
- Raycast suspension with anti-roll bars, a slip-based tyre model with a friction ellipse, surface grip (asphalt, dirt, grass, sand, snow), aerodynamic drag and downforce, slipstreaming, and collisions with the world and other cars.
- Assists: ABS, traction control, stability control, steering assist, automatic or manual gearbox, and a racing line or braking-only line.
- Four cameras (chase, far chase, hood, bumper), free look, look back, and speed effects (radial blur, vignette and camera shake).
- A 12-second rewind.

**Gameplay**
- 12 events: road and street circuits, sprints, a dirt-trail scramble, a mountain hillclimb, a canyon rally, a 12 km island tour, a drag race, a "beat the jet" showcase and two drift-score events.
- Rival ghosts: your best run in each event is saved and replayed as a translucent car the next time you race it.
- 24 accolades (long-term goals) with credit and XP rewards, and 4 hidden barn finds with rumour areas marked on the map.
- Drivatar AI opponents with a racing line, braking-point planning, overtaking, recovery, rubber-banding and four difficulty levels.
- Activities: 5 speed traps, 3 speed zones, 3 drift zones and danger-sign jumps, each with 1–3 star ratings.
- Skill chains: drift, air, speed, near miss, wreckage and drafting, with a growing multiplier that banks into XP and credits.
- Progression: credits, XP and levels, Wheelspins, a car Autoshow, 6 upgrade categories that raise PI and class (D → X), and a paint shop (colours, finishes, rims, stripes and calipers).
- Roaming traffic, GPS waypoints with on-road arrows, a world map with fast travel, and a rotating minimap.
- Photo mode with exposure, saturation, time-of-day and FOV controls.
- Progress and settings are saved automatically in `localStorage`.

**Audio** (all synthesised with WebAudio)
- Engine sound per car based on cylinder count and RPM, with turbo whistle, blow-off and overrun crackles.
- Tyre screech, gravel rumble, wind, impacts, smashes and UI sounds.
- Three generative radio stations: Horizon Pulse (electro house), Neon Drive (synthwave) and Coastline FM (chill).
- Ambient birds, crickets and rain.

## Tests

```bash
npm test
```

The tests run headless in Node and check:
- `tests/physics.test.mjs`: each car's acceleration, top speed, braking distance, cornering g and resistance to rolling over, plus resting height on the real island.
- `tests/ai.test.mjs`: the AI completing the town circuit, mountain pass, dirt trail and full highway loop in two different cars without excessive resets.

## Project layout

```
src/
  main.js              loading screen and bootstrap
  Game.js              game states, event flow, progression, traffic, rewind, HUD wiring
  world/               heightfield, roads, terrain LOD, props, scenery, sky/weather, textures
  vehicle/             car model builder, vehicle physics, collision world, AI driver
  gameplay/            routes and racing lines, races, activities, skill chains
  fx/                  particles, skid marks, route arrows
  audio/               engine, effects and music synthesis
  camera/              chase / hood / bumper / orbit / cinematic cameras
  ui/                  HUD, menus, world map, touch controls
  config/              cars, upgrades, events, activities
tests/                 headless physics and AI tests
dev/cars.html          car model viewer used during development
```
