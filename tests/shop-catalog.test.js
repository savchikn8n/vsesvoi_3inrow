const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

test('shop catalog exposes gifts and hookah discounts with stable prices', () => {
  const {
    SHOP_DISCOUNT_ITEMS,
    SHOP_GIFT_ITEMS,
    SHOP_ITEMS,
    shopItemById,
    shopItemTitle,
  } = require('../src/shop/catalog.js');

  assert.deepEqual(
    SHOP_GIFT_ITEMS.map((item) => [item.id, item.price, item.itemType]),
    [
      ['hookah', 350, 'gift'],
      ['tea', 200, 'gift'],
      ['mundshtuk', 75, 'gift'],
      ['tshirt', 500, 'gift'],
    ],
  );

  assert.deepEqual(
    SHOP_DISCOUNT_ITEMS.map((item) => [item.id, item.price, item.discountPercent, item.itemType]),
    [
      ['discount30', 45, 30, 'discount'],
      ['discount20', 30, 20, 'discount'],
      ['discount10', 15, 10, 'discount'],
    ],
  );

  assert.equal(SHOP_ITEMS.length, 7);
  assert.equal(shopItemById('discount40'), null);
  assert.equal(shopItemTitle('discount40'), '40% на кальян');
  assert.equal(shopItemTitle('discount30'), '30% на кальян');
  assert.equal(shopItemTitle('unknown'), 'Подарок');
});

test('discount code helper creates staff-readable percentage prefixes', () => {
  const { buildDiscountCode } = require('../src/shop/catalog.js');

  assert.equal(buildDiscountCode(40, 'TG30HTP8'), '%40B-TG30-HTP8');
  assert.equal(buildDiscountCode(10, 'A1B2C3D4'), '%10B-A1B2-C3D4');
  assert.throws(() => buildDiscountCode(0, 'TG30HTP8'), /discount percent/i);
});

test('shop html includes segmented gifts-discounts surface', () => {
  const html = readRepoFile('index.html');

  assert.match(html, /id="shop-tab-gifts"/);
  assert.match(html, /id="shop-tab-discounts"/);
  assert.match(html, /data-shop-panel="gifts"/);
  assert.match(html, /data-shop-panel="discounts"/);
  assert.doesNotMatch(html, /data-gift-id="discount40"/);
  assert.doesNotMatch(html, /class="shop-discount-percent">40%<\/span>/);
  assert.doesNotMatch(html, /на кальян!/);
  assert.match(html, /class="shop-discount-percent">30%<\/span>/);
  assert.match(html, /class="shop-discount-percent">20%<\/span>/);
  assert.match(html, /class="shop-discount-percent">10%<\/span>/);
});

test('shop owned gifts button uses text plus the provided gift asset without changing height', () => {
  const html = readRepoFile('index.html');
  const css = readRepoFile('styles.css');

  assert.match(html, /id="shop-owned-btn"[\s\S]*<span class="shop-owned-btn-label">Мои<\/span>/);
  assert.match(html, /<img class="shop-owned-btn-icon" src="\.\/assets\/gift-box-with-a-bow\.png" alt="" \/>/);
  assert.match(css, /\.shop-owned-btn\s*{[^}]*width:\s*auto[^}]*min-width:\s*82px[^}]*height:\s*46px/s);
  assert.match(css, /\.shop-owned-btn\s*{[^}]*display:\s*inline-flex[^}]*gap:\s*6px/s);
  assert.match(css, /\.shop-owned-btn-icon\s*{[^}]*width:\s*20px[^}]*height:\s*20px/s);
});

test('discount cards keep the normal shop button sizing and one-row layout', () => {
  const css = readRepoFile('styles.css');

  assert.match(css, /\.shop-discount-item\s*{[^}]*grid-template-columns:\s*12px minmax\(0,\s*1fr\) auto/s);
  assert.match(css, /@media\s*\(max-width:\s*620px\)[\s\S]*\.shop-discount-item\s*{[^}]*grid-template-columns:\s*12px minmax\(0,\s*1fr\) auto/s);
  assert.doesNotMatch(css, /\.shop-discount-item\s+\.shop-buy-btn\s*{/);
  assert.match(css, /\.shop-discount-percent\s*{[^}]*color:\s*#f3b315/s);
});

test('browser wiring loads shop catalog before game.js', () => {
  const html = readRepoFile('index.html');
  const catalogIndex = html.indexOf('src/shop/catalog.js');
  const gameIndex = html.indexOf('game.js');

  assert.ok(catalogIndex > 0, 'catalog script should exist');
  assert.ok(catalogIndex < gameIndex, 'catalog must load before game.js');
});
