// Writes the world map the home page shows and the country table (centroid, English and
// Persian name) from Natural Earth via world-atlas, for the desktop window and the Android app.
// Run after changing the projection.
import fs from 'node:fs';
import { createRequire } from 'node:module';

import { geoCentroid, geoMercator, geoPath } from 'd3-geo';
import countries from 'i18n-iso-countries';
import { feature } from 'topojson-client';
import { presimplify, simplify } from 'topojson-simplify';

const require = createRequire(import.meta.url);
const world = simplify(presimplify(require('world-atlas/countries-50m.json')), 0.02);
countries.registerLocale(require('i18n-iso-countries/langs/en.json'));
countries.registerLocale(require('i18n-iso-countries/langs/fa.json'));

const width = 1000;
const north = 84;
const south = -57;
const shapes = feature(world, world.objects.countries).features.filter((f) => f.id !== '010');

// Mercator scaled to the width; translate puts the north edge at y = 0.
const scale = width / (2 * Math.PI);
const yOf = (lat) => -scale * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const ty = -yOf(north);
const height = Math.round(yOf(south) + ty);
const projection = geoMercator().scale(scale).translate([width / 2, ty]).precision(0.2);
const path = geoPath(projection);

const round = (d) => d.replace(/(\d+\.\d)\d+/g, '$1');
const body = shapes.map((f) => `<path d="${round(path(f) ?? '')}"/>`).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><g class="land">${body}</g></svg>\n`;
fs.writeFileSync('src/renderer/geo/world.svg', svg);
// The Android app draws the same land from the path data, one country per line.
fs.mkdirSync('android/app/src/main/assets/map', { recursive: true });
fs.writeFileSync('android/app/src/main/assets/map/world.txt', shapes.map((f) => round(path(f) ?? '')).filter(Boolean).join('\n') + '\n');

// Short names read better in a list: "Iran", not "Islamic Republic of Iran".
const nameOf = (code, lang) => {
  const alias = countries.getName(code, lang, { select: 'alias' });
  if (alias && !alias.includes(',') && alias !== alias.toUpperCase()) return alias;
  return countries.getName(code, lang) ?? code;
};
const table = {};
for (const f of shapes) {
  const code = countries.numericToAlpha2(f.id);
  if (!code) continue;
  const [lon, lat] = geoCentroid(f);
  table[code] = { lat: +lat.toFixed(2), lon: +lon.toFixed(2), en: nameOf(code, 'en'), fa: nameOf(code, 'fa') };
}
for (const code of Object.keys(countries.getAlpha2Codes())) {
  table[code] ??= { lat: 0, lon: 0, en: nameOf(code, 'en'), fa: nameOf(code, 'fa') };
}
const countriesJson = JSON.stringify({ map: { width, height, scale, ty }, countries: table });
fs.writeFileSync('src/renderer/geo/countries.json', countriesJson);
fs.writeFileSync('android/app/src/main/assets/map/countries.json', countriesJson);
console.log(`map ${width}x${height}, ${shapes.length} shapes, ${Object.keys(table).length} countries, svg ${(svg.length / 1024).toFixed(0)} KB`);
