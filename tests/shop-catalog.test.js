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
      ['discount40', 60, 40, 'discount'],
      ['discount30', 45, 30, 'discount'],
      ['discount20', 30, 20, 'discount'],
      ['discount10', 15, 10, 'discount'],
    ],
  );

  assert.equal(SHOP_ITEMS.length, 8);
  assert.equal(shopItemById('discount40')?.title, '40% на кальян!');
  assert.equal(shopItemTitle('discount30'), '30% на кальян!');
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
  assert.match(html, /data-gift-id="discount40"/);
  assert.match(html, /40% на кальян!/);
});

test('browser wiring loads shop catalog before game.js', () => {
  const html = readRepoFile('index.html');
  const catalogIndex = html.indexOf('src/shop/catalog.js');
  const gameIndex = html.indexOf('game.js');

  assert.ok(catalogIndex > 0, 'catalog script should exist');
  assert.ok(catalogIndex < gameIndex, 'catalog must load before game.js');
});
