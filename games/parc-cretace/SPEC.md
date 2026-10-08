# Crétacé Park — build spec (shared contract for every module)

Browser park-builder game, **French UI**, for a young player. Mechanics in the spirit of classic mobile
dinosaur park builders: isometric park, coins / food / dollars, DNA research with a success chance,
incubation timers (eggs), feeding creatures to level them up with **4 visible evolution stages**,
story missions told by NPCs, three parks (terrestre, aquatique, glaciaire) and turn-based tournaments.

**All art is original and procedural (Canvas 2D).** No external images. Never use the words
"Jurassic", "Jurassic Park/World", "Ludia", "Universal", movie characters, or imitate their logo
(no red disc with a black T-rex skeleton). The game name is **Crétacé Park**.

Game folder: `/home/user/touchHLE/games/parc-cretace/` (files below are relative to it).
Scratch folder for tests: `/tmp/claude-0/-home-user-touchHLE/f229ebfc-506c-54fe-b9b2-b01fd7bb1fa5/scratchpad/<module>/`
(never put test files in the game folder).

## 1. Files, owners, load order

Classic `<script src>` tags (no ES modules), loaded in this order by `index.html`:

| # | File | Owner | Global |
|---|------|-------|--------|
| 1 | js/species.js | lead (done, read-only) | PC.SPECIES, PC.SPECIES_ORDER, PC.RARITY, PC.CLASSES, PC.statsAt, PC.stageForLevel, PC.STAGE_NAMES, PC.STAGE_GROWTH, PC.classMult, PC.MAX_LEVEL |
| 2 | js/data.js | data agent | PC.DATA |
| 3 | js/art_core.js | lead (done, read-only) | PC.ART (helpers, drawCreature, drawEgg, portrait, drawNPC), PC.ICONS |
| 4 | js/art_land.js | art-land agent | registers land templates |
| 5 | js/art_sea.js | art-sea agent | registers sea templates |
| 6 | js/art_ice.js | art-ice agent | registers ice templates |
| 7 | js/buildings.js | buildings agent | PC.BUILD_ART |
| 8 | js/iso.js | iso agent | PC.TERRAIN, PC.ISO |
| 9 | js/engine.js | engine agent | PC.ENGINE |
| 10 | js/battle.js | battle agent | PC.BATTLE |
| 11 | js/ui.js | ui agent | PC.UI, PC.SFX, PC.LOGO |
| 12 | js/main.js | ui agent | boot + wiring |
| – | index.html | ui agent | page shell, CSS, DOM |

Every JS file is wrapped as:
```js
(function (PC) {
  'use strict';
  // ...
})(window.PC = window.PC || {});
```
At load time a file may only touch modules loaded **before** it. Anything else must be accessed inside
functions at call time, guarded when optional (`if (PC.SFX) PC.SFX.play('coin')`). No DOM work at load
time except in main.js boot. Only own your files; never edit someone else's.

### Artifact runtime constraints
- The page is published inside a sandboxed frame: no `alert/confirm/prompt` (build in-page dialogs),
  no network except Google Fonts (`Russo One` display font, `Exo 2` UI font, loaded by index.html), no
  downloads, `localStorage` wrapped in try/catch.
- Works on phones (≈ 400×800 portrait, touch) and desktop (mouse, wheel). No horizontal page scroll.
- index.html must not contain `<!doctype>`, `<html>`, `<head>`, `<body>` tags (it is wrapped at publish).
  Put `<title>Crétacé Park</title>`, the font `<link>`, `<style>` and markup at the top level.

## 2. Already provided (read the source!)

- `js/species.js`: 36 species. `PC.SPECIES[id] = { id, name, park, art, features[], rarity, cls, level,
  research: {cost, chance}|null, price: {coins}, hatchSec, colors: {body, belly, accent}, pattern
  ('stripes'|'spots'|'none'), size, desc, seed, mod }`. `PC.statsAt(id, level)` → `{level, hp, atkMin,
  atkMax, coinsPerMin, feedCost, feedsToLevel}`. `PC.stageForLevel(level)` → 0..3.
