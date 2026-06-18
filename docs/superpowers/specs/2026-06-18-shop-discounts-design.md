# Shop Discounts Design

## Goal

Add a second `Скидки` tab inside the existing `Подарки` screen, using the same protected purchase flow as gifts: Telegram auth, balance check, atomic clap debit, unique code generation, purchase record, player-owned codes, dashboard visibility, and staff bot notification.

## Safety Rules

- Existing player profiles, clap balances, and old gift purchases are not rewritten or recalculated.
- Existing gift codes keep their current `VS-XXXX-XXXX` format.
- New database columns are additive and nullable/defaulted so old rows remain valid.
- Clap spending stays server-side and uses the current optimistic concurrency guard on `profiles.clap_balance`.
- If purchase insertion fails after debit, the function restores the previous clap balance, matching the current gift flow.

## Data Model

`shop_purchases` gets additive columns:

- `item_type text not null default 'gift'`
- `discount_percent integer null`

Gift rows use `item_type = 'gift'` and `discount_percent = null`. Discount rows use `item_type = 'discount'` and a percent value from the supported discount catalog.

## Catalog

The app catalog has two item groups:

- Gifts: current four items and prices stay unchanged.
- Discounts: `40%` for `60`, `30%` for `45`, `20%` for `30`, `10%` for `15` claps.

Discount codes are generated in a staff-readable format such as `%40B-TG30-HTP8`. The leading `%40B` segment identifies a `40%` discount at a glance.

## UI

The current shop screen gets a large segmented switch `Подарки / Скидки`. `Подарки` remains the default view. `Скидки` slides/fades to a separate list matching the provided black-and-gold mockup. Purchase confirmation and owned-code modals adapt their copy for gifts versus discounts.

## Dashboard

The gift purchases table remains the operations surface, but rows show whether the code is a gift or discount. Filters gain an item-type option so staff can separate gifts from discounts quickly.

## Verification

Automated tests cover:

- catalog shape and prices;
- discount code prefix format;
- migration is additive and preserves old gift rows;
- browser wiring for the shop catalog;
- UI markers for the segmented control and discount cards.
