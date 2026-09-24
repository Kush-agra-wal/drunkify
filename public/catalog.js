// Types are [name, abv%, default ml?]; sizes are [ml, label].
const beers = [
  ['Lager (house)', 5, 500], ['Pilsner (house)', 4.8, 500], ['Wheat beer (house)', 5.2, 500], ['IPA (craft)', 6.5, 330],
  ['Pale Ale (craft)', 5.2, 330], ['Stout (house)', 4.5, 568], ['Porter', 5.5, 500], ['Dark lager', 4.8, 500],
  ['Sour (craft)', 4.5, 330], ['Radler / Shandy', 2.5, 500], ['Alcohol-free beer', 0.5, 330],
  ['Pilsner Urquell', 4.4, 500], ['Kozel', 4, 500], ['Staropramen', 5, 500], ['Budweiser Budvar', 5, 500],
  ['Heineken', 5, 330], ['Amstel', 5, 330], ['Grolsch', 5, 330], ['Budweiser', 5, 330], ['Bud Light', 4.2, 355],
  ['Coors Light', 4.2, 355], ['Miller Lite', 4.2, 355], ['Michelob Ultra', 4.2, 355], ['Blue Moon', 5.4, 355],
  ['Samuel Adams', 5, 355], ['Sierra Nevada Pale Ale', 5.6, 355], ['Stella Artois', 5, 330], ['Leffe Blonde', 6.6, 330],
  ['Duvel', 8.5, 330], ['Chimay Blue', 9, 330], ['Hoegaarden', 4.9, 330], ['Guinness', 4.2, 568], ['Murphy\'s', 4, 568],
  ['Kilkenny', 4.3, 568], ['Carlsberg', 5, 330], ['Tuborg', 4.6, 330], ['Paulaner', 5.5, 500],
  ['Paulaner Weissbier', 5.5, 500], ['Erdinger', 5.3, 500], ['Augustiner', 5.2, 500], ['Löwenbräu', 5.2, 500],
  ['Spaten', 5.2, 500], ['Weihenstephaner', 5.4, 500], ['Warsteiner', 4.8, 500], ['Krombacher', 4.8, 500],
  ['Bitburger', 4.8, 330], ['Beck\'s', 4.9, 330], ['Radeberger', 4.8, 500], ['Gösser', 5.2, 500], ['Stiegl', 5, 500],
  ['Peroni', 5.1, 330], ['Moretti', 4.6, 330], ['Menabrea', 4.8, 330], ['Estrella Damm', 5.4, 330],
  ['Estrella Galicia', 5.5, 330], ['Mahou', 5.5, 330], ['San Miguel', 5.4, 330], ['Alhambra', 5.4, 330],
  ['Cruzcampo', 4.8, 330], ['Sagres', 5, 330], ['Super Bock', 5.2, 330], ['Kronenbourg 1664', 5.5, 330],
  ['Mythos', 4.7, 330], ['Efes', 5, 500], ['Żywiec', 5.6, 500], ['Tyskie', 5.2, 500], ['Lech', 5.2, 500],
  ['Dreher', 5.2, 500], ['Ursus', 5, 500], ['Zagorka', 5, 500], ['Karlovačko', 5.4, 500], ['Laško', 4.9, 500],
  ['Jelen', 5, 500], ['Švyturys', 5, 500], ['Aldaris', 5, 500], ['Saku', 5.2, 500], ['Baltika 7', 5.4, 500],
  ['Carling', 4, 568], ['Foster\'s', 4, 568], ['Newcastle Brown', 4.7, 568], ['Old Speckled Hen', 5, 500],
  ['Brewdog Punk IPA', 5.4, 330], ['Corona', 4.5, 355], ['Modelo Especial', 4.4, 355], ['Pacifico', 4.5, 355],
  ['Dos Equis', 4.2, 355], ['Sol', 4.5, 330], ['Tecate', 4.5, 355], ['Brahma', 4.8, 355], ['Quilmes', 4.9, 330],
  ['Asahi', 5, 330], ['Sapporo', 5, 330], ['Kirin Ichiban', 5, 330], ['Suntory Premium Malt\'s', 5.5, 330],
  ['Orion', 5, 330], ['Tsingtao', 4.7, 330], ['Snow', 4, 330], ['Harbin', 3.6, 330], ['Cass', 4.5, 355],
  ['Hite', 4.3, 355], ['Terra', 4.6, 355], ['Tiger', 5, 330], ['Chang', 5, 320], ['Leo', 5, 320],
  ['Singha', 5, 330], ['Beer Lao', 5, 330], ['Bintang', 4.7, 330], ['San Miguel Pale Pilsen', 5, 330],
  ['Saigon Special', 4.9, 330], ['Bia Hà Nội', 4.6, 330], ['333', 5.3, 330], ['Angkor', 5, 330],
  ['Kingfisher', 4.8, 650], ['Kingfisher Ultra', 5, 330], ['Kingfisher Strong', 8, 650], ['Bira 91 White', 4.9, 330],
  ['Bira 91 Blonde', 4.9, 330], ['Simba', 5, 330], ['Hoegaarden (India)', 4.9, 330], ['Godfather', 7.5, 650],
  ['Haywards 5000', 7, 650], ['Budweiser Magnum', 7.5, 650], ['Tuborg Strong', 8, 650], ['Carlsberg Elephant', 7.2, 500],
  ['Kalyani Black Label', 8, 650], ['White Owl', 4.8, 330], ['Goa Brewing Co.', 5, 330], ['Kati Patang', 5.5, 330],
  ['Cobra', 4.5, 330], ['Efes Pilsen', 5, 500], ['Almaza', 4.2, 330], ['Castle Lager', 5, 340], ['Tusker', 4.2, 500],
  ['Star', 5.1, 600], ['Victoria Bitter', 4.9, 375], ['XXXX Gold', 3.5, 375], ['Carlton Draught', 4.6, 375],
  ['Great Northern', 4.2, 375], ['Steinlager', 5, 330], ['Molson Canadian', 5, 341],
];
const wines = [
  ['Red wine', 13.5], ['White wine', 12.5], ['Rosé', 12], ['Prosecco', 11, 125], ['Champagne', 12, 125],
  ['Cava', 11.5, 125], ['Crémant', 12, 125], ['Sparkling wine', 11.5, 125], ['House red', 13], ['House white', 12],
  ['Cabernet Sauvignon', 14], ['Merlot', 13.5], ['Pinot Noir', 13], ['Malbec', 14], ['Shiraz / Syrah', 14.5],
  ['Tempranillo / Rioja', 13.5], ['Chianti', 13], ['Primitivo', 14], ['Sauvignon Blanc', 12.5], ['Chardonnay', 13.5],
  ['Pinot Grigio', 12], ['Riesling', 11], ['Grüner Veltliner', 12], ['Albariño', 12.5], ['Vinho Verde', 10],
  ['Moscato', 7], ['Port', 20, 75], ['Sherry', 17, 75], ['Vermouth', 16, 75], ['Mulled wine', 9, 200],
  ['Orange wine', 12.5], ['Natural wine', 12], ['Sangria (glass)', 8, 250], ['Retsina', 12], ['Tokaji', 11, 100],
];
const cocktails = [
  ['Mojito', 10, 250], ['Margarita', 18, 150], ['Aperol Spritz', 8, 250], ['Negroni', 24, 100],
  ['Old Fashioned', 30, 100], ['Espresso Martini', 16, 150], ['Piña Colada', 10, 300], ['Cosmopolitan', 20, 150],
  ['Long Island Iced Tea', 18, 350], ['Daiquiri', 20, 120], ['Caipirinha', 20, 200], ['Moscow Mule', 10, 250],
  ['Whiskey Sour', 16, 150], ['Mai Tai', 18, 200], ['Gin & Tonic', 10, 300], ['Cuba Libre', 10, 300],
  ['Sex on the Beach', 10, 250], ['Tequila Sunrise', 10, 250], ['Pornstar Martini', 15, 150], ['Hugo Spritz', 7, 250],
  ['Bloody Mary', 10, 250], ['Dark \'n\' Stormy', 10, 250], ['Paloma', 10, 250], ['Manhattan', 30, 100],
  ['Martini', 30, 100], ['Sangria', 8, 250], ['Limoncello Spritz', 8, 250], ['Campari Spritz', 8, 250],
  ['Americano', 11, 200], ['Boulevardier', 25, 100], ['Sidecar', 25, 100], ['Mint Julep', 25, 150],
  ['French 75', 15, 150], ['Bellini', 8, 150], ['Mimosa', 7, 150], ['Kir Royal', 11, 150], ['Pisco Sour', 16, 150],
  ['Amaretto Sour', 12, 150], ['Tom Collins', 10, 300], ['Screwdriver', 10, 250], ['Vodka Red Bull', 8, 250],
  ['White Russian', 20, 150], ['Blue Lagoon', 12, 250], ['Zombie', 20, 300], ['Hurricane', 16, 300],
  ['Singapore Sling', 12, 300], ['Caipiroska', 20, 200], ['Frozen Margarita', 12, 300], ['Spicy Margarita', 18, 150],
  ['Mezcal Negroni', 24, 100], ['Penicillin', 22, 150], ['Paper Plane', 20, 120], ['Clover Club', 16, 150],
  ['Gimlet', 25, 100], ['Aviation', 22, 120], ['Jungle Bird', 15, 200], ['Rum Punch', 10, 300], ['Michelada', 4, 400],
  ['Pimm\'s Cup', 6, 300], ['Irish Coffee', 10, 200], ['Feni cocktail', 14, 200], ['Lychee Martini', 18, 150],
];
const spirits = [
  ['Whisky (Scotch)', 40], ['Single malt', 43], ['Bourbon', 40], ['Irish whiskey', 40], ['Rye whiskey', 45],
  ['Japanese whisky', 43], ['Jameson', 40], ['Jack Daniel\'s', 40], ['Johnnie Walker Black', 40], ['Glenfiddich 12', 40],
  ['Monkey Shoulder', 40], ['Amrut', 46], ['Paul John', 46], ['Royal Stag', 42.8], ['Blenders Pride', 42.8],
  ['Old Monk', 42.8], ['Vodka', 40], ['Absolut', 40], ['Smirnoff', 37.5], ['Grey Goose', 40], ['Gin', 40],
  ['Hendrick\'s', 41.4], ['Tanqueray', 43.1], ['Bombay Sapphire', 40], ['Beefeater', 40], ['Rum (white)', 37.5],
  ['Rum (dark)', 40], ['Spiced rum', 35], ['Bacardi', 37.5], ['Captain Morgan', 35], ['Havana Club 7', 40],
  ['Tequila blanco', 38], ['Tequila reposado', 38], ['Mezcal', 42], ['Cognac', 40], ['Brandy', 36], ['Armagnac', 40],
  ['Pisco', 40], ['Cachaça', 40], ['Grappa', 40], ['Jägermeister', 35], ['Becherovka', 38], ['Slivovitz', 50],
  ['Pálinka', 45], ['Rakija', 42], ['Ouzo', 40], ['Raki', 45], ['Absinthe', 60], ['Aquavit', 40], ['Limoncello', 28],
  ['Amaretto', 28], ['Baileys', 17], ['Kahlúa', 20], ['Cointreau', 40], ['Campari', 25], ['Aperol', 11],
  ['Fernet-Branca', 39], ['Sambuca', 38], ['Chartreuse', 55], ['Baijiu', 52], ['Arrack', 38], ['Feni', 42.8],
];
const shots = [
  ['Tequila', 38], ['Jäger', 35], ['Jägerbomb', 12, 150], ['Sambuca', 38], ['B-52', 25], ['Kamikaze', 25],
  ['Vodka', 40], ['Whisky', 40], ['Fireball', 33], ['Baby Guinness', 20], ['Lemon drop', 25], ['Slippery Nipple', 25],
  ['Tequila rose', 15], ['Green tea shot', 20], ['Pickleback', 30], ['Becherovka', 38], ['Slivovitz', 50],
  ['Pálinka', 45], ['Rakija', 42], ['Ouzo', 40], ['Unicum', 40], ['Absinthe', 60], ['Limoncello', 28],
  ['Mexicana', 20], ['Soju shot', 17], ['Sake bomb', 8, 200], ['Tequila slammer', 20], ['Liquid cocaine', 30],
];
const ciders = [
  ['Cider (house)', 4.5], ['Strongbow', 4.5], ['Somersby', 4.5], ['Magners', 4.5], ['Bulmers', 4.5],
  ['Rekorderlig', 4.5], ['Kopparberg', 4, 330], ['Thatchers Gold', 4.8], ['Aspall', 5.5], ['Angry Orchard', 5, 355],
  ['Sidra (Asturian)', 6, 750], ['Cidre (Breton)', 5], ['Perry / Pear cider', 4.5], ['Fruit cider', 4],
];
const seltzers = [
  ['Hard seltzer', 5, 330], ['White Claw', 5, 330], ['Truly', 5, 355], ['Bon & Viv', 4.5, 355], ['High Noon', 4.5, 355],
  ['Smirnoff Ice', 4, 275], ['Bacardi Breezer', 4, 275], ['Hooch', 4, 330], ['Chu-Hi (Strong Zero)', 9, 350],
  ['Hard kombucha', 5, 330], ['RTD G&T (can)', 5, 250], ['RTD Mojito (can)', 5, 250],
];
const soft = [
  ['Cola', 0, 330], ['Diet / Zero cola', 0, 330], ['Lemonade', 0, 330], ['Sprite / 7Up', 0, 330], ['Fanta', 0, 330],
  ['Tonic water', 0, 200], ['Ginger ale', 0, 200], ['Iced tea', 0, 330], ['Orange juice', 0, 250], ['Apple juice', 0, 250],
  ['Coconut water', 0, 330], ['Energy drink', 0, 250], ['Red Bull', 0, 250], ['Coffee', 0, 200], ['Espresso', 0, 30],
  ['Tea', 0, 250], ['Masala chai', 0, 150], ['Lassi', 0, 300], ['Fresh lime soda', 0, 300], ['Mocktail', 0, 300],
  ['Virgin Mojito', 0, 300], ['Kombucha', 0.5, 330], ['Alcohol-free beer', 0.5, 330], ['Milkshake', 0, 350],
];
const other = [
  ['Sake', 15, 180], ['Soju', 17, 360], ['Makgeolli', 7, 250], ['Mead', 12, 150], ['Palm wine / Toddy', 5, 300],
  ['Chicha', 3, 300], ['Pulque', 5, 300], ['Umeshu', 12, 100], ['Hot toddy', 10, 200], ['Punch', 8, 250],
  ['Eggnog', 8, 200], ['Glühwein', 9, 200], ['Hard lemonade', 5, 330],
];