- `js/art_core.js`: `PC.ART.registerTemplate(name, fn, meta)`, `PC.ART.helpers` (H), `PC.ART.drawCreature(ctx, id, o)`,
  `PC.ART.creatureBox(id, o)`, `PC.ART.drawEgg(ctx, x, y, size, park, t, progress, ready)`,
  `PC.ART.portrait(id, w, h, {stage, silhouette, bg})` → cached canvas, `PC.ART.drawNPC(ctx, look, x, y, w, h, t)`,
  `PC.ICONS.draw(ctx, name, x, y, size)`, `PC.ICONS.url(name, size)` → data URL. Icon names: coin, dollar,
  food_land, food_sea, food_ice, xp, star, dna, lock, clock, hp, atk, chasseur, colosse, blinde, egg, check, trophy.

## 3. Evolution (important to the player)

Creature level 1..40. `stage = PC.stageForLevel(level)`: 0 **Bébé** (1–9), 1 **Juvénile** (10–19),
2 **Adulte** (20–29), 3 **Alpha** (30–40). `drawCreature` already scales by `PC.STAGE_GROWTH`.
Templates must ALSO change the look per stage (`o.stage`):
- stage 0: big head and eyes, short legs, softer/paler colours, tiny or no horns/plates/spikes/teeth.
- stage 1: closer to adult proportions, small features.
- stage 2: full adult features.
- stage 3 (Alpha): richer/darker colours, bolder pattern, bigger horns/spikes/teeth/plates, 2–3 pale
  battle scars, a glowing accent marking. The difference must be obvious side by side.

## 4. Data — `js/data.js` → `PC.DATA`

Cost / reward objects everywhere: `{ coins?, dollars?, food_land?, food_sea?, food_ice?, xp? }`.

```js
PC.DATA.PARKS = {
  land: { id: 'land', name: 'Parc Terrestre', food: 'food_land', foodName: 'Nourriture', unlockLevel: 1, unlockCost: {}, enclosure: [3, 3] },
  sea:  { id: 'sea',  name: 'Parc Aquatique', food: 'food_sea',  foodName: 'Poissons',   unlockLevel: 5,  unlockCost: { coins: 15000 }, enclosure: [4, 4] },
  ice:  { id: 'ice',  name: 'Parc Glaciaire', food: 'food_ice',  foodName: 'Viande',     unlockLevel: 10, unlockCost: { coins: 40000 }, enclosure: [3, 3] },
};
PC.DATA.PARK_ORDER = ['land', 'sea', 'ice'];
PC.DATA.RESOURCES = { coins: {name:'Pièces', icon:'coin'}, dollars: {name:'Dollars', icon:'dollar'},
  food_land: {name:'Nourriture', icon:'food_land'}, food_sea: {name:'Poissons', icon:'food_sea'}, food_ice: {name:'Viande', icon:'food_ice'} };
```

`PC.DATA.BUILDINGS[id] = { id, name, park, kind: 'coins'|'food'|'deco'|'road'|'special', size: [w, h],
cost, level, produce: { res, amount, sec } | null, xp, art, desc, action?, fixed? }`.
Exactly these ids (art id = building id, except roads which use art `'road'`):

- **land** — special (fixed, not sold in the market, `action` in parentheses): `gate_land` [3,2] (gate),
  `lab_land` [3,3] (lab), `arena_land` [4,4] (arena). coins: `souvenir_shop` [2,2], `snack_bar` [2,2],
  `restaurant` [2,2], `observation_tower` [2,2], `hotel` [3,3], `cinema` [3,3]. food (res food_land):
  `fern_farm` [2,2], `fruit_orchard` [2,2], `meat_market` [2,2]. deco: `palm` [1,1], `flowers` [1,1],
  `torch` [1,1], `volcano_rock` [1,1], `safari_jeep` [1,1], `fountain` [2,2], `statue_rex` [2,2].
  road: `road_land` [1,1].
