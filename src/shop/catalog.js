(function initShopCatalog(globalScope, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.VSShopCatalog = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createShopCatalog() {
  'use strict';

  const SHOP_GIFT_ITEMS = Object.freeze([
    {
      id: 'hookah',
      itemType: 'gift',
      title: 'Бесплатный покур кальяна',
      description: 'Да-да, прям вот приходите и курите бесплатный кальян.',
      price: 350,
      imageUrl: './assets/Shop/hookah.png',
    },
    {
      id: 'tea',
      itemType: 'gift',
      title: 'Чайник китайского чая',
      description: 'Любого на ваш выбор.',
      price: 200,
      imageUrl: './assets/Shop/tea.png',
    },
    {
      id: 'mundshtuk',
      itemType: 'gift',
      title: 'Фирменный мундштук',
      description: 'Фирменный персональный мундштук.',
      price: 75,
      imageUrl: './assets/Shop/mundshtuk.png',
    },
    {
      id: 'tshirt',
      itemType: 'gift',
      title: 'Эксклюзивная футболка',
      description: 'Такая будет буквально только у двух людей. Я серьёзно.',
      price: 500,
      imageUrl: './assets/Shop/tshirt.png',
    },
  ]);

  const SHOP_DISCOUNT_ITEMS = Object.freeze([
    { id: 'discount40', itemType: 'discount', title: '40% на кальян!', price: 60, discountPercent: 40 },
    { id: 'discount30', itemType: 'discount', title: '30% на кальян!', price: 45, discountPercent: 30 },
    { id: 'discount20', itemType: 'discount', title: '20% на кальян!', price: 30, discountPercent: 20 },
    { id: 'discount10', itemType: 'discount', title: '10% на кальян!', price: 15, discountPercent: 10 },
  ]);

  const SHOP_ITEMS = Object.freeze([...SHOP_GIFT_ITEMS, ...SHOP_DISCOUNT_ITEMS]);
  const SHOP_ITEM_MAP = new Map(SHOP_ITEMS.map((item) => [item.id, item]));

  function shopItemById(itemId) {
    if (typeof itemId !== 'string') return null;
    return SHOP_ITEM_MAP.get(itemId.trim()) || null;
  }

  function shopItemTitle(itemId) {
    return shopItemById(itemId)?.title || 'Подарок';
  }

  function buildDiscountCode(discountPercent, codeBody) {
    const percent = Number(discountPercent);
    if (!Number.isInteger(percent) || percent <= 0 || percent > 100) {
      throw new Error('discount percent must be between 1 and 100');
    }

    const body = String(codeBody || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (body.length < 8) {
      throw new Error('discount code body must contain at least 8 symbols');
    }

    return `%${percent}B-${body.slice(0, 4)}-${body.slice(4, 8)}`;
  }

  return {
    SHOP_DISCOUNT_ITEMS,
    SHOP_GIFT_ITEMS,
    SHOP_ITEMS,
    buildDiscountCode,
    shopItemById,
    shopItemTitle,
  };
});