export const CATEGORIES = [
  { key: 'beer', label: 'Beer', emoji: '🍺', alcoholic: true, ml: 500, abv: 5, types: beers,
    sizes: [[250, 'Small 250'], [330, 'Bottle 330'], [500, '500 ml'], [568, 'Pint 568'], [650, 'Big 650'], [1000, 'Maß 1 L']] },
  { key: 'wine', label: 'Wine', emoji: '🍷', alcoholic: true, ml: 175, abv: 12.5, types: wines,
    sizes: [[125, 'Glass 125'], [175, 'Glass 175'], [250, 'Large 250'], [375, 'Half 375'], [750, 'Bottle 750']] },
  { key: 'cocktail', label: 'Cocktail', emoji: '🍹', alcoholic: true, ml: 200, abv: 12, types: cocktails,
    sizes: [[100, 'Short 100'], [150, 'Coupe 150'], [200, 'Standard 200'], [300, 'Tall 300'], [500, 'Pitcher 500']] },
  { key: 'spirit', label: 'Spirit', emoji: '🥃', alcoholic: true, ml: 40, abv: 40, types: spirits,
    sizes: [[20, '20 ml'], [25, '25 ml'], [40, '40 ml'], [50, '50 ml'], [60, 'Double 60']] },
  { key: 'shot', label: 'Shot', emoji: '🥂', alcoholic: true, ml: 40, abv: 38, types: shots,
    sizes: [[20, '20 ml'], [30, '30 ml'], [40, '40 ml'], [60, '60 ml']] },
  { key: 'cider', label: 'Cider', emoji: '🍏', alcoholic: true, ml: 500, abv: 4.5, types: ciders,
    sizes: [[330, 'Bottle 330'], [500, '500 ml'], [568, 'Pint 568']] },
  { key: 'seltzer', label: 'Seltzer', emoji: '🫧', alcoholic: true, ml: 330, abv: 5, types: seltzers,
    sizes: [[250, 'Can 250'], [330, 'Can 330'], [355, 'Can 355'], [500, 'Can 500']] },
  { key: 'soft', label: 'Soft', emoji: '🥤', alcoholic: false, ml: 330, abv: 0, types: soft,
    sizes: [[200, '200 ml'], [250, '250 ml'], [330, '330 ml'], [500, '500 ml']] },
  { key: 'other', label: 'Other', emoji: '🍶', alcoholic: true, ml: 250, abv: 10, types: other,
    sizes: [[100, '100 ml'], [180, '180 ml'], [250, '250 ml'], [500, '500 ml']] },
];

export const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

export function findType(category, name) {
  const c = CATEGORY[category];
  if (!c || !name) return null;
  const n = name.toLowerCase();
  const t = c.types.find((x) => x[0].toLowerCase() === n);
  return t ? { name: t[0], abv: t[1], ml: t[2] ?? null } : null;
}

export function isAlcoholic(entry) {
  const c = CATEGORY[entry.category];
  if (entry.abv != null) return entry.abv > 0.5;
  return c ? c.alcoholic : true;
}