- **sea** — special: `gate_sea` [3,2], `lab_sea` [3,3], `arena_sea` [4,4]. coins: `shell_shop` [2,2],
  `submarine_dock` [3,3], `dome_restaurant` [3,3], `aquarium_hotel` [3,3]. food (food_sea):
  `fish_farm` [2,2], `krill_net` [2,2]. deco: `coral` [1,1], `kelp` [1,1], `anchor` [1,1],
  `treasure_chest` [1,1], `shipwreck` [2,2], `ancient_ruins` [2,2]. road: `road_sea` [1,1].
- **ice** — special: `gate_ice` [3,2], `lab_ice` [3,3], `arena_ice` [4,4]. coins: `fur_shop` [2,2],
  `hot_chocolate` [2,2], `ice_hotel` [3,3]. food (food_ice): `hunter_lodge` [2,2], `cold_storage` [2,2].
  deco: `snowy_pine` [1,1], `brazier` [1,1], `snowman` [1,1], `ice_crystals` [1,1], `igloo` [2,2],
  `ice_statue` [2,2]. road: `road_ice` [1,1].

Other DATA:
- `PC.DATA.ENCLOSURE_SIZE = { land: [3,3], sea: [4,4], ice: [3,3] }`.
- `PC.DATA.START = { coins: 6000, dollars: 25, food_land: 600, food_sea: 0, food_ice: 0, level: 1, xp: 0 }`.
- `PC.DATA.MAX_PLAYER_LEVEL = 30`; `PC.DATA.xpToNext(level)` → XP needed from `level` to `level+1`;
  `PC.DATA.levelReward(level)` → reward object given when reaching `level` (dollars + coins).
  Pacing target: level 2 in ~3 min, **level 5 (aquatic park) after ~20–30 min**, level 10 (glacier) ~1.5–2 h.
- `PC.DATA.XP = { feed: 4, collect: 1, creatureLevel: 10, researchAttempt: 20, researchSuccess: 50 }`.
- `PC.DATA.RESEARCH = { durationSec: {commun: 5, rare: 8, super: 12, legendaire: 18}, boostCost: {dollars: 5}, boostChance: 20, maxChance: 95 }`.
- `PC.DATA.SELL_RATIO = 0.25`, `PC.DATA.COIN_CAP_MIN = 60` (minutes of creature income that can pile up),
  `PC.DATA.speedUpCost(remainingSec)` → dollars (1 per started minute, min 1).
- `PC.DATA.NAMES` (≥ 40 cute French nicknames for creatures).
- `PC.DATA.NPCS[id] = { name, role, look }` (look = art_core drawNPC look). At least: `elise`
  (Dr Élise Morel, paléogénéticienne, guide of the land park), `marco` (Marco Diaz, chef des rangers,
  tournaments), `ines` (Inès Kerval, biologiste marine, sea park), `oleg` (Oleg Varga, pisteur des
  glaces, ice park), `krane` (Victor Krane, directeur du parc rival « Dinoworld », tournament rival),
  plus 3–5 tournament opponents.
- `PC.DATA.MISSIONS` — ordered story (one active at a time), ~34 missions (≈16 land, 9 sea, 9 ice):
  `{ id, park, title, npc, intro: [lines], goal, reward, outro }`. Goal types (engine implements all):
  - `{type:'build', building?, kind?, count}` buildings placed since mission start
  - `{type:'own_building', building?, kind?, count}` currently owned (absolute)
  - `{type:'hatch', species?, park?, count}` since start
  - `{type:'own_species', park, count}` distinct hatched species owned in park (absolute)
  - `{type:'feed', count}` since start
  - `{type:'creature_level', level, species?}` any owned creature ≥ level (absolute)
  - `{type:'collect', res, amount}` amount collected since start
  - `{type:'research', success: true|false, count}` successes (or attempts if false) since start
  - `{type:'win_battle', park?, count}` since start
  - `{type:'battle_stage', park, stage}` highest cleared stage ≥ stage (absolute)
  - `{type:'player_level', level}` (absolute)
  - `{type:'unlock_park', park}` (absolute)
  The story must lead naturally: first fern farm → first creature → collect → feed → shop → research →
  tournament → … → reach level 5 → unlock the aquatic park (Inès arrives) → … → level 10 → glacier (Oleg).
