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

`dist/` is a static site with relative paths. The game is meant to be hosted on Vercel; see [Deploy](#deploy).

You need a browser with WebGL 2 (recent Chrome, Edge, Firefox or Safari). On first launch the game picks a quality preset for your device. Dynamic resolution then lowers the render resolution when the frame rate drops. You can change both in **Settings**, and turn on **Show FPS** there.

## Multiplayer

Online play needs the bundled Node server, which serves the game and the multiplayer socket from one port:

```bash
npm install
npm run serve      # builds the game, then starts the server on http://localhost:8787
# or, after a build:  npm start   (PORT=9000 npm start for another port)
```

- **Same Wi-Fi / LAN party:** run the server on one computer. Everyone else opens `http://<that-computer's-IP>:8787` and picks **Pause → Online → Connect**.
- **Internet:** host the game on Vercel and the multiplayer server on Render. See [Deploy](#deploy).
- Players can also type any server address into the **Server address** box on the Online screen. Browsers require `wss://` (TLS) when the page is served over `https://`.

**What you can do online**
- Public free roam, or private rooms for up to 12 drivers, joined with a 5-letter code.
- Other drivers' cars appear live, with name tags and engine sounds, and you can collide with them.
- Text chat: press **Y** while driving, or use the Online screen.
- The room host can start any of the 12 events as an online race. Everyone gets a synced countdown, live standings and shared results. Online races pay a bonus that grows with the number of drivers.
- Online leaderboards: the server keeps the top times for every event, from both online races and solo runs. They're shown on each event card.

Rewind is disabled while you're in an online room.

## Deploy

Vercel serves static files and serverless functions. It can't keep WebSocket connections open, so the game and the multiplayer server are hosted separately:

| Part | Host | Config |
| --- | --- | --- |
| Game (static `dist/`) | Vercel | `vercel.json` |
| Multiplayer server (`server/index.js`) | Render (free web service) | `render.yaml` |

**1. Multiplayer server on Render**
1. On [render.com](https://render.com), choose **New → Blueprint** and select this repository. Render reads `render.yaml` and creates the `horizon-rush-multiplayer` web service.
2. When it's live, open `https://<your-service>.onrender.com/health`. It should return `{"ok":true,...}`.
3. Under the service's **Environment**, set `ALLOWED_ORIGINS` to your Vercel address, for example `https://horizon-rush.vercel.app`. Separate several addresses with commas. `*` is allowed as a wildcard, as in `https://*.vercel.app` (the default, which also covers Vercel preview deployments).

**2. Game on Vercel**
1. On [vercel.com](https://vercel.com), choose **Add New → Project** and import this repository. Vercel picks up `vercel.json` (Vite, `npm run build`, output `dist`).
2. Under **Settings → Environment Variables**, add `VITE_MULTIPLAYER_URL` = `https://<your-service>.onrender.com`. The game turns it into `wss://<your-service>.onrender.com/ws`.
3. Deploy. The variable is built into the game, so redeploy after changing it.

The game then connects to that server by default from **Pause → Online → Connect**.

**Notes**
- Render's free tier sleeps after about 15 minutes without traffic. The first connection after that can take up to a minute while it wakes up; the game waits for it.
- Free Render services have no persistent disk, so online leaderboards reset when the server restarts or redeploys. To keep them, add a Render disk and set `DATA_DIR` to its mount path, or use a paid plan.
- Any other Node host works too: start command `npm start`, and the host provides `PORT`. There is also a `Dockerfile`: `docker build -t horizon-rush . && docker run -p 8787:8787 -v hr-data:/data horizon-rush`. That image serves both the game and the server from one port.

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
| Chat (online) | Y | — |

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
- Rendering: multisampled anti-aliasing, HDR bloom, a time-of-day colour grade with vignette, a sun lens flare hidden by terrain, layered ocean waves, and baked slope and crease shading on the terrain. Medium and High quality use the full post-processing chain; Low renders directly for speed.
- Tyre smoke and dust can be set to Off, Low, Medium (default) or High in **Settings**.

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

**Multiplayer**
- Node + WebSocket server (`server/index.js`) with public and private rooms, 15 Hz state snapshots with client-side interpolation, chat, synced online races and persistent leaderboards.

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
- `tests/server.test.mjs`: the multiplayer protocol: rooms, codes, input sanitising, snapshots, chat, host-only race start, finish order, results and leaderboards.
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
  config/              cars, upgrades, events, activities, accolades
  net/                 multiplayer client and remote car interpolation
server/                multiplayer + static file server
tests/                 headless physics and AI tests
dev/cars.html          car model viewer used during development
```
