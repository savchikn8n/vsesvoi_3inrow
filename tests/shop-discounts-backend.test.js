const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

test('shop discounts migration is additive and keeps old gift rows valid', () => {
  const sql = readRepoFile('supabase/sql/015_shop_discounts.sql');

  assert.match(sql, /alter table public\.shop_purchases\s+add column if not exists item_type text not null default 'gift'/i);
  assert.match(sql, /alter table public\.shop_purchases\s+add column if not exists discount_percent integer/i);
  assert.match(sql, /shop_purchases_item_type_idx/i);
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /truncate/i);
  assert.doesNotMatch(sql, /delete from public\.shop_purchases/i);
});

test('purchase function supports discounts without changing the gift endpoint contract', () => {
  const source = readRepoFile('supabase/functions/purchase-gift/index.ts');

  assert.match(source, /SHOP_ITEMS/);
  assert.match(source, /randomDiscountCode/);
  assert.match(source, /item_type: shopItem\.item_type/);
  assert.match(source, /discount_percent: shopItem\.discount_percent \|\| null/);
  assert.match(source, /giftId/);
  assert.match(source, /Код скидки/);
});

test('owned gifts and dashboard admin expose item type and discount percent', () => {
  const myGifts = readRepoFile('supabase/functions/my-gifts/index.ts');
  const giftAdmin = readRepoFile('supabase/functions/gift-admin/index.ts');

  assert.match(myGifts, /gift_id, code, created_at, item_type, discount_percent/);
  assert.match(giftAdmin, /gift_id, code, item_type, discount_percent/);
  assert.match(giftAdmin, /item_type: row\.item_type \|\| 'gift'/);
  assert.match(giftAdmin, /discount_percent: row\.discount_percent \|\| null/);
});

test('dashboard can filter and label gift versus discount purchases', () => {
  const html = readRepoFile('dashboard.html');
  const js = readRepoFile('dashboard.js');

  assert.match(html, /id="gift-filter-type"/);
  assert.match(html, /value="discount"/);
  assert.match(js, /giftFilterTypeEl/);
  assert.match(js, /shopPurchaseTypeLabel/);
  assert.match(js, /item\.item_type/);
});

test('shop functions are configured as public Telegram endpoints', () => {
  const config = readRepoFile('supabase/config.toml');

  for (const functionName of ['purchase-gift', 'my-gifts', 'gift-admin']) {
    assert.match(
      config,
      new RegExp(`\\[functions\\.${functionName}\\][\\s\\S]*?verify_jwt\\s*=\\s*false`),
      `${functionName} must deploy with verify_jwt=false`,
    );
  }
});