- `PC.DATA.BATTLE_STAGES = { land: [...20], sea: [...12], ice: [...12] }`, each
  `{ stage, name, opponent (npc id), enemies: [{species, level}], reward }`. Enemies only from that park.
  Stage 1 must be winnable with one level-3 common creature; difficulty ramps smoothly.
- `PC.DATA.TIPS` — 15+ short French tips for loading screens.
- `PC.DATA.CARDS = { freeEverySec: 600, perPack: 3, table: [{weight, reward, label, rarity}] }` — free
  card pack (like the "CARDS / COLLECT" button of the reference game): every 10 minutes the player can open
  a pack of 3 cards, each a random reward (coins, food of an unlocked park, dollars, xp; rare cards bigger).
  A pack can also be bought for `PC.DATA.CARDS.packCost = {dollars: 10}`.

## 5. Engine — `js/engine.js` → `PC.ENGINE`

Save key `'cretace-park-v2'` in localStorage. State:

```js
state = {
  v: 2,
  player: { level, xp, coins, dollars, food_land, food_sea, food_ice },
  current: 'land',
  parks: { land: { unlocked: true, objects: [], nextId: 1 }, sea: {...}, ice: {...} },
  researched: { [speciesId]: true },
  research: null | { speciesId, startedAt, endsAt, chance, boosted, result: null | true | false },
  mission: { index: 0, base: {}, },          // base = counter snapshot at mission start
  battles: { land: 0, sea: 0, ice: 0 },       // highest cleared stage
  counters: { built: {}, builtKind: {}, hatched: {}, hatchedPark: {}, feeds: 0, collected: {},
              researchAttempts: 0, researchSuccess: 0, battlesWon: { land: 0, sea: 0, ice: 0 } },
  seenIntro: false,
  settings: { sound: true },
  savedAt: 0,
};
Obj = {
  id, type: 'enclosure' | 'building', gx, gy, w, h,
  buildingId?, fixed?,                         // buildings (incl. specials and roads)
  speciesId?, name?, level?, feeds?,           // enclosures
  hatchAt?,                                    // ms timestamp, null once hatched
  hatched?,                                    // bool
  coins?, lastAt?,                             // banked creature coins + last accrual time (ms)
  readyAt?,                                    // producing buildings: ms timestamp of cycle end
}
```

API (every mutation emits `'change'`):
- `init()` load or new game (fixed objects come from `PC.TERRAIN.generate(park).fixed`), `reset()`, `save()`, `now()` (Date.now() + `debug` offset), `tick()` (call ~4×/s: bank coins, resolve research, detect mission completion, autosave every 10 s), `on(evt, fn)`, `off(evt, fn)`.
- Events: `'change'`; `'toast' {text, kind:'info'|'good'|'bad'}`; `'levelup' {level, reward, unlocks:[text]}`;
  `'hatched' {park, obj}`; `'research' {speciesId, success}`; `'mission' {mission, index, status:'complete'|'new'}`;
  `'collect' {park, obj, res, amount}`; `'feed' {obj, levelUp, stageUp}`; `'unlock' {park}`; `'park' {park}`;
  `'battle' {park, stage, won, reward}`; `'build' {park, obj}`.
