export const SHOP_ITEMS = {
  hookah: {
    id: 'hookah',
    item_type: 'gift',
    price: 350,
    title: 'Бесплатный покур кальяна',
    discount_percent: null,
  },
  tea: {
    id: 'tea',
    item_type: 'gift',
    price: 200,
    title: 'Чайник китайского чая, любого на ваш выбор',
    discount_percent: null,
  },
  mundshtuk: {
    id: 'mundshtuk',
    item_type: 'gift',
    price: 75,
    title: 'Фирменный мундштук',
    discount_percent: null,
  },
  tshirt: {
    id: 'tshirt',
    item_type: 'gift',
    price: 500,
    title: 'Эксклюзивная футболка',
    discount_percent: null,
  },
  discount30: {
    id: 'discount30',
    item_type: 'discount',
    price: 45,
    title: '30% на кальян',
    discount_percent: 30,
  },
  discount20: {
    id: 'discount20',
    item_type: 'discount',
    price: 30,
    title: '20% на кальян',
    discount_percent: 20,
  },
  discount10: {
    id: 'discount10',
    item_type: 'discount',
    price: 15,
    title: '10% на кальян',
    discount_percent: 10,
  },
} as const;

export type ShopItemId = keyof typeof SHOP_ITEMS;
export type ShopItem = typeof SHOP_ITEMS[ShopItemId];
