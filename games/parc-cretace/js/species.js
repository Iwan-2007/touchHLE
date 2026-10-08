/* Parc Crétacé — species table, rarities, classes and growth formulas.
   Shared by every module. Owned by the lead; other modules read it, never edit it. */
(function (PC) {
  'use strict';

  PC.MAX_LEVEL = 40;

  PC.RARITY = {
    commun:     { name: 'Ordinaire',  color: '#9aa3a8', frame: '#6f777c', hp: 320,  atkMin: 30,  atkMax: 75,  cpm: 30,  feedBase: 25,  xpHatch: 40 },
    rare:       { name: 'Rare',       color: '#4f9fe0', frame: '#2c6aa3', hp: 520,  atkMin: 50,  atkMax: 120, cpm: 70,  feedBase: 50,  xpHatch: 120 },
    super:      { name: 'Épique',     color: '#b06ae0', frame: '#7a3fa8', hp: 820,  atkMin: 80,  atkMax: 190, cpm: 160, feedBase: 100, xpHatch: 350 },
    legendaire: { name: 'Légendaire', color: '#f0b030', frame: '#b07a12', hp: 1250, atkMin: 130, atkMax: 300, cpm: 400, feedBase: 200, xpHatch: 1000 },
    mythique:   { name: 'Mythique',   color: '#ff3b6b', frame: '#a3122d', hp: 1900, atkMin: 200, atkMax: 460, cpm: 900, feedBase: 400, xpHatch: 2500 },
  };
  /** Rarity keys from weakest to strongest (key 'super' is displayed as « Épique »). */
  PC.RARITY_ORDER = ['commun', 'rare', 'super', 'legendaire', 'mythique'];

  // Rock-paper-scissors: each class deals +25 % to the class it beats and −20 % to the class that beats it.
  PC.CLASSES = {
    chasseur: { name: 'Chasseur', beats: 'colosse',  color: '#e0553a', hp: 0.9,  atk: 1.2,  desc: 'Rapide et féroce. Fort contre les Colosses.' },
    colosse:  { name: 'Colosse',  beats: 'blinde',   color: '#5fae4a', hp: 1.3,  atk: 0.9,  desc: 'Énorme et résistant. Fort contre les Blindés.' },
    blinde:   { name: 'Blindé',   beats: 'chasseur', color: '#4f8fd0', hp: 1.15, atk: 0.95, desc: 'Cuirasse, cornes ou carapace. Fort contre les Chasseurs.' },
  };

  PC.SPECIES = {};
  PC.SPECIES_ORDER = { land: [], sea: [], ice: [] };

  let seed = 1;
  // S(id, name, park, art, features, rarity, cls, level, research, coins, hatchSec, [body, belly, accent], pattern, size, desc)
  function S(id, name, park, art, features, rarity, cls, level, research, coins, hatchSec, col, pattern, size, desc, extra) {
    PC.SPECIES[id] = {
      id, name, park, art, features, rarity, cls, level,
      research: research ? { cost: research[0], chance: research[1] } : null,
      price: { coins },
      hatchSec, colors: { body: col[0], belly: col[1], accent: col[2] },
      pattern, size, desc, seed: seed++,
      mod: 0.9 + level * 0.015,
    };
    if (extra) Object.assign(PC.SPECIES[id], extra);
    PC.SPECIES_ORDER[park].push(id);
  }

  // ---------- Parc Terrestre ----------
  S('triceratops', 'Tricératops', 'land', 'ceratopsian', ['three_horns', 'frill'], 'commun', 'blinde', 1, null, 1500, 20,
    ['#8f6a4a', '#d8c3a0', '#c0503a'], 'stripes', 1.0, 'Trois cornes et une collerette osseuse : il charge sans hésiter.');
  S('stegosaurus', 'Stégosaure', 'land', 'stegosaur', ['plates', 'thagomizer'], 'commun', 'blinde', 1, null, 1200, 15,
    ['#7d8f4a', '#cfc68a', '#c96a3a'], 'none', 1.0, 'Ses plaques dorsales régulent sa température, sa queue à pointes repousse les prédateurs.');
  S('gallimimus', 'Gallimimus', 'land', 'ornithomimid', [], 'commun', 'chasseur', 2, null, 900, 15,
    ['#b5915c', '#eadbb8', '#7a5a3a'], 'stripes', 0.8, 'Le coureur le plus rapide du parc. Il se déplace toujours en troupeau.');
  S('parasaurolophus', 'Parasaurolophus', 'land', 'hadrosaur', ['crest_tube'], 'commun', 'colosse', 2, null, 2000, 25,
    ['#6f8a6a', '#d7d1a8', '#c45a3a'], 'stripes', 1.0, 'Sa crête creuse produit un appel grave qui porte à des kilomètres.');
  S('velociraptor', 'Vélociraptor', 'land', 'theropod', ['small', 'feathers'], 'rare', 'chasseur', 3, [3000, 60], 4000, 40,
    ['#a8784a', '#e3cfa6', '#5a3d24'], 'stripes', 0.7, 'Petit, intelligent et redoutable avec sa griffe en faucille.');
  S('ankylosaurus', 'Ankylosaure', 'land', 'ankylosaur', ['club_tail'], 'rare', 'blinde', 4, null, 5000, 45,
    ['#8a7a5a', '#c9b98f', '#5e4b33'], 'spots', 1.0, 'Un vrai tank vivant, armé d’une massue au bout de la queue.');
  S('dilophosaurus', 'Dilophosaure', 'land', 'theropod', ['double_crest', 'frill_neck'], 'rare', 'chasseur', 5, [5000, 55], 6000, 50,
    ['#6e8f4e', '#d6d29a', '#d9a33a'], 'spots', 0.85, 'Deux crêtes fines sur la tête et une collerette qu’il déploie pour impressionner.');
  S('pteranodon', 'Ptéranodon', 'land', 'pterosaur', ['head_crest'], 'rare', 'chasseur', 6, [6000, 50], 7500, 60,
    ['#9a8f84', '#e4dccd', '#c2452f'], 'none', 0.9, 'Un reptile volant de plus de 6 mètres d’envergure.');
  S('brachiosaurus', 'Brachiosaure', 'land', 'sauropod', ['high_neck'], 'rare', 'colosse', 6, null, 9000, 75,
    ['#7c8f94', '#c8d2cc', '#5b6e78'], 'spots', 1.5, 'Son cou lui permet de brouter la cime des arbres à 13 mètres.');
  S('pachycephalosaurus', 'Pachycéphalosaure', 'land', 'pachy', ['dome'], 'rare', 'blinde', 7, null, 8000, 60,
    ['#9a7650', '#e0c9a0', '#6b4a2c'], 'spots', 0.85, 'Son crâne en dôme fait 25 cm d’épaisseur. Gare aux coups de tête !');
  S('carnotaurus', 'Carnotaurus', 'land', 'theropod', ['bull_horns'], 'super', 'chasseur', 8, [12000, 45], 15000, 120,
    ['#9a4a36', '#dcae8a', '#3e2a22'], 'spots', 1.1, 'Le « taureau carnivore » : deux cornes au-dessus des yeux et des bras minuscules.');
  S('diplodocus', 'Diplodocus', 'land', 'sauropod', ['long_low_neck'], 'super', 'colosse', 9, null, 18000, 120,
    ['#8a7d62', '#d6ccad', '#5c5240'], 'stripes', 1.6, 'Plus de 25 mètres de long, dont une queue en fouet.');
  S('spinosaurus', 'Spinosaure', 'land', 'theropod', ['sail', 'croc_snout'], 'super', 'chasseur', 10, [20000, 40], 25000, 180,
    ['#5f6e5a', '#c9c09a', '#b0472f'], 'stripes', 1.4, 'Le plus long des carnivores, avec une voile dorsale et un museau de crocodile.');
  S('styracosaurus', 'Styracosaure', 'land', 'ceratopsian', ['spiked_frill', 'nose_horn'], 'super', 'blinde', 11, [18000, 45], 22000, 150,
    ['#a26b3f', '#e2c79c', '#3f6d8a'], 'none', 1.0, 'Sa collerette est hérissée de longues pointes.');
  S('allosaurus', 'Allosaure', 'land', 'theropod', ['brow_horns'], 'super', 'chasseur', 12, null, 30000, 200,
    ['#8c6b4b', '#dcc4a0', '#a84433'], 'stripes', 1.2, 'Le grand prédateur du Jurassique, reconnaissable à ses petites cornes.');
  S('tyrannosaurus', 'Tyrannosaure', 'land', 'theropod', ['big_head'], 'legendaire', 'chasseur', 14, [40000, 35], 60000, 300,
    ['#6b5a48', '#b9a184', '#3a2c22'], 'stripes', 1.5, 'Le roi des dinosaures. Sa morsure est la plus puissante de tous les animaux terrestres.');
  S('tapejara', 'Tapejara', 'land', 'pterosaur', ['head_crest', 'sail_crest'], 'super', 'chasseur', 9, null, 0, 150,
    ['#5b6f8a', '#e8e0d0', '#e0452f'], 'none', 0.85, 'Un ptérosaure à l’immense crête colorée. Disponible seulement en offre limitée !',
    { offerOnly: true, price: { dollars: 120 } });
  S('giganotosaurus', 'Giganotosaure', 'land', 'theropod', ['big_head', 'brow_ridge'], 'legendaire', 'chasseur', 18, [60000, 30], 90000, 420,
    ['#7a7066', '#c4b7a5', '#8a3a2a'], 'spots', 1.6, 'Encore plus long que le Tyrannosaure. Le géant d’Amérique du Sud.');

  S('titanosaurus', 'Titanosaure', 'land', 'sauropod', ['long_low_neck', 'giant'], 'mythique', 'colosse', 20, [120000, 25], 200000, 900,
    ['#6f6a5c', '#d8cfb6', '#3fb0a0'], 'spots', 1.9, 'Le plus grand animal ayant jamais marché sur Terre : 37 mètres et 70 tonnes.');
  S('volcanorex', 'Rex Volcanique', 'land', 'theropod', ['big_head', 'brow_ridge', 'lava'], 'mythique', 'chasseur', 24, [150000, 20], 260000, 1200,
    ['#2e2724', '#4a3b32', '#ff6a1a'], 'stripes', 1.6, 'Une légende du parc : sa peau sombre est parcourue de fissures de lave incandescente.');

  // ---------- Parc Aquatique ----------
  S('archelon', 'Archélon', 'sea', 'turtle', [], 'commun', 'blinde', 5, null, 3000, 30,
    ['#5f7d6a', '#d8cfa8', '#3d5547'], 'spots', 1.0, 'Une tortue marine géante de 4 mètres de long.');
  S('ichthyosaurus', 'Ichthyosaure', 'sea', 'ichthyosaur', [], 'commun', 'chasseur', 5, null, 3500, 30,
    ['#4f6f8f', '#d6e2e8', '#2c435a'], 'none', 0.9, 'Un reptile en forme de dauphin, avec des yeux immenses.');
  S('dunkleosteus', 'Dunkleosteus', 'sea', 'armoredfish', [], 'rare', 'blinde', 6, [6000, 55], 8000, 60,
    ['#6c6f73', '#c9c3b4', '#3b3d40'], 'spots', 1.1, 'Un poisson cuirassé dont les mâchoires sont des lames d’os.');
  S('plesiosaurus', 'Plésiosaure', 'sea', 'plesiosaur', [], 'rare', 'colosse', 7, null, 10000, 80,
    ['#557a7d', '#d4e0d6', '#2f4d50'], 'spots', 1.1, 'Quatre grandes nageoires et un long cou souple.');
  S('tylosaurus', 'Tylosaure', 'sea', 'mosasaur', ['long_snout'], 'rare', 'chasseur', 8, [10000, 50], 14000, 100,
    ['#4a6a5e', '#d9d8bf', '#24392f'], 'stripes', 1.2, 'Un mosasaure au museau renforcé qui assomme ses proies.');
  S('megalodon', 'Mégalodon', 'sea', 'shark', [], 'super', 'chasseur', 10, [22000, 40], 28000, 200,
    ['#6a7d8c', '#e6ebee', '#3d4b56'], 'none', 1.5, 'Le plus grand requin ayant jamais existé. Des dents grandes comme une main.');
  S('elasmosaurus', 'Élasmosaure', 'sea', 'plesiosaur', ['very_long_neck'], 'super', 'colosse', 11, null, 26000, 180,
    ['#6d8a6e', '#e0e6cf', '#3f5a42'], 'stripes', 1.3, 'Son cou compte plus de 70 vertèbres.');
  S('liopleurodon', 'Liopleurodon', 'sea', 'pliosaur', [], 'super', 'chasseur', 12, [30000, 40], 35000, 240,
    ['#3f5568', '#c7d3d6', '#1f2c38'], 'spots', 1.4, 'Une tête énorme et des mâchoires puissantes : le tyran des mers jurassiques.');
  S('shonisaurus', 'Shonisaure', 'sea', 'ichthyosaur', ['giant'], 'super', 'colosse', 13, null, 40000, 260,
    ['#5d6f85', '#dfe6ea', '#36435a'], 'none', 1.6, 'Un ichthyosaure géant de 15 mètres.');
  S('mosasaurus', 'Mosasaure', 'sea', 'mosasaur', ['big', 'frill_back'], 'legendaire', 'chasseur', 15, [70000, 30], 100000, 480,
    ['#3d5a5f', '#e3e0c8', '#1e2f33'], 'stripes', 1.8, 'Le monstre des océans du Crétacé. Il avale tout ce qui passe.');

  S('abyssosaurus', 'Mosasaure des Abysses', 'sea', 'mosasaur', ['big', 'frill_back', 'glow'], 'mythique', 'chasseur', 22, [160000, 20], 280000, 1200,
    ['#1d2a44', '#5f7aa0', '#36e0ff'], 'spots', 2.0, 'Venu des grands fonds, ses taches lumineuses éclairent l’océan noir.');

  // ---------- Parc Glaciaire ----------
  S('dodo', 'Dodo', 'ice', 'bird', [], 'commun', 'blinde', 10, null, 4000, 30,
    ['#8a8f96', '#d8d2c4', '#d9b13a'], 'none', 0.6, 'Un gros oiseau qui ne vole pas, curieux et pas du tout farouche.');
  S('megaloceros', 'Mégalocéros', 'ice', 'deer', ['antlers'], 'commun', 'colosse', 10, null, 6000, 45,
    ['#8b6a48', '#d8c09c', '#e8dcc4'], 'none', 1.1, 'Le cerf géant : ses bois mesurent jusqu’à 3,6 mètres d’envergure.');
  S('glyptodon', 'Glyptodon', 'ice', 'glyptodon', [], 'rare', 'blinde', 11, null, 9000, 70,
    ['#7d6a50', '#bfae8c', '#4e4030'], 'spots', 1.0, 'Un tatou de la taille d’une voiture, protégé par une carapace en mosaïque.');
  S('direwolf', 'Loup géant', 'ice', 'wolf', [], 'rare', 'chasseur', 11, [9000, 55], 12000, 80,
    ['#8c8c88', '#e6e2d8', '#4a4a48'], 'none', 0.85, 'Plus massif que le loup gris, il chasse en meute dans la neige.');
  S('woollyrhino', 'Rhinocéros laineux', 'ice', 'rhino', [], 'rare', 'blinde', 12, null, 16000, 110,
    ['#7a5f45', '#b89c7a', '#e6dcc6'], 'none', 1.2, 'Une épaisse fourrure et une corne avant d’un mètre de long.');
  S('smilodon', 'Smilodon', 'ice', 'cat', ['sabers'], 'super', 'chasseur', 13, [20000, 45], 26000, 180,
    ['#b08a5a', '#ead9b8', '#6a4a2a'], 'spots', 1.0, 'Le tigre à dents de sabre : des canines de 28 cm.');
  S('megatherium', 'Mégathérium', 'ice', 'sloth', [], 'super', 'colosse', 14, null, 30000, 200,
    ['#7a6650', '#b8a48a', '#4a3b2c'], 'none', 1.5, 'Un paresseux géant qui se dresse à 4 mètres pour atteindre les feuilles.');
  S('arctodus', 'Arctodus', 'ice', 'bear', [], 'super', 'chasseur', 15, [34000, 40], 40000, 240,
    ['#6b4e36', '#a8896a', '#3a2a1e'], 'none', 1.3, 'L’ours à face courte, debout il dépasse 3 mètres.');
  S('mammoth', 'Mammouth laineux', 'ice', 'elephant', ['tusks', 'wool'], 'legendaire', 'colosse', 16, [70000, 30], 110000, 480,
    ['#6b4a32', '#a17f60', '#efe6d2'], 'none', 1.8, 'Le géant de l’ère glaciaire, avec ses défenses recourbées de 4 mètres.');

  S('glacimammoth', 'Mammouth des Glaces Éternelles', 'ice', 'elephant', ['tusks', 'wool', 'frost'], 'mythique', 'colosse', 24, [170000, 20], 300000, 1200,
    ['#dfe8ee', '#a9c2d4', '#5fd8ff'], 'none', 2.0, 'Un mammouth géant couvert de givre, dont les défenses brillent comme de la glace.');

  /** Stats of a creature of species `id` at `level` (1..40). */
  PC.statsAt = function (id, level) {
    const sp = PC.SPECIES[id], r = PC.RARITY[sp.rarity], c = PC.CLASSES[sp.cls];
    const L = Math.max(1, Math.min(PC.MAX_LEVEL, level | 0));
    const m = 1 + (L - 1) * 0.075;
    return {
      level: L,
      hp: Math.round(r.hp * c.hp * sp.mod * m),
      atkMin: Math.round(r.atkMin * c.atk * sp.mod * m),
      atkMax: Math.round(r.atkMax * c.atk * sp.mod * m),
      coinsPerMin: Math.round(r.cpm * sp.mod * (1 + (L - 1) * 0.08)),
      feedCost: Math.round(r.feedBase * (1 + (L - 1) * 0.22)),
      feedsToLevel: L < 10 ? 3 : L < 20 ? 4 : L < 30 ? 5 : 6,
    };
  };

  /** Growth stage 0..3 (bébé, juvénile, adulte, alpha) for a creature level. */
  PC.stageForLevel = l => (l >= 30 ? 3 : l >= 20 ? 2 : l >= 10 ? 1 : 0);
  PC.STAGE_NAMES = ['Bébé', 'Juvénile', 'Adulte', 'Alpha'];
  PC.STAGE_GROWTH = [0.55, 0.7, 0.85, 1];

  /** Battle damage multiplier when `atkCls` hits `defCls`. */
  PC.classMult = (atkCls, defCls) => (PC.CLASSES[atkCls].beats === defCls ? 1.25 : PC.CLASSES[defCls].beats === atkCls ? 0.8 : 1);
})(window.PC = window.PC || {});