- Resources: `res(name)`, `canAfford(cost)`, `pay(cost)` → bool, `give(reward)` (xp via `addXP`), `addXP(n)` (multi level-up, `DATA.levelReward`, emits levelup with list of newly unlocked species/buildings/parks).
- Species: `speciesStatus(id)` → `{state: 'level'|'research'|'researching'|'available', needLevel}`.
- Research: `startResearch(id, boost)` → `{ok, reason}`; resolved in `tick()` when `endsAt` passes (chance roll, +boostChance if boosted, capped), emits `'research'`; result stays in `state.research` until `ackResearch()`. `speedUpResearch()`.
- Placement: `canPlace(park, gx, gy, w, h, ignoreId)` (inside map, terrain tile code 1, no overlap), `findFreeSpot(park, w, h)` (closest to park centre).
- Creatures: `buyCreature(speciesId, gx, gy)` → `{ok, obj, reason}` (pays, enclosure with egg, `hatchAt = now + hatchSec*1000`, random name), `hatch(objId)`, `pendingCoins(obj)`, `collect(objId)` (creature coins or building production) → amount, `feed(objId)` → `{ok, levelUp, stageUp, reason}` (cost = statsAt(level).feedCost of the park's food; `feedsToLevel` feeds per level; max level 40), `creatureStats(obj)`, `creaturesOf(park, hatchedOnly)`.
- Buildings: `buyBuilding(buildingId, gx, gy)` → `{ok, obj, reason}`, `move(objId, gx, gy)`, `sell(objId)` (refund SELL_RATIO, never fixed), `speedUpCost(obj)`, `speedUp(objId)` (eggs and productions).
- Parks: `unlockPark(park)` (level + cost), `setPark(park)`.
- Missions: `mission()` → `{def, index, progress, target, done}` or null when finished; `claimMission()`.
- Battles: `battleTeam(park)` (hatched creatures, highest level first), `recordBattle(park, stage, won)` → reward (first clear = full reward and `battles[park] = stage`; replay = 30 % coins; loss = 5 xp).
- `getObj(park, id)`, `objects(park)`, `getTerrain(park)`.
- Cards: `state.cards = { nextFreeAt }` (first pack free immediately); `cardsReady()` → bool;
  `openPack(paid)` → `{ok, cards: [{label, reward, rarity}]}` (gives the rewards, sets the next free time).
- `debug: { give(res, n), skip(sec), setLevel(n) }` for tests.
- Time-based: everything uses timestamps so progress continues while the game is closed.

## 6. Terrain & isometric view — `js/iso.js` → `PC.TERRAIN`, `PC.ISO`

`PC.ISO.TW = 96`, `PC.ISO.TH = 48`, `PC.ISO.MAP = 24`. Tile (gx, gy) top corner in world coords:
`((gx - gy) * TW/2, (gx + gy) * TH/2)`.

`PC.TERRAIN.generate(park)` (deterministic per park, cached) → `{ park, w: 24, h: 24, tiles: Uint8Array,
fixed: [{buildingId, gx, gy}], scenery: [{gx, gy, kind, seed}] }`. Tile codes: 0 scenery border
(unbuildable), 1 buildable, 2 water (land/ice ponds; unbuildable). Buildable core ≈ 17×17 with an
irregular natural edge. Gate on the edge nearest the viewer (high gx+gy), lab and arena placed inside
near the gate, leaving most space free. Use `PC.DATA.BUILDINGS[id].size` for footprints.

`PC.ISO.createView(canvas)` → view with:
- `setPark(park)`, `resize()`, `render(t)` (reads `PC.ENGINE.state` every frame), `centerOn(gx, gy)`.
- Camera: drag to pan (6 px tap threshold), wheel and pinch zoom (0.45–1.8), clamped to the map.
- `view.onTap = fn(hit)`; `hit = {kind:'bubble', obj} | {kind:'object', obj} | {kind:'tile', gx, gy}`
  (bubbles first, then front-most object, then tile).
- Placement: `startPlacement({w, h, ghost: {type:'enclosure', speciesId} | {type:'building', buildingId} | {type:'move', obj}, gx, gy})`,
  `getPlacement()` → `{gx, gy, valid}`, `endPlacement()`, `view.onPlacementChange = fn(p)`. Dragging
  the ghost moves it (snapped), tapping a tile moves it; green when `PC.ENGINE.canPlace(...)`, red otherwise.
- `addFloat(gx, gy, text, color, icon)`, `addBurst(gx, gy, kind)` ('hatch'|'level'|'build'|'stars'|'evolve'), `highlight(objId|null)`.
- Draws: biome terrain (cached), scenery (via `PC.BUILD_ART.drawScenery` when present), roads (flat,
  auto-connected), enclosures (fences per biome, egg + countdown while incubating, "Éclore !" badge
  when ready, wandering/swimming creatures, level plate), buildings via `PC.BUILD_ART.draw`, collect
  bubbles (coins above creatures when `pendingCoins ≥ max(5, coinsPerMin)`, resource icon above
  ready buildings, production progress bar otherwise), floats, bursts, ambient animation (sea caustics
  and bubbles, falling snow, fireflies/butterflies on land). Each hatched enclosure shows a small metal
  plate on its front fence with 1–4 stars (= stage + 1) and the level number, like the reference game.

## 7. Building art — `js/buildings.js` → `PC.BUILD_ART`

- `PC.BUILD_ART.draw(ctx, artId, fp, t, opts)`. `fp = { top:[x,y], right:[x,y], bottom:[x,y],
  left:[x,y], cx, cy, w, h, tw: 96, th: 48 }` = footprint diamond in the ctx's current coordinates
  (camera already applied). Draw the building standing on that diamond and rising upwards (−y), mostly
  within the diamond's horizontal span. `opts = { alpha, ghost, ready, producing (0..1), biome }`.
- `PC.BUILD_ART.drawScenery(ctx, kind, x, y, size, t, seed)` (x, y = ground point, size ≈ tile width):
  land `palm, fern, broadleaf, bush, rock, flowers`; sea `coral_fan, coral_brain, kelp, sea_rock, anemone`;
  ice `pine, snow_rock, ice_shard, dead_tree`.
- `PC.BUILD_ART.thumb(artId, w, h)` → cached canvas thumbnail for market cards (uses a fake fp).
- `PC.BUILD_ART.ids` → supported art ids.

## 8. Battle — `js/battle.js` → `PC.BATTLE`

`PC.BATTLE.open(park)`, `PC.BATTLE.close()`, `PC.BATTLE.isOpen()`. Full-screen overlay created on
demand. Tournament screen (stage ladder, opponent NPC, enemy cards, pick up to 3 of your hatched
creatures of that park) → fight screen (arena per biome, creatures drawn large facing each other,
team portraits with HP, big HP bars, actions **Attaque / Super attaque / Changer / Fuir** and an
**AUTO** toggle that lets the AI play the player's turns) → result screen (VICTOIRE / DÉFAITE + rewards
via `PC.ENGINE.recordBattle`). Damage = `rand(atkMin..atkMax) × PC.classMult × (crit 10 % ×1.5)`;
normal attacks miss 5 %; the **Super attaque** gauge fills with each attack given or received (full after
about 3 actions), deals ×1.8 and never misses; Changer costs the turn; HP reset each battle.
Animations are a priority for the player:
- Attaque: wind-up, lunge across, bite/strike with impact flash, defender hurt pose + white flash +
  knock-back, screen shake, damage number pop, biome particles (dust, bubbles, snow).
- Super attaque: a cinematic — screen dims, camera zooms on the attacker, aura in the attacker's class
  colour, roar text, slow-motion charge, huge impact with shockwave rings, sparks, big screen shake,
  giant damage number, then the camera returns. Each class gets its own flavour (Chasseur: red claw
  slashes; Colosse: green ground-quake with rocks; Blindé: blue shield-charge with shards).
- KO: creature falls/fades, next one slides in with a roar. Victory: confetti + trophy.

## 9. UI — `index.html`, `js/ui.js`, `js/main.js` → `PC.UI`, `PC.SFX`, `PC.LOGO`

Full-viewport game (canvas fills the screen, HUD overlays). Industrial "park control" style: brushed
steel frames, dark panel interiors, yellow/black hazard stripes, rivets, chunky Russo One titles,
green action buttons, red round close buttons, dark capsule resource counters with icons. Original
**CRÉTACÉ PARK** logo (procedural canvas: amber/volcanic emblem, original stylised dino head or
footprint, metallic bevelled lettering). HUD: level badge + XP bar + Missions button (top-left),
resources (park food, coins, dollars; top-right), bottom bar MARCHÉ / ROUTES / LABO ADN / TOURNOI /
CARTES (red "COLLECTER" tag when a free pack is ready; pack opening = 3 cards flipping with rarity glow)
/ COLLECTION / PARCS / OPTIONS (on phones the bar scrolls horizontally or wraps into 2 rows). Panels: market, lab (animated DNA sequencing + success/failure reveal), creature
(feed, collect, move, sell, speed-up, hatch; EVOLUTION overlay on stage-up showing before/after),
building, missions (NPC bust + dialog + progress + claim), story dialogs, collection, parks (unlock),
options (sound, help, restart with in-page confirm, credits), toasts, level-up modal, title screen
with JOUER button. `PC.SFX.play(name)` synthesized with WebAudio: click, coin, food, build, hatch,
levelup, research, success, fail, roar, hit, crit, win, lose, error, feed, evolve.
main.js boots everything, wires `view.onTap`, engine events, render loop, `ENGINE.tick` every 250 ms,
resize, save on `pagehide`, and `window.claude?.hot` (snapshot = engine state, boot from hot data).

## 10. Quality bar

French everywhere with correct accents, friendly tone. Zero console errors. Each module tests itself
(`node --check`, plus Playwright screenshots for anything visual: `NODE_PATH=$(npm root -g) node test.js`
with `require('playwright')`, chromium is preinstalled — never run `playwright install`). LOOK at your
screenshots with the Read tool and iterate until the result is genuinely good.

## 11. Phase 2 additions (requested by the player after the first build)

1. **Launch animation**: after the title screen's JOUER (or right at boot before it), a short intro
   (~4 s, skippable by tap): jungle silhouette background, a big T-Rex (PC.ART.drawCreature 'tyrannosaurus',
   stage 3) stomps in, raises its head and ROARS (pose 'roar', screen shake, roar sound via PC.SFX,
   dust and birds flying away), then the CRÉTACÉ PARK logo slams in.
2. **Battle moves like the reference screenshot**: each creature has 3 regular moves plus SPÉCIALE,
   shown as square metal buttons with icons: predators (chasseur) — Morsure (×1.0, 95 % accuracy),
   Coup de griffe (×0.8, 100 %, fills the special gauge faster), Charge (×1.25, 80 %); colosses —
   Charge, Coup de queue, Piétinement; blindés — Coup de corne / Coup de massue / Coup de tête (by art),
   Coup de queue, Charge. SPÉCIALE has a red badge with the number of turns before it is ready, then glows.
   Each move has its own animation (bite = lunge + jaw snap, griffe = swipe with claw trails, charge =
   run across + big knock-back, queue = turn and tail whip, piétinement = rear up + ground quake).
   Arena look: metal stadium with big gates, floodlights, electric fences, sandy ground; HP bars with
   names at the top corners, team portraits down the sides, player name + wins counter, a level badge
   bottom-left, sound toggle bottom-right.
3. **Several missions to validate at the same time**: besides the story mission, 2–3 side missions
   (« Missions secondaires », regenerated when claimed: feed N times, collect N coins, hatch a creature,
   build something, win a battle, research…). The Missions panel shows a vertical list of mission tabs on
   the left (icon per mission, "!" when claimable), and on the right the NPC portrait, title, short text,
   a checkbox goal line with progress, rewards (xp + coins/dollars) and a RÉCLAMER button.
4. **Story map for tournaments, harder and harder** (reference screenshot: an overworld map): the
   tournament screen becomes a scrollable painted map (grass, rivers, a central mountain, forests, roads,
   clouds hiding the locked far part) with numbered round stage nodes linked by glowing paths. Next to each
   node, a small stack of opponent portrait cards; under each node 3 medals — **Bronze, Argent, Or** — one
   per difficulty tier of that stage (Bronze = base enemies; Argent = enemies +5 levels, 1 extra enemy if
   fewer than 3; Or = +10 levels and max team). Medals light up when won; a stage's Argent unlocks after its
   Bronze, Or after Argent; the next stage unlocks after Bronze. Rewards grow with the tier. Cleared nodes
   are green, the current one pulses, locked ones are grey. Engine: `state.battles[park]` stays the highest
   Bronze-cleared stage, plus `state.medals[park][stage] = 0..3`; `recordBattle(park, stage, won, tier)`.

7. **Aquatic park look (reference screenshots)**: deep blue seabed divided into big lots by slightly raised
   sand paths, lagoon enclosures with dark posts and a star plate, lush coral beds (purple, red, green
   table corals), kelp, rocks, a giant fossil skeleton half-buried in the rocks, Greek-style ruins, an anchor,
   a shipwreck, a glass greenhouse dome with green lights, an octopus-shaped building, and the arena as a
   red-and-white stadium. Underwater battle arena: futuristic cyan-lit dome with gates, light rays, bubbles,
   the plesiosaur-style creature in the foreground. Add deco `fossil_skeleton` [2,2] and coins building
   `octopus_house` [2,2] to the sea park.

## 12. Phase 3 — online battles (artifact runtime capabilities `db`, `room`, `user`)

- **Arène en ligne (asynchrone, `db`)**: each player registers their best team (3 creatures: species,
  level, stats snapshot) with trophies in a shared collection; a leaderboard lists other players; fighting
  someone's team = a normal battle where the AI plays their side; wins/losses change trophies.
- **Duel en direct (temps réel, `room`)**: lobby shows who is online (presence), challenge a player,
  both join `room.join('duel-<id>')`; the challenger's page is authoritative (does every roll and
  broadcasts the full battle state after each action), the other side only sends its move choice;
  state is re-broadcast on request so dropped messages never desync.
