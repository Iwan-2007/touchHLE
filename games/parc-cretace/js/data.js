/* Crétacé Park — game data: parks, buildings, economy curves, NPCs, story missions,
   tournament stages, tips and card packs. Pure data + tiny helpers, no DOM.
   Loaded right after species.js; only reads PC.SPECIES at call time (validation helpers). */
(function (PC) {
  'use strict';
  const DATA = PC.DATA = PC.DATA || {};

  // ---------------------------------------------------------------------------
  // Parks & resources
  // ---------------------------------------------------------------------------
  DATA.PARKS = {
    land: { id: 'land', name: 'Parc Terrestre', food: 'food_land', foodName: 'Nourriture', unlockLevel: 1, unlockCost: {}, enclosure: [3, 3],
      desc: 'Fougères géantes, volcans fumants et les plus célèbres dinosaures.' },
    sea: { id: 'sea', name: 'Parc Aquatique', food: 'food_sea', foodName: 'Poissons', unlockLevel: 5, unlockCost: { coins: 15000 }, enclosure: [4, 4],
      desc: 'Un lagon turquoise où nagent les reptiles marins géants.' },
    ice: { id: 'ice', name: 'Parc Glaciaire', food: 'food_ice', foodName: 'Viande', unlockLevel: 10, unlockCost: { coins: 40000 }, enclosure: [3, 3],
      desc: 'La toundra enneigée des mammouths et des tigres à dents de sabre.' },
  };
  DATA.PARK_ORDER = ['land', 'sea', 'ice'];

  DATA.RESOURCES = {
    coins: { name: 'Pièces', icon: 'coin' },
    dollars: { name: 'Dollars', icon: 'dollar' },
    food_land: { name: 'Nourriture', icon: 'food_land' },
    food_sea: { name: 'Poissons', icon: 'food_sea' },
    food_ice: { name: 'Viande', icon: 'food_ice' },
  };

  DATA.ENCLOSURE_SIZE = { land: [3, 3], sea: [4, 4], ice: [3, 3] };

  // Display names for building kinds (market tabs, info panels).
  DATA.KIND_NAMES = { food: 'Nourriture', coins: 'Commerces', deco: 'Décorations', road: 'Routes', special: 'Bâtiments du parc' };

  // ---------------------------------------------------------------------------
  // Buildings
  // Coin buildings produce automatically (`produce` = one cycle, then Collecter).
  // Food buildings must be « Activés »: the player picks one of 3 `orders`
  // ({name, sec, amount}); shorter orders give more food per minute. `produce`
  // mirrors the first (shortest) order for fallbacks and market cards.
  // Every non-special building can be upgraded (levels 1–5, handled by the engine).
  // ---------------------------------------------------------------------------
  DATA.BUILDINGS = {};
  const ORDER_NAMES = ['Petite livraison', 'Livraison moyenne', 'Grosse livraison'];
  /** Register a building. xp ≈ coin cost / 40. */
  function B(id, park, kind, size, name, level, cost, produce, desc, extra) {
    const coins = (cost && cost.coins) || 0;
    DATA.BUILDINGS[id] = Object.assign({
      id, name, park, kind, size, cost: cost || {}, level,
      produce: produce ? { res: produce[0], amount: produce[1], sec: produce[2] } : null,
      xp: kind === 'special' ? 0 : Math.round(coins / 40),
      art: kind === 'road' ? 'road' : id,
      desc,
    }, extra || {});
  }
  /** Coin building: `amount` coins every `sec` seconds. */
  const SHOP = (id, park, size, name, level, coins, amount, sec, desc) =>
    B(id, park, 'coins', size, name, level, { coins }, ['coins', amount, sec], desc);
  /** Food building with 3 delivery orders [[sec, amount] x3]. */
  function FARM(id, park, size, name, level, coins, orders, desc) {
    const res = DATA.PARKS[park].food;
    B(id, park, 'food', size, name, level, { coins }, [res, orders[0][1], orders[0][0]], desc, {
      orders: orders.map((o, i) => ({ name: ORDER_NAMES[i], sec: o[0], amount: o[1] })),
    });
  }
  const DECO = (id, park, size, name, level, coins, desc) => B(id, park, 'deco', size, name, level, { coins }, null, desc);
  /** Fixed park building (gate, lab, arena, harbor): never sold, never bought. */
  const SPECIAL = (id, park, size, name, action, desc) => B(id, park, 'special', size, name, 1, {}, null, desc, { action, fixed: true });

  // ----- Parc Terrestre -----
  SPECIAL('gate_land', 'land', [3, 2], 'Grande Porte', 'gate', 'L’entrée monumentale du parc. Les visiteurs arrivent par ici !');
  SPECIAL('lab_land', 'land', [3, 3], 'Laboratoire ADN', 'lab', 'Le Dr Morel y décode l’ADN fossile pour recréer des espèces disparues.');
  SPECIAL('arena_land', 'land', [4, 4], 'Arène des Rangers', 'arena', 'Tournois amicaux contre les dresseurs des parcs voisins.');
  // food (food_land) — orders: [sec, amount]
  FARM('fern_farm', 'land', [2, 2], 'Ferme de fougères', 1, 150, [[60, 50], [600, 350], [3600, 1500]], 'Des fougères tendres qui repoussent en un clin d’œil.');
  FARM('fruit_orchard', 'land', [2, 2], 'Verger tropical', 3, 1500, [[120, 200], [900, 1100], [7200, 5400]], 'Mangues, goyaves et figues : le dessert préféré des herbivores.');
  FARM('meat_market', 'land', [2, 2], 'Marché aux viandes', 7, 5000, [[300, 750], [1800, 3000], [7200, 8400]], 'De gros steaks pour les appétits de carnivores.');
  FARM('crops_harbor', 'land', [3, 3], 'Port des récoltes', 9, 12000, [[600, 2400], [3600, 9000], [14400, 24000]], 'Un cargo, des grues et des conteneurs pleins de nourriture fraîche.');
  // coins
  SHOP('souvenir_shop', 'land', [2, 2], 'Boutique de souvenirs', 1, 300, 25, 30, 'Peluches, casquettes et cartes postales de dinosaures.');
  SHOP('snack_bar', 'land', [2, 2], 'Snack du Volcan', 2, 1000, 140, 120, 'Glaces à la lave (à la fraise) et frites croustillantes.');
  SHOP('restaurant', 'land', [2, 2], 'Restaurant Fossile', 4, 3000, 400, 240, 'On y déguste le fameux burger « Tricé-Ratatouille ».');
  SHOP('observation_tower', 'land', [2, 2], 'Tour d’observation', 6, 6000, 650, 300, 'Une vue imprenable sur tout le parc, jumelles comprises.');
  SHOP('hotel', 'land', [3, 3], 'Hôtel Fougère', 8, 14000, 2400, 480, 'Des chambres avec vue sur les enclos. Réveil garanti par les rugissements !');
  SHOP('cinema', 'land', [3, 3], 'Cinéma Préhisto', 11, 30000, 4500, 600, 'Un film en relief où les dinosaures sortent presque de l’écran.');
  // deco
  DECO('palm', 'land', [1, 1], 'Palmier', 1, 100, 'Un palmier qui donne de l’ombre aux visiteurs.');
  DECO('flowers', 'land', [1, 1], 'Massif de fleurs', 1, 60, 'Des fleurs tropicales aux couleurs éclatantes.');
  DECO('torch', 'land', [1, 1], 'Torche', 2, 150, 'Une torche en bambou qui éclaire les allées le soir.');
  DECO('volcano_rock', 'land', [1, 1], 'Rocher volcanique', 3, 300, 'Un rocher de lave refroidie, encore un peu tiède.');
  DECO('safari_jeep', 'land', [1, 1], 'Jeep de safari', 5, 800, 'La jeep des rangers, prête pour l’aventure.');
  DECO('fountain', 'land', [2, 2], 'Fontaine aux fougères', 4, 1200, 'Une fontaine rafraîchissante au milieu des fougères.');
  DECO('statue_rex', 'land', [2, 2], 'Statue du roi des dinos', 9, 5000, 'Une statue géante de Tyrannosaure. Les photos y sont obligatoires !');
  // road
  B('road_land', 'land', 'road', [1, 1], 'Allée pavée', 1, { coins: 10 }, null, 'Une allée en pierres pour guider les visiteurs.');

  // ----- Parc Aquatique -----
  SPECIAL('gate_sea', 'sea', [3, 2], 'Porte du Lagon', 'gate', 'Une arche de corail qui accueille les visiteurs du lagon.');
  SPECIAL('lab_sea', 'sea', [3, 3], 'Laboratoire marin', 'lab', 'Inès y étudie l’ADN des géants des mers.');
  SPECIAL('arena_sea', 'sea', [4, 4], 'Arène du Récif', 'arena', 'Un stade rouge et blanc posé au fond du lagon.');
  FARM('fish_farm', 'sea', [2, 2], 'Ferme à poissons', 5, 500, [[60, 60], [600, 420], [3600, 1800]], 'Des bancs de sardines bien dodues.');
  FARM('krill_net', 'sea', [2, 2], 'Filets à krill', 7, 4000, [[300, 600], [1800, 2400], [7200, 7200]], 'Des millions de petites crevettes pour les gros appétits.');
  SHOP('shell_shop', 'sea', [2, 2], 'Boutique de coquillages', 5, 1500, 180, 120, 'Colliers de coquillages et dents de requin (fausses, promis).');
  SHOP('submarine_dock', 'sea', [3, 3], 'Port des sous-marins', 6, 6000, 1000, 300, 'Une balade en sous-marin jaune au milieu des créatures.');
  SHOP('octopus_house', 'sea', [2, 2], 'Maison de la Pieuvre', 7, 9000, 1100, 300, 'Une boutique en forme de pieuvre géante. Huit bras, huit caisses !');
  SHOP('dome_restaurant', 'sea', [3, 3], 'Restaurant sous dôme', 8, 12000, 2000, 420, 'On y dîne sous un dôme de verre, au milieu des poissons.');
  SHOP('aquarium_hotel', 'sea', [3, 3], 'Hôtel aquarium', 10, 22000, 3600, 600, 'Chaque chambre a une fenêtre sur le grand bleu.');
  DECO('coral', 'sea', [1, 1], 'Corail', 5, 120, 'Un corail rose et orange plein de petits poissons.');
  DECO('kelp', 'sea', [1, 1], 'Forêt de varech', 5, 100, 'De longues algues qui ondulent avec le courant.');
  DECO('anchor', 'sea', [1, 1], 'Vieille ancre', 6, 300, 'L’ancre rouillée d’un navire oublié.');
  DECO('treasure_chest', 'sea', [1, 1], 'Coffre au trésor', 7, 900, 'Il brille encore… mais il est vide. Ou pas ?');
  DECO('shipwreck', 'sea', [2, 2], 'Épave de galion', 8, 3000, 'Un vieux galion englouti, repaire des poissons curieux.');
  DECO('fossil_skeleton', 'sea', [2, 2], 'Squelette fossile', 9, 4500, 'Le squelette géant d’un ancien monstre marin, à moitié pris dans la roche.');
  DECO('ancient_ruins', 'sea', [2, 2], 'Ruines englouties', 10, 6000, 'Les colonnes d’une cité mystérieuse disparue sous les flots.');
  B('road_sea', 'sea', 'road', [1, 1], 'Chemin de sable', 5, { coins: 15 }, null, 'Un chemin de sable clair entre les lagons.');

  // ----- Parc Glaciaire -----
  SPECIAL('gate_ice', 'ice', [3, 2], 'Porte du Grand Nord', 'gate', 'Une porte en rondins couverte de givre.');
  SPECIAL('harbor_ice', 'ice', [4, 3], 'Port d’arrivée', 'gate', 'Le quai où accostent les aéroglisseurs, avec ses hangars et son tunnel dans la falaise.');
  SPECIAL('lab_ice', 'ice', [3, 3], 'Laboratoire polaire', 'lab', 'On y réveille l’ADN conservé dans la glace depuis des millénaires.');
  SPECIAL('arena_ice', 'ice', [4, 4], 'Arène de Glace', 'arena', 'Une arène taillée dans un glacier. Attention, ça glisse !');
  FARM('hunter_lodge', 'ice', [2, 2], 'Cabane du pisteur', 10, 1500, [[120, 200], [900, 1100], [7200, 5400]], 'Oleg y prépare les réserves de viande pour l’hiver.');
  FARM('cold_storage', 'ice', [2, 2], 'Chambre froide', 12, 8000, [[300, 900], [1800, 3600], [7200, 10800]], 'Un immense garde-manger glacé. Pas besoin de frigo ici !');
  SHOP('fur_shop', 'ice', [2, 2], 'Boutique polaire', 10, 3000, 300, 120, 'Bonnets à pompon, moufles et écharpes toutes douces.');
  SHOP('hot_chocolate', 'ice', [2, 2], 'Chalet du chocolat chaud', 11, 8000, 1000, 300, 'Un chocolat chaud avec une montagne de chantilly.');
  SHOP('visitor_center_ice', 'ice', [3, 3], 'Centre des visiteurs', 12, 16000, 3000, 600, 'Un grand dôme chauffé où l’on découvre les géants de l’ère glaciaire.');
  SHOP('ice_hotel', 'ice', [3, 3], 'Hôtel de glace', 13, 25000, 4000, 600, 'Des lits sculptés dans la glace… et des couettes très épaisses.');
  DECO('snowy_pine', 'ice', [1, 1], 'Sapin enneigé', 10, 150, 'Un grand sapin poudré de neige.');
  DECO('brazier', 'ice', [1, 1], 'Brasero', 10, 250, 'Un feu crépitant où les visiteurs se réchauffent les mains.');
  DECO('hovercraft', 'ice', [1, 1], 'Aéroglisseur', 10, 600, 'Il file sur la glace comme sur un coussin d’air.');
  DECO('snowman', 'ice', [1, 1], 'Bonhomme de neige', 11, 400, 'Avec une carotte pour le nez, évidemment.');
  DECO('snow_tracker', 'ice', [1, 1], 'Chenillette des neiges', 11, 900, 'Le véhicule d’Oleg pour les expéditions dans le blizzard.');
  DECO('ice_crystals', 'ice', [1, 1], 'Cristaux de glace', 12, 700, 'Des cristaux bleutés qui scintillent au soleil.');
  DECO('igloo', 'ice', [2, 2], 'Igloo', 12, 2500, 'Un igloo douillet où l’on peut faire la sieste.');
  DECO('helipad', 'ice', [2, 2], 'Héliport', 13, 3500, 'Une piste d’atterrissage pour les hélicoptères de ravitaillement.');
  DECO('ice_statue', 'ice', [2, 2], 'Statue de glace', 14, 8000, 'Un Mammouth sculpté dans un bloc de glace géant.');
  B('road_ice', 'ice', 'road', [1, 1], 'Sentier enneigé', 10, { coins: 15 }, null, 'Un sentier damé dans la neige fraîche.');

  // ---------------------------------------------------------------------------
  // Economy
  // ---------------------------------------------------------------------------
  DATA.START = { coins: 6000, dollars: 25, food_land: 600, food_sea: 0, food_ice: 0, level: 1, xp: 0 };
  DATA.MAX_PLAYER_LEVEL = 30;

  // XP needed to go from level L to L+1 (index = L). Tuned with a player simulation:
  // level 2 ≈ 3 min, level 5 ≈ 25 min, level 10 ≈ 1 h 45 of active play.
  const XP_TABLE = [0,
    600, 700, 1050, 1350, 1900, 2200, 2600, 3000, 3400, // 1..9
    4200, 5000, 5800, 6700, 7700, 8800, 10000, 11300, 12700, 14200, // 10..19
    15800, 17500, 19300, 21200, 23200, 25300, 27500, 29800, 32200, 34700, // 20..29
  ];
  /** XP needed to go from `level` to `level + 1` (finite even at MAX_PLAYER_LEVEL; the engine caps the level). */
  DATA.xpToNext = function (level) {
    const L = Math.max(1, level | 0);
    if (L < XP_TABLE.length) return XP_TABLE[L];
    return XP_TABLE[XP_TABLE.length - 1] + (L - XP_TABLE.length + 1) * 3500;
  };

  /** Reward given when reaching `level` (dollars + coins). */
  DATA.levelReward = function (level) {
    const L = Math.max(2, level | 0);
    const coins = Math.round(250 * L * (1 + L / 10) / 50) * 50;
    const dollars = L % 5 === 0 ? 10 : 3;
    return { coins, dollars };
  };

  DATA.XP = { feed: 4, collect: 1, creatureLevel: 10, researchAttempt: 20, researchSuccess: 50 };
  // Multi-step DNA research (SPEC §11.8): each attempt costs ceil(research.cost / steps) coins;
  // a failed attempt can be re-run for retryCost instead of paying coins again.
  DATA.RESEARCH = {
    durationSec: { commun: 5, rare: 8, super: 12, legendaire: 18, mythique: 25 },
    boostCost: { dollars: 5 }, boostChance: 20, maxChance: 95,
    steps: { commun: 2, rare: 3, super: 4, legendaire: 5, mythique: 6 },
    retryCost: { dollars: 1 },
  };
  // DNA expeditions (SPEC §11.8): one at a time; success = research completed instantly,
  // failure = « Dernière chance » to buy the amber for buyDollars. cost = coins per expedition.
  DATA.EXPEDITION = {
    durationSec: { commun: 60, rare: 120, super: 240, legendaire: 420, mythique: 600 },
    chance: { commun: 60, rare: 55, super: 45, legendaire: 40, mythique: 35 },
    cost: { commun: 600, rare: 2500, super: 9000, legendaire: 25000, mythique: 60000 },
    buyDollars: { commun: 3, rare: 6, super: 12, legendaire: 25, mythique: 40 },
    vehicle: { land: 'Jeep d’exploration', sea: 'Sous-marin', ice: 'Chenillette des neiges' },
    promo: { everySec: 1800, durationSec: 300, discount: 0.3 },
  };
  DATA.SELL_RATIO = 0.25;
  DATA.COIN_CAP_MIN = 60;
  /** Dollar price to finish a timer now: 1 dollar per started minute, min 1. */
  DATA.speedUpCost = function (remainingSec) {
    return Math.max(1, Math.ceil(Math.max(0, remainingSec) / 60));
  };

  // ---------------------------------------------------------------------------
  // Creature nicknames
  // ---------------------------------------------------------------------------
  DATA.NAMES = [
    'Caillou', 'Biscotte', 'Noisette', 'Pistache', 'Croquette', 'Grignotte', 'Pâquerette', 'Ronron',
    'Bouboule', 'Cacahuète', 'Praline', 'Chouquette', 'Gribouille', 'Moustache', 'Patapouf', 'Tornade',
    'Éclair', 'Brindille', 'Myrtille', 'Galipette', 'Filou', 'Pépite', 'Câlin', 'Gaufrette',
    'Clafoutis', 'Choupette', 'Frimousse', 'Pompon', 'Réglisse', 'Cannelle', 'Caramel', 'Nougat',
    'Mistral', 'Tonnerre', 'Saphir', 'Comète', 'Bigoudi', 'Pirouette', 'Zéphyr', 'Papillote',
    'Truffe', 'Dragée', 'Bretzel', 'Mimosa', 'Coquelicot', 'Pruneau', 'Titan', 'Tartine',
    'Croissant', 'Guimauve', 'Paprika', 'Biscuit', 'Fripouille', 'Gros-Câlin', 'Sushi', 'Plume',
  ];

  // ---------------------------------------------------------------------------
  // Characters (look = PC.ART.drawNPC look)
  // ---------------------------------------------------------------------------
  DATA.NPCS = {
    elise: { name: 'Dr Élise Morel', role: 'Paléogénéticienne, guide du Parc Terrestre',
      look: { skin: '#f1cba8', hair: '#9a4a24', hairStyle: 'bun', shirt: '#eef0ea', accent: '#3fa0d0', glasses: true } },
    marco: { name: 'Marco Diaz', role: 'Chef des rangers, organisateur des tournois',
      look: { skin: '#c48a5c', hair: '#2a1a12', hairStyle: 'short', shirt: '#6a7a3a', accent: '#f0a33a', hat: true, beard: true } },
    ines: { name: 'Inès Kerval', role: 'Biologiste marine, guide du Parc Aquatique',
      look: { skin: '#8a5636', hair: '#1c120c', hairStyle: 'curly', shirt: '#2f8fb0', accent: '#f6d04a' } },
    oleg: { name: 'Oleg Varga', role: 'Pisteur des glaces, guide du Parc Glaciaire',
      look: { skin: '#f0d4bc', hair: '#cfc6b4', hairStyle: 'short', shirt: '#a8352e', accent: '#ece6d4', beard: true } },
    krane: { name: 'Victor Krane', role: 'Directeur du parc rival « Dinoworld »',
      look: { skin: '#e6c2a2', hair: '#17171c', hairStyle: 'short', shirt: '#2a2a36', accent: '#d0302c', glasses: true } },
    tom: { name: 'Tom Bertrand', role: 'Apprenti ranger',
      look: { skin: '#f3d0ae', hair: '#a8682c', hairStyle: 'curly', shirt: '#8aa64a', accent: '#f2d440' } },
    lea: { name: 'Léa Fontaine', role: 'Dresseuse du Club des Griffes',
      look: { skin: '#f6d8bc', hair: '#e2b448', hairStyle: 'long', shirt: '#d0603a', accent: '#2a2a2a' } },
    amara: { name: 'Amara Diallo', role: 'Capitaine de la Brigade des Volcans',
      look: { skin: '#6a3f26', hair: '#140c08', hairStyle: 'bun', shirt: '#7a3a8a', accent: '#f0c040' } },
    nina: { name: 'Nina Ruiz', role: 'Plongeuse championne du Récif',
      look: { skin: '#d6a07a', hair: '#5a2a1a', hairStyle: 'long', shirt: '#1f9a8a', accent: '#ff8a5a' } },
    bjorn: { name: 'Björn Halvorsen', role: 'Musher du Grand Nord',
      look: { skin: '#f4dccb', hair: '#d4862e', hairStyle: 'long', shirt: '#3a6a7a', accent: '#f2f2f2', beard: true } },
  };

  // ---------------------------------------------------------------------------
  // Story missions (one active at a time, in order)
  // ---------------------------------------------------------------------------
  /** M(id, park, npc, title, intro[], goal, reward, outro) */
  const M = (id, park, npc, title, intro, goal, reward, outro) => ({ id, park, title, npc, intro, goal, reward, outro });

  DATA.MISSIONS = [
    // ----- Parc Terrestre (Élise, Marco, Krane) -----
    M('m01', 'land', 'elise', 'Bienvenue au parc !', [
      'Bienvenue à Crétacé Park ! Je suis le Dr Élise Morel, paléogénéticienne.',
      'Avant d’accueillir nos premiers dinosaures, il leur faut de quoi manger.',
      'Ouvre le MARCHÉ et construis une Ferme de fougères.',
    ], { type: 'build', building: 'fern_farm', count: 1 }, { coins: 300, xp: 15 },
    'Parfait ! Touche la ferme et choisis une livraison : les fougères vont pousser.'),

    M('m02', 'land', 'elise', 'Un œuf tout chaud', [
      'Le grand moment est arrivé : notre tout premier œuf !',
      'Achète un Stégosaure ou un Tricératops au MARCHÉ, puis attends qu’il éclose.',
    ], { type: 'own_species', park: 'land', count: 1 }, { food_land: 200, xp: 20 },
    'Il a éclos ! Regarde ce bébé… Il a déjà ton sourire. Enfin, presque.'),

    M('m03', 'land', 'elise', 'Des pièces qui brillent', [
      'Les visiteurs adorent nos dinosaures : ils laissent des pièces près des enclos.',
      'Quand une bulle de pièces apparaît, touche-la. Ramasse 40 pièces.',
    ], { type: 'collect', res: 'coins', amount: 40 }, { coins: 250, xp: 15 },
    'Bien joué ! Plus tes créatures grandissent, plus elles rapportent.'),

    M('m04', 'land', 'elise', 'L’heure du goûter', [
      'Un bébé dinosaure, ça a toujours faim !',
      'Touche ta créature et nourris-la 3 fois : elle passera au niveau suivant.',
    ], { type: 'feed', count: 3 }, { food_land: 150, xp: 20 },
    'Miam ! Continue de la nourrir : à certains niveaux, elle évoluera !'),

    M('m05', 'land', 'elise', 'Souvenirs, souvenirs', [
      'Nos visiteurs veulent rapporter un souvenir à la maison.',
      'Construis une Boutique de souvenirs : elle fabrique des pièces toute seule.',
    ], { type: 'build', building: 'souvenir_shop', count: 1 }, { coins: 400, xp: 25 },
    'Les peluches de Stégosaure se vendent comme des petits pains !'),

    M('m06', 'land', 'elise', 'Une grande famille', [
      'Un dinosaure, c’est bien. Plusieurs espèces, c’est encore mieux !',
      'Fais éclore une deuxième espèce dans le Parc Terrestre.',
    ], { type: 'own_species', park: 'land', count: 2 }, { coins: 600, food_land: 200, xp: 30 },
    'Deux espèces ! Notre parc ressemble de plus en plus à un vrai parc.'),

    M('m07', 'land', 'elise', 'Un parc tout beau', [
      'Les familles adorent les jolis parcs.',
      'Place 3 décorations : palmiers, fleurs, torches… à toi de choisir !',
    ], { type: 'build', kind: 'deco', count: 3 }, { coins: 500, xp: 30 },
    'Magnifique ! Et chaque décoration te rapporte aussi de l’expérience.'),

    M('m08', 'land', 'elise', 'Objectif niveau 3', [
      'Mon laboratoire ADN est presque prêt.',
      'Au niveau 3, nous pourrons décoder l’ADN du Vélociraptor !',
      'Nourris tes créatures et construis pour gagner de l’expérience.',
    ], { type: 'player_level', level: 3 }, { coins: 1500 },
    'Niveau 3 ! Le séquenceur ADN est allumé, viens vite au labo.'),

    M('m09', 'land', 'elise', 'Mystère ADN', [
      'Le LABO ADN recrée des espèces disparues… mais ça ne marche pas à tous les coups !',
      'Lance une recherche ADN. Si elle échoue, pas de panique : on pourra réessayer.',
    ], { type: 'research', success: false, count: 1 }, { coins: 2000, xp: 30 },
    'Quelle aventure ! La science, c’est beaucoup de patience et un peu de chance.'),

    M('m10', 'land', 'marco', 'Le tournoi des rangers', [
      'Salut ! Marco Diaz, chef des rangers. Ici, on organise des tournois amicaux.',
      'Retiens bien : les Blindés sont forts contre les Chasseurs !',
      'Va au TOURNOI et gagne ton premier combat.',
    ], { type: 'win_battle', park: 'land', count: 1 }, { coins: 800, dollars: 5, xp: 40 },
    'Bravo, champion ! Tu as l’étoffe d’un vrai ranger.'),

    M('m11', 'land', 'elise', 'Des fruits pour tous', [
      'Plus de créatures, c’est plus de bouches à nourrir !',
      'Construis un Verger tropical : il produit beaucoup plus de nourriture.',
    ], { type: 'build', building: 'fruit_orchard', count: 1 }, { food_land: 300, xp: 40 },
    'Des mangues, des goyaves… nos dinos vont adorer.'),

    M('m12', 'land', 'elise', 'Grandir vite', [
      'Une créature bien nourrie rapporte plus de pièces et frappe plus fort en tournoi.',
      'Fais monter une créature jusqu’au niveau 5.',
    ], { type: 'creature_level', level: 5 }, { coins: 1000, xp: 40 },
    'Niveau 5 ! Au niveau 10, elle évoluera en Juvénile, tu verras.'),

    M('m13', 'land', 'krane', 'Le rival', [
      'Ha ! Alors c’est toi, le nouveau directeur ?',
      'Victor Krane, directeur de Dinoworld, le plus grand parc du monde !',
      'Mes dresseurs t’attendent au tournoi. Atteins l’étape 3… si tu en es capable !',
    ], { type: 'battle_stage', park: 'land', stage: 3 }, { coins: 1200, dollars: 3, xp: 50 },
    'Grr… Coup de chance ! La prochaine fois, je viendrai en personne.'),

    M('m14', 'land', 'elise', 'Les griffes du labo', [
      'Le Vélociraptor est petit, malin et très rapide.',
      'Termine sa recherche ADN, fais éclore un Vélociraptor et nourris-le jusqu’au niveau 3.',
    ], { type: 'creature_level', species: 'velociraptor', level: 3 }, { coins: 1500, xp: 60 },
    'Regarde-le ! Il nous observe déjà avec ses grands yeux curieux.'),

    M('m15', 'land', 'elise', 'Le commerce marche bien', [
      'Pour accueillir des espèces plus rares, il nous faut des pièces.',
      'Possède 3 commerces : boutiques, snack, restaurant…',
    ], { type: 'own_building', kind: 'coins', count: 3 }, { coins: 1500, xp: 50 },
    'Les caisses sonnent ! Le parc devient une vraie petite entreprise.'),

    M('m16', 'land', 'elise', 'Un appel de la mer', [
      'J’ai reçu un message de mon amie Inès Kerval, biologiste marine.',
      'Elle veut ouvrir un Parc Aquatique avec nous ! Atteins le niveau 5 pour la rejoindre.',
    ], { type: 'player_level', level: 5 }, { coins: 5000, dollars: 5 },
    'Niveau 5 ! Inès t’attend sur la côte. Garde tes pièces pour le nouveau parc !'),

    // ----- Parc Aquatique (Inès, Marco, Élise, Krane) -----
    M('s01', 'sea', 'ines', 'Le grand bleu', [
      'Bonjour ! Inès Kerval. L’océan cache des géants extraordinaires…',
      'Ouvre le menu PARCS et débloque le Parc Aquatique.',
    ], { type: 'unlock_park', park: 'sea' }, { food_sea: 400, xp: 60 },
    'Tu sens les embruns ? Bienvenue dans le Parc Aquatique !'),

    M('s02', 'sea', 'ines', 'Du poisson frais', [
      'Les reptiles marins mangent du poisson. Beaucoup de poisson !',
      'Construis une Ferme à poissons dans le Parc Aquatique.',
    ], { type: 'build', building: 'fish_farm', count: 1 }, { coins: 1000, xp: 30 },
    'Les sardines frétillent déjà. Le grand bleu nous sourit.'),

    M('s03', 'sea', 'ines', 'Premier plongeon', [
      'Notre premier pensionnaire marin ! Je te conseille l’Archélon ou l’Ichthyosaure.',
      'Fais éclore une créature dans le Parc Aquatique.',
    ], { type: 'own_species', park: 'sea', count: 1 }, { food_sea: 300, xp: 50 },
    'Il nage déjà comme un champion ! Regarde toutes ces bulles.'),

    M('s04', 'sea', 'ines', 'Festin sous la mer', [
      'Les bébés marins grandissent vite quand on les nourrit bien.',
      'Nourris tes créatures 10 fois.',
    ], { type: 'feed', count: 10 }, { coins: 1500, food_sea: 300, xp: 40 },
    'Quel appétit ! On dirait une baleine devant un buffet.'),

    M('s05', 'sea', 'elise', 'Première évolution', [
      'Élise au micro ! Inès m’a appelée : une de nos créatures va bientôt évoluer !',
      'Au niveau 10, un bébé devient Juvénile. Fais monter une créature au niveau 10.',
    ], { type: 'creature_level', level: 10 }, { coins: 2500, dollars: 5, xp: 80 },
    'Incroyable ! Plus grande, plus forte… et toujours aussi gourmande.'),

    M('s06', 'sea', 'marco', 'Le récif des champions', [
      'Marco ici ! L’arène du Récif est ouverte.',
      'Sous l’eau, les combats sont coriaces. Gagne 2 combats dans le Parc Aquatique.',
    ], { type: 'win_battle', park: 'sea', count: 2 }, { coins: 2500, dollars: 5, xp: 80 },
    'Tu te bats comme un requin ! Un gentil requin, hein.'),

    M('s07', 'sea', 'ines', 'Le ballet des nageoires', [
      'Plus il y a d’espèces, plus nos visiteurs sont émerveillés.',
      'Possède 3 espèces différentes dans le Parc Aquatique.',
    ], { type: 'own_species', park: 'sea', count: 3 }, { coins: 3000, food_sea: 500, xp: 100 },
    'Regarde-les nager ensemble… On dirait un ballet.'),

    M('s08', 'sea', 'krane', 'Les requins de Krane', [
      'Tiens, tiens… Un parc aquatique ? Le mien a des toboggans en or massif !',
      'Mes champions des mers vont te noyer sous les bulles. Viens à l’étape 4 si tu oses !',
    ], { type: 'battle_stage', park: 'sea', stage: 4 }, { coins: 4000, dollars: 8, xp: 150 },
    'Impossible ! Bon… savoure ta victoire, elle ne durera pas !'),

    M('s09', 'sea', 'ines', 'Message du Grand Nord', [
      'Un pisteur des glaces, Oleg Varga, a trouvé des traces géantes dans la neige.',
      'Il pense que des animaux de l’ère glaciaire peuvent revenir ! Atteins le niveau 10.',
    ], { type: 'player_level', level: 10 }, { coins: 10000, dollars: 10 },
    'Niveau 10 ! Prends ton écharpe : Oleg t’attend dans le Grand Nord.'),

    // ----- Parc Glaciaire (Oleg, Marco, Élise, Krane) -----
    M('g01', 'ice', 'oleg', 'Le Grand Nord', [
      'Hm. Oleg Varga, pisteur. Je parle peu.',
      'Mammouths, tigres à dents de sabre… Ils dorment dans la glace depuis longtemps.',
      'Débloque le Parc Glaciaire dans le menu PARCS.',
    ], { type: 'unlock_park', park: 'ice' }, { food_ice: 400, xp: 120 },
    'Bienvenue. Garde tes mains au chaud.'),

    M('g02', 'ice', 'oleg', 'Réserves d’hiver', [
      'Ici, les créatures mangent de la viande. Il faut des réserves.',
      'Construis une Cabane du pisteur.',
    ], { type: 'build', building: 'hunter_lodge', count: 1 }, { coins: 2000, xp: 50 },
    'Bonne cabane. Solide. Comme moi.'),

    M('g03', 'ice', 'oleg', 'Sous la neige', [
      'J’ai trouvé un œuf de Dodo. Ou de Mégalocéros. Hm.',
      'Fais éclore une créature dans le Parc Glaciaire.',
    ], { type: 'own_species', park: 'ice', count: 1 }, { food_ice: 400, xp: 100 },
    'Il frissonne. Non… il est content. Je crois.'),

    M('g04', 'ice', 'oleg', 'Un peu de chaleur', [
      'Les visiteurs ont froid. Un visiteur gelé ne sourit pas.',
      'Installe 2 braseros dans le Parc Glaciaire.',
    ], { type: 'build', building: 'brazier', count: 2 }, { coins: 2500, xp: 60 },
    'Ça crépite. Les gens sourient. Moi aussi. Un peu.'),

    M('g05', 'ice', 'oleg', 'La meute', [
      'Une meute est plus forte qu’un loup seul.',
      'Au niveau 11 arrivent le Glyptodon et le Loup géant.',
      'Possède 3 espèces différentes dans le Parc Glaciaire.',
    ], { type: 'own_species', park: 'ice', count: 3 }, { coins: 5000, food_ice: 600, xp: 150 },
    'Trois espèces. La toundra revit. C’est beau.'),

    M('g06', 'ice', 'marco', 'Duel sur la glace', [
      'Marco ! Brrr… j’ai oublié mon bonnet.',
      'L’Arène de Glace est prête. Gagne un combat dans le Parc Glaciaire.',
    ], { type: 'win_battle', park: 'ice', count: 1 }, { coins: 4000, dollars: 5, xp: 120 },
    'Victoire ! Bon, je file boire un chocolat chaud.'),

    M('g07', 'ice', 'oleg', 'Dents de sabre', [
      'Le Smilodon. Des canines longues comme ton bras. Hm. Presque.',
      'Au niveau 13, recherche son ADN, fais-le éclore et nourris-le jusqu’au niveau 5.',
    ], { type: 'creature_level', species: 'smilodon', level: 5 }, { coins: 10000, xp: 300 },
    'Il ronronne. Très fort. Ne mets pas ta main devant sa bouche.'),

    M('g08', 'ice', 'elise', 'Le réveil de l’Alpha', [
      'Élise ici ! Au niveau 30, une créature devient Alpha.',
      'Plus grande, plus sombre, avec des cicatrices de combat et un marquage qui brille !',
      'Fais monter une créature au niveau 30.',
    ], { type: 'creature_level', level: 30 }, { coins: 15000, dollars: 15, xp: 500 },
    'Un Alpha ! Regarde ce marquage lumineux… C’est magnifique.'),

    M('g09', 'ice', 'krane', 'La revanche de Krane', [
      'Assez joué ! Mon armée des glaces t’attend à l’étape 8 de l’Arène de Glace.',
      'Si tu gagnes, j’avouerai que Crétacé Park est le meilleur parc du monde.',
      'Ha ! Ça n’arrivera jamais !',
    ], { type: 'battle_stage', park: 'ice', stage: 8 }, { coins: 30000, dollars: 30, xp: 800 },
    'Bon… d’accord. Ton parc est le meilleur. Mais j’ai des Mythiques : rendez-vous à la grande finale !'),
  ];

  // ---------------------------------------------------------------------------
  // Tournament stages (enemies only from that park)
  // ---------------------------------------------------------------------------
  /** T(stage, name, opponent, suggested player level, [[species, level], ...], reward).
      `level` is only a hint for the UI (« Niveau conseillé »); stages unlock in order. */
  const T = (stage, name, opponent, level, enemies, reward) => ({
    stage, name, opponent, level, enemies: enemies.map(e => ({ species: e[0], level: e[1] })), reward,
  });

  DATA.BATTLE_STAGES = {
    land: [
      T(1, 'Premier combat', 'tom', 2, [['gallimimus', 1]], { coins: 400, xp: 15 }),
      T(2, 'L’apprenti ranger', 'tom', 2, [['stegosaurus', 7], ['gallimimus', 7]], { coins: 400, xp: 15 }),
      T(3, 'Le Club des Griffes', 'lea', 3, [['gallimimus', 9], ['parasaurolophus', 9]], { coins: 800, xp: 25, dollars: 2 }),
      T(4, 'Griffes affûtées', 'lea', 3, [['triceratops', 6], ['velociraptor', 5]], { coins: 800, xp: 25 }),
      T(5, 'Le défi de Krane', 'krane', 4, [['velociraptor', 6], ['ankylosaurus', 5], ['gallimimus', 6]], { coins: 1800, xp: 60, dollars: 5 }),
      T(6, 'La Brigade des Volcans', 'amara', 5, [['parasaurolophus', 9], ['ankylosaurus', 8], ['dilophosaurus', 8]], { coins: 1700, xp: 55, dollars: 3 }),
      T(7, 'Coulée de lave', 'amara', 6, [['pteranodon', 9], ['ankylosaurus', 9], ['brachiosaurus', 8]], { coins: 2200, xp: 75 }),
      T(8, 'Examen de ranger', 'marco', 6, [['dilophosaurus', 12], ['brachiosaurus', 11], ['triceratops', 12]], { coins: 2200, xp: 75 }),
      T(9, 'Revanche griffue', 'lea', 7, [['velociraptor', 13], ['pachycephalosaurus', 12], ['dilophosaurus', 12]], { coins: 2800, xp: 95, dollars: 3 }),
      T(10, 'Krane contre-attaque', 'krane', 8, [['carnotaurus', 7], ['brachiosaurus', 10], ['pachycephalosaurus', 10]], { coins: 5100, xp: 170, dollars: 8 }),
      T(11, 'Le sentier des géants', 'amara', 9, [['diplodocus', 10], ['pteranodon', 12], ['ankylosaurus', 13]], { coins: 4050, xp: 135 }),
      T(12, 'Tempête de plumes', 'lea', 10, [['carnotaurus', 14], ['velociraptor', 16], ['pachycephalosaurus', 16]], { coins: 4750, xp: 160, dollars: 4 }),
      T(13, 'La crête du volcan', 'amara', 11, [['spinosaurus', 12], ['diplodocus', 13], ['ankylosaurus', 16]], { coins: 5450, xp: 180 }),
      T(14, 'Le grand examen', 'marco', 12, [['styracosaurus', 14], ['carnotaurus', 15], ['brachiosaurus', 17]], { coins: 6250, xp: 210 }),
      T(15, 'L’armée de Dinoworld', 'krane', 13, [['allosaurus', 12], ['spinosaurus', 13], ['styracosaurus', 13]], { coins: 10550, xp: 350, dollars: 12 }),
      T(16, 'Les crocs du Club', 'lea', 14, [['tyrannosaurus', 9], ['allosaurus', 13], ['diplodocus', 14]], { coins: 7850, xp: 260 }),
      T(17, 'Éruption', 'amara', 15, [['tyrannosaurus', 12], ['styracosaurus', 15], ['diplodocus', 15]], { coins: 8700, xp: 290 }),
      T(18, 'Les maîtres rangers', 'marco', 17, [['tyrannosaurus', 17], ['spinosaurus', 18], ['styracosaurus', 18]], { coins: 10500, xp: 350, dollars: 5 }),
      T(19, 'Avant la finale', 'lea', 19, [['giganotosaurus', 20], ['allosaurus', 23], ['styracosaurus', 23]], { coins: 12400, xp: 415 }),
      T(20, 'La grande finale', 'krane', 21, [['titanosaurus', 13], ['giganotosaurus', 16], ['tyrannosaurus', 18]], { coins: 21650, xp: 720, dollars: 20 }),
    ],
    sea: [
      T(1, 'Baptême de plongée', 'ines', 5, [['ichthyosaurus', 1]], { coins: 1700, xp: 55 }),
      T(2, 'Vagues et écume', 'nina', 6, [['ichthyosaurus', 5], ['archelon', 5]], { coins: 2200, xp: 75 }),
      T(3, 'Le récif de corail', 'nina', 6, [['archelon', 8]], { coins: 2200, xp: 75, dollars: 3 }),
      T(4, 'Les requins de Krane', 'krane', 7, [['dunkleosteus', 4], ['plesiosaurus', 3], ['ichthyosaurus', 7]], { coins: 4150, xp: 140, dollars: 5 }),
      T(5, 'Courants profonds', 'nina', 8, [['tylosaurus', 5], ['plesiosaurus', 5], ['archelon', 8]], { coins: 3400, xp: 115 }),
      T(6, 'La fosse obscure', 'ines', 9, [['tylosaurus', 7], ['dunkleosteus', 7], ['plesiosaurus', 7]], { coins: 4050, xp: 135, dollars: 3 }),
      T(7, 'Le grand requin', 'nina', 10, [['megalodon', 2], ['plesiosaurus', 6], ['dunkleosteus', 6]], { coins: 4750, xp: 160 }),
      T(8, 'Les monstres de Krane', 'krane', 11, [['elasmosaurus', 4], ['megalodon', 4], ['tylosaurus', 8]], { coins: 8200, xp: 275, dollars: 8 }),
      T(9, 'Les géants des abysses', 'nina', 12, [['liopleurodon', 6], ['elasmosaurus', 6], ['dunkleosteus', 10]], { coins: 6250, xp: 210, dollars: 4 }),
      T(10, 'Tempête en haute mer', 'ines', 14, [['shonisaurus', 8], ['liopleurodon', 8], ['megalodon', 8]], { coins: 7850, xp: 260 }),
      T(11, 'Le roi des mers', 'nina', 16, [['mosasaurus', 7], ['elasmosaurus', 10], ['liopleurodon', 10]], { coins: 9600, xp: 320 }),
      T(12, 'Le Léviathan de Krane', 'krane', 18, [['mosasaurus', 12], ['megalodon', 14], ['shonisaurus', 14]], { coins: 17200, xp: 575, dollars: 12 }),
    ],
    ice: [
      T(1, 'Premiers pas dans la neige', 'oleg', 10, [['dodo', 1]], { coins: 4750, xp: 160 }),
      T(2, 'La piste des traîneaux', 'bjorn', 11, [['megaloceros', 12], ['dodo', 12]], { coins: 5450, xp: 180 }),
      T(3, 'Le hurlement du loup', 'bjorn', 11, [['direwolf', 7], ['glyptodon', 7]], { coins: 5450, xp: 180, dollars: 4 }),
      T(4, 'Le blizzard de Krane', 'krane', 12, [['woollyrhino', 9], ['direwolf', 9], ['megaloceros', 10]], { coins: 9350, xp: 310, dollars: 5 }),
      T(5, 'Le col gelé', 'bjorn', 13, [['smilodon', 9], ['glyptodon', 11], ['dodo', 12]], { coins: 7050, xp: 235 }),
      T(6, 'La grotte de l’ours', 'oleg', 14, [['megatherium', 10], ['woollyrhino', 11], ['direwolf', 11]], { coins: 7850, xp: 260, dollars: 4 }),
      T(7, 'Aurores boréales', 'bjorn', 15, [['arctodus', 12], ['smilodon', 13], ['glyptodon', 14]], { coins: 8700, xp: 290 }),
      T(8, 'Avalanche de Krane', 'krane', 16, [['mammoth', 8], ['arctodus', 11], ['woollyrhino', 12]], { coins: 14400, xp: 480, dollars: 8 }),
      T(9, 'La toundra infinie', 'bjorn', 17, [['megatherium', 19], ['smilodon', 19], ['woollyrhino', 21]], { coins: 10500, xp: 350, dollars: 5 }),
      T(10, 'Le glacier éternel', 'oleg', 19, [['mammoth', 24], ['arctodus', 26], ['megaloceros', 28]], { coins: 12400, xp: 415 }),
      T(11, 'La meute royale', 'bjorn', 21, [['mammoth', 32], ['smilodon', 34], ['direwolf', 36]], { coins: 14450, xp: 480 }),
      T(12, 'Le Grand Tournoi', 'krane', 24, [['glacimammoth', 20], ['mammoth', 25], ['arctodus', 25]], { coins: 26450, xp: 880, dollars: 12 }),
    ],
  };

  // ---------------------------------------------------------------------------
  // Loading-screen tips
  // ---------------------------------------------------------------------------
  DATA.TIPS = [
    'Nourris tes créatures pour les faire monter de niveau : elles rapporteront plus de pièces.',
    'Au niveau 10, un bébé devient Juvénile. Au niveau 20, Adulte. Au niveau 30… Alpha !',
    'Les Blindés sont forts contre les Chasseurs, les Chasseurs contre les Colosses, les Colosses contre les Blindés.',
    'Une recherche ADN se fait en plusieurs étapes. Si une étape échoue, tu peux réessayer pour 1 dollar.',
    'Active tes fermes : une petite livraison est rapide, une grosse livraison dure plus longtemps.',
    'Ouvre un paquet de CARTES gratuit toutes les 10 minutes.',
    'Les décorations rendent ton parc plus joli et te donnent de l’expérience.',
    'Le Parc Aquatique se débloque au niveau 5, le Parc Glaciaire au niveau 10.',
    'Tes créatures gagnent des pièces même quand le jeu est fermé (jusqu’à 1 heure).',
    'En tournoi, la jauge SPÉCIALE se remplit à chaque coup donné ou reçu.',
    'Une attaque SPÉCIALE ne rate jamais et frappe presque deux fois plus fort !',
    'Tu peux changer de créature pendant un combat, mais cela te coûte ton tour.',
    'Améliore tes bâtiments : chaque niveau augmente leur production.',
    'Une expédition ADN peut te rapporter de l’ambre : la recherche est alors terminée d’un coup !',
    'Chaque espèce ne peut être créée qu’une seule fois. Fais-la grandir avec amour !',
    'Gagne les médailles Bronze, Argent et Or de chaque étape du tournoi.',
    'Utilise les dollars pour accélérer une éclosion ou une livraison.',
    'Les routes ne rapportent rien, mais elles rendent le parc bien plus joli !',
    'Une créature Alpha a des couleurs plus sombres, des cicatrices et un marquage lumineux.',
    'Le mode AUTO laisse ton équipe combattre toute seule.',
    'Surveille la boutique : des offres limitées proposent des créatures rares !',
  ];

  // ---------------------------------------------------------------------------
  // Card packs ("CARTES / COLLECTER")
  // reward keys: coins, dollars, xp, food_land/food_sea/food_ice.
  // Cards with `park` give that park's food: the engine should skip them while the park is locked.
  // ---------------------------------------------------------------------------
  DATA.CARDS = {
    freeEverySec: 600,
    perPack: 3,
    packCost: { dollars: 10 },
    table: [
      { weight: 24, reward: { coins: 400 }, label: '400 pièces', rarity: 'commun' },
      { weight: 20, reward: { food_land: 300 }, label: '300 nourriture', rarity: 'commun', park: 'land' },
      { weight: 12, reward: { food_sea: 300 }, label: '300 poissons', rarity: 'commun', park: 'sea' },
      { weight: 10, reward: { food_ice: 300 }, label: '300 viandes', rarity: 'commun', park: 'ice' },
      { weight: 14, reward: { xp: 60 }, label: '60 XP', rarity: 'commun' },
      { weight: 10, reward: { coins: 1500 }, label: '1 500 pièces', rarity: 'rare' },
      { weight: 7, reward: { food_land: 1000 }, label: '1 000 nourriture', rarity: 'rare', park: 'land' },
      { weight: 5, reward: { food_sea: 1000 }, label: '1 000 poissons', rarity: 'rare', park: 'sea' },
      { weight: 4, reward: { food_ice: 1000 }, label: '1 000 viandes', rarity: 'rare', park: 'ice' },
      { weight: 6, reward: { dollars: 2 }, label: '2 dollars', rarity: 'rare' },
      { weight: 5, reward: { xp: 250 }, label: '250 XP', rarity: 'rare' },
      { weight: 3, reward: { coins: 5000 }, label: '5 000 pièces', rarity: 'super' },
      { weight: 2, reward: { dollars: 5 }, label: '5 dollars', rarity: 'super' },
      { weight: 1, reward: { coins: 15000, dollars: 10 }, label: 'Jackpot ! 15 000 pièces + 10 dollars', rarity: 'legendaire' },
    ],
  };
})(window.PC = window.PC || {});