- Everything degrades gracefully when `claude.use(...)` resolves `null` (offline play stays complete).
5. **Music** (original, generated live with WebAudio — no audio files): `PC.MUSIC.play(track)` /
   `PC.MUSIC.stop()` with a smooth cross-fade; tracks: `title` (epic adventure theme for the intro),
   `park_land` (warm jungle adventure: marimba, light percussion, pads), `park_sea` (calm underwater pads
   and bells), `park_ice` (glassy bells, slow strings), `battle` (energetic: driving drums, bass ostinato,
   brass-like stabs, rising tension; a more intense variant when an Alpha or a boss fights), `victory`
   (short fanfare) and `defeat` (short sad cadence). Separate on/off toggles for music and sound effects in
   Options (`state.settings.music`), music starts only after a user gesture, volume ducks during roars.
6. **Battle camera like the reference screenshot**: the player's creature stands in the foreground, large,
   lower-left, facing right; the enemy stands further back in the arena, smaller, right of centre, facing
   left (ground shadows and a slight blur/haze for depth). Buttons ATTAQUE (or the 3 moves), SPÉCIALE and
   CHANGER as big square metal buttons at the bottom, a round pause button bottom-left, side controls
   (sound, music) on the right edge. SPÉCIALE can also be used immediately by paying 2 dollars (shown above
   the button with the dollar icon) when its gauge is not full yet.
- **Swappable network layer**: all online code goes through `PC.NET` (`available()`, `me()`,
  `saveTeam()`, `listTeams()`, `reportResult()`, `lobby()`, `challenge()`, `duel` messaging). First
  backend: claude.ai capabilities (`db`/`room`/`user`). The player plans to host the game publicly later
  (e.g. GitHub Pages for the static files + Firebase/Supabase or a small Node WebSocket server), so no
  game code may call `claude.use` directly — only the claude.ai backend of `PC.NET` does.
