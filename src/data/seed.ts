import { db } from './db';
import type {
  Account,
  BalanceAdjustment,
  Consumption,
  ConsumptionItem,
  InventoryLot,
  InventoryMovement,
  Payment,
  PaymentApplication,
  PersonUser,
  Product,
  Purchase,
  Setting
} from '../domain/types';
import { createId, nowIso } from '../utils/id';
import { hashPin } from '../utils/security';

const DEMO_SEED_VERSION = 'demo-v4';
const DEMO_CLEANUP_VERSION = 'dedupe-v1';

let ensureSeedDataPromise: Promise<void> | null = null;

type ProductSeed = {
  key: string;
  name: string;
  category: string;
  price: number;
  stockMin: number;
  lastCost: number;
  initialStock: number;
  imageUrl: string;
  imageSourceUrl?: string;
  imageCredit?: string;
};

type DemoData = {
  accounts: Account[];
  users: PersonUser[];
  products: Product[];
  consumptions: Consumption[];
  consumptionItems: ConsumptionItem[];
  payments: Payment[];
  paymentApplications: PaymentApplication[];
  purchases: Purchase[];
  inventoryLots: InventoryLot[];
  inventoryMovements: InventoryMovement[];
  adjustments: BalanceAdjustment[];
  settings: Setting[];
};

type ProductImageSeed = Pick<ProductSeed, 'imageUrl' | 'imageSourceUrl' | 'imageCredit'>;

function unsplashPhoto(imageUrl: string): ProductImageSeed {
  return {
    imageUrl,
    imageSourceUrl: 'https://unsplash.com/',
    imageCredit: 'Unsplash'
  };
}

function openFoodFactsImage(code: string, imageUrl: string): ProductImageSeed {
  return {
    imageUrl,
    imageSourceUrl: `https://world.openfoodfacts.org/product/${code}`,
    imageCredit: 'Open Food Facts (CC BY-SA)'
  };
}

const catalogImages = {
  water: unsplashPhoto('https://images.unsplash.com/photo-1523362628745-0c100150b504?auto=format&fit=crop&w=640&q=75'),
  soda: unsplashPhoto('https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=640&q=75'),
  juice: unsplashPhoto('https://images.unsplash.com/photo-1600271886742-f049cd451bba?auto=format&fit=crop&w=640&q=75'),
  chips: unsplashPhoto('https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=640&q=75'),
  cake: unsplashPhoto('https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=640&q=75'),
  chocolate: unsplashPhoto('https://images.unsplash.com/photo-1606312619070-d48b4c652a52?auto=format&fit=crop&w=640&q=75'),
  cookies: unsplashPhoto('https://images.unsplash.com/photo-1499636136210-6f4ee915583e?auto=format&fit=crop&w=640&q=75'),
  coffee: unsplashPhoto('https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=640&q=75'),
  sandwich: unsplashPhoto('https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=640&q=75'),
  yogurt: unsplashPhoto('https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=640&q=75'),
  cerealBar: unsplashPhoto('https://images.unsplash.com/photo-1571748982800-fa51082c2224?auto=format&fit=crop&w=640&q=75'),
  iceCream: unsplashPhoto('https://images.unsplash.com/photo-1501443762994-82bd5dace89a?auto=format&fit=crop&w=640&q=75'),
  beer: unsplashPhoto('https://images.unsplash.com/photo-1608270586620-248524c67de9?auto=format&fit=crop&w=640&q=75'),
  bread: unsplashPhoto('https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=640&q=75'),
  nuts: unsplashPhoto('https://images.unsplash.com/photo-1524593166156-312f362cada0?auto=format&fit=crop&w=640&q=75')
};

const productSeeds: ProductSeed[] = [
  {
    key: 'agua',
    name: 'Agua Cristal 600 ml',
    category: 'Bebidas',
    price: 2000,
    stockMin: 8,
    lastCost: 950,
    initialStock: 30,
    ...catalogImages.water
  },
  {
    key: 'gaseosa',
    name: 'Coca-Cola 400 ml',
    category: 'Bebidas',
    price: 3500,
    stockMin: 8,
    lastCost: 2100,
    initialStock: 20,
    ...openFoodFactsImage(
      '7702535011089',
      'https://images.openfoodfacts.org/images/products/770/253/501/1089/front_es.21.400.jpg'
    )
  },
  {
    key: 'coca_zero',
    name: 'Coca-Cola Zero 400 ml',
    category: 'Bebidas',
    price: 3500,
    stockMin: 6,
    lastCost: 2200,
    initialStock: 16,
    ...catalogImages.soda
  },
  {
    key: 'pony_malta',
    name: 'Pony Malta 1.5 L',
    category: 'Bebidas',
    price: 6900,
    stockMin: 5,
    lastCost: 4400,
    initialStock: 12,
    ...openFoodFactsImage(
      '7702004013514',
      'https://images.openfoodfacts.org/images/products/770/200/401/3514/front_en.7.400.jpg'
    )
  },
  {
    key: 'bretana',
    name: 'Bretaña Postobon 1.5 L',
    category: 'Bebidas',
    price: 4200,
    stockMin: 5,
    lastCost: 2600,
    initialStock: 14,
    ...openFoodFactsImage(
      '7702090029543',
      'https://images.openfoodfacts.org/images/products/770/209/002/9543/front_en.9.400.jpg'
    )
  },
  {
    key: 'jugo',
    name: 'Jugo Hit Mora 500 ml',
    category: 'Bebidas',
    price: 3200,
    stockMin: 6,
    lastCost: 1800,
    initialStock: 18,
    ...catalogImages.juice
  },
  {
    key: 'gatorade',
    name: 'Gatorade Tropical 500 ml',
    category: 'Bebidas',
    price: 5500,
    stockMin: 4,
    lastCost: 3600,
    initialStock: 12,
    ...catalogImages.juice
  },
  {
    key: 'red_bull',
    name: 'Red Bull 250 ml',
    category: 'Bebidas',
    price: 8500,
    stockMin: 4,
    lastCost: 6200,
    initialStock: 10,
    ...catalogImages.soda
  },
  {
    key: 'papas',
    name: 'Papas Margarita Limon',
    category: 'Snacks',
    price: 3000,
    stockMin: 6,
    lastCost: 1700,
    initialStock: 20,
    ...catalogImages.chips
  },
  {
    key: 'doritos',
    name: 'Doritos Mega Queso 43 g',
    category: 'Snacks',
    price: 3500,
    stockMin: 6,
    lastCost: 2200,
    initialStock: 18,
    ...openFoodFactsImage(
      '7702189053817',
      'https://images.openfoodfacts.org/images/products/770/218/905/3817/front_es.15.400.jpg'
    )
  },
  {
    key: 'doritos_flamin',
    name: 'Doritos Flamin Hot 41 g',
    category: 'Snacks',
    price: 3500,
    stockMin: 5,
    lastCost: 2300,
    initialStock: 14,
    ...catalogImages.chips
  },
  {
    key: 'gudiz',
    name: 'Gudiz Frito Lay 28 g',
    category: 'Snacks',
    price: 2600,
    stockMin: 5,
    lastCost: 1500,
    initialStock: 16,
    ...openFoodFactsImage(
      '7702189016812',
      'https://images.openfoodfacts.org/images/products/770/218/901/6812/front_es.12.400.jpg'
    )
  },
  {
    key: 'de_todito',
    name: 'De Todito BBQ',
    category: 'Snacks',
    price: 3500,
    stockMin: 5,
    lastCost: 2200,
    initialStock: 14,
    ...catalogImages.chips
  },
  {
    key: 'choclitos',
    name: 'Choclitos Limon',
    category: 'Snacks',
    price: 3000,
    stockMin: 5,
    lastCost: 1800,
    initialStock: 14,
    ...catalogImages.chips
  },
  {
    key: 'cheetos',
    name: 'Cheetos Queso',
    category: 'Snacks',
    price: 3000,
    stockMin: 5,
    lastCost: 1800,
    initialStock: 14,
    ...catalogImages.chips
  },
  {
    key: 'ruffles',
    name: 'Ruffles Crema y Cebolla',
    category: 'Snacks',
    price: 3500,
    stockMin: 5,
    lastCost: 2200,
    initialStock: 12,
    ...catalogImages.chips
  },
  {
    key: 'natuchips',
    name: 'Natuchips Platano',
    category: 'Snacks',
    price: 3500,
    stockMin: 5,
    lastCost: 2200,
    initialStock: 12,
    ...catalogImages.chips
  },
  {
    key: 'mani',
    name: 'Mani Salado',
    category: 'Snacks',
    price: 2500,
    stockMin: 5,
    lastCost: 1400,
    initialStock: 16,
    ...catalogImages.nuts
  },
  {
    key: 'chokis',
    name: 'Chokis Chocolate',
    category: 'Dulces',
    price: 2500,
    stockMin: 5,
    lastCost: 1400,
    initialStock: 16,
    ...openFoodFactsImage(
      '7702189040961',
      'https://images.openfoodfacts.org/images/products/770/218/904/0961/front_en.3.400.jpg'
    )
  },
  {
    key: 'oreo',
    name: 'Oreo Original',
    category: 'Dulces',
    price: 3000,
    stockMin: 5,
    lastCost: 1800,
    initialStock: 16,
    ...catalogImages.cookies
  },
  {
    key: 'festival',
    name: 'Festival Chocolate',
    category: 'Dulces',
    price: 2500,
    stockMin: 5,
    lastCost: 1400,
    initialStock: 16,
    ...catalogImages.cookies
  },
  {
    key: 'chocorramo',
    name: 'Chocorramo',
    category: 'Dulces',
    price: 2800,
    stockMin: 5,
    lastCost: 1600,
    initialStock: 16,
    ...catalogImages.cake
  },
  {
    key: 'chocolate',
    name: 'Chocolate Jet',
    category: 'Dulces',
    price: 2500,
    stockMin: 5,
    lastCost: 1200,
    initialStock: 18,
    ...catalogImages.chocolate
  },
  {
    key: 'bon_bon_bum',
    name: 'Bon Bon Bum',
    category: 'Dulces',
    price: 800,
    stockMin: 5,
    lastCost: 350,
    initialStock: 24,
    ...catalogImages.chocolate
  },
  {
    key: 'trident',
    name: 'Trident Menta',
    category: 'Dulces',
    price: 3000,
    stockMin: 5,
    lastCost: 1800,
    initialStock: 12,
    ...catalogImages.chocolate
  },
  {
    key: 'snickers',
    name: 'Snickers',
    category: 'Dulces',
    price: 3500,
    stockMin: 5,
    lastCost: 2300,
    initialStock: 12,
    ...catalogImages.chocolate
  },
  {
    key: 'mms',
    name: 'M&M Chocolate',
    category: 'Dulces',
    price: 4000,
    stockMin: 5,
    lastCost: 2600,
    initialStock: 10,
    ...catalogImages.chocolate
  },
  {
    key: 'galletas',
    name: 'Galletas Festival',
    category: 'Dulces',
    price: 2200,
    stockMin: 5,
    lastCost: 1000,
    initialStock: 18,
    ...catalogImages.cookies
  },
  {
    key: 'ponque_gala',
    name: 'Ponque Gala Ramo',
    category: 'Dulces',
    price: 3000,
    stockMin: 5,
    lastCost: 1800,
    initialStock: 14,
    ...catalogImages.cake
  },
  {
    key: 'cafe',
    name: 'Cafe frio',
    category: 'Bebidas',
    price: 4500,
    stockMin: 5,
    lastCost: 2600,
    initialStock: 14,
    ...catalogImages.coffee
  },
  {
    key: 'avena_alpina',
    name: 'Avena Alpina',
    category: 'Bebidas',
    price: 3500,
    stockMin: 5,
    lastCost: 2200,
    initialStock: 14,
    ...catalogImages.yogurt
  },
  {
    key: 'sandwich',
    name: 'Sandwich jamon y queso',
    category: 'Panaderia',
    price: 6500,
    stockMin: 12,
    lastCost: 3900,
    initialStock: 10,
    ...catalogImages.sandwich
  },
  {
    key: 'croissant_bimbo',
    name: 'Mini Croissant Bimbo',
    category: 'Panaderia',
    price: 3200,
    stockMin: 5,
    lastCost: 2000,
    initialStock: 12,
    ...openFoodFactsImage(
      '7705326002563',
      'https://images.openfoodfacts.org/images/products/770/532/600/2563/front_es.3.400.jpg'
    )
  },
  {
    key: 'pan_fruticereal',
    name: 'Pan Fruticereal Bimbo',
    category: 'Panaderia',
    price: 6500,
    stockMin: 4,
    lastCost: 4800,
    initialStock: 8,
    ...openFoodFactsImage(
      '7705326073891',
      'https://images.openfoodfacts.org/images/products/770/532/607/3891/front_es.17.400.jpg'
    )
  },
  {
    key: 'pan_bimbo',
    name: 'Pan Blanco Bimbo',
    category: 'Panaderia',
    price: 6500,
    stockMin: 4,
    lastCost: 4800,
    initialStock: 8,
    ...catalogImages.bread
  },
  {
    key: 'tostadas',
    name: 'Tostadas Ramo',
    category: 'Panaderia',
    price: 3500,
    stockMin: 5,
    lastCost: 2300,
    initialStock: 10,
    ...catalogImages.bread
  },
  {
    key: 'yogur',
    name: 'Yogurt Alpina 200 g',
    category: 'Lacteos',
    price: 4200,
    stockMin: 10,
    lastCost: 2500,
    initialStock: 12,
    ...openFoodFactsImage(
      '7702001042012',
      'https://images.openfoodfacts.org/images/products/770/200/104/2012/front_es.40.400.jpg'
    )
  },
  {
    key: 'yox_fresa',
    name: 'Yox Fresa Alpina',
    category: 'Lacteos',
    price: 2800,
    stockMin: 8,
    lastCost: 1600,
    initialStock: 14,
    ...openFoodFactsImage(
      '7702001041923',
      'https://images.openfoodfacts.org/images/products/770/200/104/1923/front_es.4.400.jpg'
    )
  },
  {
    key: 'cremosino',
    name: 'Cremosino Alpina 200 g',
    category: 'Lacteos',
    price: 3600,
    stockMin: 6,
    lastCost: 2300,
    initialStock: 12,
    ...openFoodFactsImage(
      '7702001011308',
      'https://images.openfoodfacts.org/images/products/770/200/101/1308/front_es.8.400.jpg'
    )
  },
  {
    key: 'alpinette',
    name: 'Alpinette Alpina',
    category: 'Lacteos',
    price: 4200,
    stockMin: 6,
    lastCost: 2700,
    initialStock: 10,
    ...openFoodFactsImage(
      '7702001062218',
      'https://images.openfoodfacts.org/images/products/770/200/106/2218/front_en.3.400.jpg'
    )
  },
  {
    key: 'parmesano',
    name: 'Queso Parmesano Alpina',
    category: 'Lacteos',
    price: 7200,
    stockMin: 3,
    lastCost: 5200,
    initialStock: 8,
    ...openFoodFactsImage(
      '7702001012053',
      'https://images.openfoodfacts.org/images/products/770/200/101/2053/front_en.19.400.jpg'
    )
  },
  {
    key: 'barra',
    name: 'Barra de cereal',
    category: 'Saludable',
    price: 2800,
    stockMin: 5,
    lastCost: 1300,
    initialStock: 14,
    ...catalogImages.cerealBar
  },
  {
    key: 'granola',
    name: 'Granola Personal',
    category: 'Saludable',
    price: 3600,
    stockMin: 5,
    lastCost: 2200,
    initialStock: 10,
    ...catalogImages.cerealBar
  },
  {
    key: 'helado',
    name: 'Helado paleta',
    category: 'Helados',
    price: 3000,
    stockMin: 5,
    lastCost: 1600,
    initialStock: 7,
    ...catalogImages.iceCream
  },
  {
    key: 'helado_sandwich',
    name: 'Sandwich de Helado',
    category: 'Helados',
    price: 4200,
    stockMin: 5,
    lastCost: 2600,
    initialStock: 8,
    ...catalogImages.iceCream
  },
  {
    key: 'aguila',
    name: 'Cerveza Aguila 330 ml',
    category: 'Cervezas',
    price: 4500,
    stockMin: 6,
    lastCost: 3000,
    initialStock: 20,
    ...openFoodFactsImage(
      '7702004002013',
      'https://images.openfoodfacts.org/images/products/770/200/400/2013/front_fr.4.400.jpg'
    )
  },
  {
    key: 'poker',
    name: 'Cerveza Poker 330 ml',
    category: 'Cervezas',
    price: 4500,
    stockMin: 6,
    lastCost: 3000,
    initialStock: 18,
    ...catalogImages.beer
  },
  {
    key: 'club_colombia',
    name: 'Club Colombia Dorada',
    category: 'Cervezas',
    price: 5500,
    stockMin: 5,
    lastCost: 3800,
    initialStock: 14,
    ...catalogImages.beer
  },
  {
    key: 'corona',
    name: 'Corona Extra',
    category: 'Cervezas',
    price: 7000,
    stockMin: 5,
    lastCost: 5000,
    initialStock: 12,
    ...catalogImages.beer
  },
  {
    key: 'heineken',
    name: 'Heineken',
    category: 'Cervezas',
    price: 6500,
    stockMin: 5,
    lastCost: 4700,
    initialStock: 12,
    ...catalogImages.beer
  },
  {
    key: 'budweiser',
    name: 'Budweiser',
    category: 'Cervezas',
    price: 6000,
    stockMin: 5,
    lastCost: 4300,
    initialStock: 12,
    ...catalogImages.beer
  },
  {
    key: 'atun',
    name: 'Atun Van Camps',
    category: 'Despensa',
    price: 7000,
    stockMin: 4,
    lastCost: 5000,
    initialStock: 10,
    ...catalogImages.chips
  },
  {
    key: 'salchichas',
    name: 'Salchichas Zenu',
    category: 'Despensa',
    price: 7000,
    stockMin: 4,
    lastCost: 5200,
    initialStock: 8,
    ...catalogImages.sandwich
  }
];

function daysAgo(days: number, hour: number, minute = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function addMinutes(timestamp: string, minutes: number): string {
  const date = new Date(timestamp);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function normalizeProductName(name: string): string {
  return name.trim().toLowerCase();
}

function catalogProductNames(): Set<string> {
  return new Set(productSeeds.map((seed) => normalizeProductName(seed.name)));
}

function openAmount(
  item: ConsumptionItem,
  consumptions: Consumption[],
  applications: PaymentApplication[]
): number {
  const consumption = consumptions.find((entry) => entry.id === item.consumptionId);
  if (!consumption || consumption.status !== 'confirmed') return 0;
  const paid = applications
    .filter((application) => application.consumptionItemId === item.id)
    .reduce((sum, application) => sum + application.amount, 0);
  return Math.max(0, item.total - paid);
}

async function buildDemoData(): Promise<DemoData> {
  const timestamp = nowIso();
  const userPinHash = await hashPin('1234');
  const adminPinHash = await hashPin('0000');

  const accountsByKey = new Map<string, Account>();
  const usersByKey = new Map<string, PersonUser>();
  const productsByKey = new Map<string, Product>();
  const consumptions: Consumption[] = [];
  const consumptionItems: ConsumptionItem[] = [];
  const payments: Payment[] = [];
  const paymentApplications: PaymentApplication[] = [];
  const purchases: Purchase[] = [];
  const inventoryLots: InventoryLot[] = [];
  const inventoryMovements: InventoryMovement[] = [];
  const adjustments: BalanceAdjustment[] = [];

  function account(key: string, name: string): Account {
    const item: Account = {
      id: createId('acct'),
      name,
      status: 'active',
      createdAt: daysAgo(18, 8),
      updatedAt: timestamp
    };
    accountsByKey.set(key, item);
    return item;
  }

  const accounts = [
    account('perez', 'Familia Perez'),
    account('casa', 'Casa principal'),
    account('oficina', 'Oficina 302'),
    account('invitados', 'Cuenta invitados')
  ];

  function user(key: string, accountKey: string | undefined, name: string): PersonUser {
    const accountEntry = accountKey ? accountsByKey.get(accountKey) : undefined;
    if (accountKey && !accountEntry) throw new Error(`Cuenta demo no encontrada: ${accountKey}`);
    const item: PersonUser = {
      id: createId('usr'),
      accountId: accountEntry?.id,
      name,
      pinHash: userPinHash,
      status: 'active',
      createdAt: daysAgo(18, 8, 10),
      updatedAt: timestamp
    };
    usersByKey.set(key, item);
    return item;
  }

  const users = [
    user('papa', 'perez', 'Papa'),
    user('mama', 'perez', 'Mama'),
    user('hijo', 'perez', 'Hijo'),
    user('ana', 'casa', 'Ana'),
    user('luis', 'casa', 'Luis'),
    user('recepcion', 'oficina', 'Recepcion'),
    user('daniel', 'oficina', 'Daniel'),
    user('invitada', 'invitados', 'Invitada'),
    user('solo', undefined, 'Usuario Solo')
  ];

  const products: Product[] = productSeeds.map((seed) => {
    const product: Product = {
      id: createId('prd'),
      name: seed.name,
      category: seed.category,
      price: seed.price,
      stockMin: seed.stockMin,
      lastCost: seed.lastCost,
      imageUrl: seed.imageUrl,
      imageSourceUrl: seed.imageSourceUrl,
      imageCredit: seed.imageCredit,
      status: 'active',
      createdAt: daysAgo(16, 9),
      updatedAt: timestamp
    };
    productsByKey.set(seed.key, product);
    return product;
  });

  function addPurchase(productKey: string, quantity: number, unitCost: number, note: string, createdAt: string) {
    const product = productsByKey.get(productKey);
    if (!product) throw new Error(`Producto demo no encontrado: ${productKey}`);
    const purchase: Purchase = {
      id: createId('pur'),
      productId: product.id,
      quantity,
      unitCost,
      totalCost: quantity * unitCost,
      note,
      createdAt
    };
    purchases.push(purchase);
    inventoryLots.push({
      id: createId('lot'),
      productId: product.id,
      purchaseId: purchase.id,
      quantity,
      remainingQuantity: quantity,
      unitCost,
      createdAt
    });
    inventoryMovements.push({
      id: createId('mov'),
      productId: product.id,
      type: 'purchase',
      quantityDelta: quantity,
      unitCost,
      referenceId: purchase.id,
      note,
      createdAt
    });
    product.lastCost = unitCost;
    product.updatedAt = createdAt;
  }

  productSeeds.forEach((seed, index) => {
    addPurchase(seed.key, seed.initialStock, seed.lastCost, 'Inventario inicial demo', daysAgo(15, 8 + (index % 5), 15));
  });
  addPurchase('agua', 18, 1050, 'Reposicion nevera', daysAgo(5, 17));
  addPurchase('gaseosa', 12, 2200, 'Compra mayorista', daysAgo(4, 11, 30));
  addPurchase('sandwich', 6, 4100, 'Reposicion frescos', daysAgo(2, 8, 30));

  function allocateCost(product: Product, quantity: number, referenceId: string, createdAt: string) {
    const availableLots = inventoryLots
      .filter((lot) => lot.productId === product.id && lot.remainingQuantity > 0 && lot.createdAt <= createdAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let remaining = quantity;
    let costTotal = 0;

    for (const lot of availableLots) {
      if (remaining <= 0) break;
      const used = Math.min(remaining, lot.remainingQuantity);
      remaining -= used;
      costTotal += used * lot.unitCost;
      lot.remainingQuantity -= used;
    }

    inventoryMovements.push({
      id: createId('mov'),
      productId: product.id,
      type: 'consumption',
      quantityDelta: -quantity,
      unitCost: product.lastCost,
      referenceId,
      createdAt
    });

    return {
      costTotal,
      pendingCostQuantity: remaining,
      costStatus: remaining > 0 ? ('pending_recalc' as const) : ('final' as const)
    };
  }

  function addConsumption(
    userKey: string,
    lines: Array<{ productKey: string; quantity: number }>,
    createdAt: string,
    options: { voided?: boolean; reason?: string } = {}
  ) {
    const userEntry = usersByKey.get(userKey);
    if (!userEntry) throw new Error(`Usuario demo no encontrado: ${userKey}`);
    const consumptionId = createId('con');
    let total = 0;
    let costTotal = 0;
    let hasPendingCost = false;

    for (const line of lines) {
      const product = productsByKey.get(line.productKey);
      if (!product) throw new Error(`Producto demo no encontrado: ${line.productKey}`);
      const itemTotal = product.price * line.quantity;
      const allocation = allocateCost(product, line.quantity, consumptionId, createdAt);
      total += itemTotal;
      costTotal += allocation.costTotal;
      hasPendingCost = hasPendingCost || allocation.costStatus === 'pending_recalc';
      consumptionItems.push({
        id: createId('item'),
        consumptionId,
        accountId: userEntry.accountId,
        userId: userEntry.id,
        productId: product.id,
        productName: product.name,
        quantity: line.quantity,
        unitPrice: product.price,
        total: itemTotal,
        unitCost: line.quantity > 0 ? allocation.costTotal / line.quantity : 0,
        costTotal: allocation.costTotal,
        pendingCostQuantity: allocation.pendingCostQuantity,
        costStatus: allocation.costStatus,
        createdAt
      });
    }

    const consumption: Consumption = {
      id: consumptionId,
      accountId: userEntry.accountId,
      userId: userEntry.id,
      status: options.voided ? 'voided' : 'confirmed',
      total,
      costTotal,
      costStatus: hasPendingCost ? 'pending_recalc' : 'final',
      createdAt,
      voidedAt: options.voided ? addMinutes(createdAt, 18) : undefined,
      voidReason: options.voided ? options.reason ?? 'Error de registro demo' : undefined
    };
    consumptions.push(consumption);

    if (options.voided) {
      const returnedAt = consumption.voidedAt ?? addMinutes(createdAt, 18);
      const createdItems = consumptionItems.filter((item) => item.consumptionId === consumptionId);
      for (const item of createdItems) {
        inventoryLots.push({
          id: createId('lot'),
          productId: item.productId,
          purchaseId: consumptionId,
          quantity: item.quantity,
          remainingQuantity: item.quantity,
          unitCost: item.unitCost,
          createdAt: returnedAt
        });
        inventoryMovements.push({
          id: createId('mov'),
          productId: item.productId,
          type: 'void_consumption',
          quantityDelta: item.quantity,
          unitCost: item.unitCost,
          referenceId: consumptionId,
          note: consumption.voidReason,
          createdAt: returnedAt
        });
      }
    }
  }

  addConsumption('papa', [
    { productKey: 'agua', quantity: 2 },
    { productKey: 'papas', quantity: 1 },
    { productKey: 'chocolate', quantity: 1 }
  ], daysAgo(10, 10, 5));
  addConsumption('mama', [
    { productKey: 'jugo', quantity: 1 },
    { productKey: 'sandwich', quantity: 1 }
  ], daysAgo(10, 14, 20));
  addConsumption('hijo', [
    { productKey: 'gaseosa', quantity: 2 },
    { productKey: 'papas', quantity: 2 }
  ], daysAgo(9, 16));
  addConsumption('ana', [
    { productKey: 'yogur', quantity: 2 },
    { productKey: 'barra', quantity: 1 }
  ], daysAgo(8, 9, 30));
  addConsumption('luis', [
    { productKey: 'cafe', quantity: 1 },
    { productKey: 'galletas', quantity: 2 },
    { productKey: 'agua', quantity: 1 }
  ], daysAgo(7, 13));
  addConsumption('hijo', [
    { productKey: 'agua', quantity: 1 },
    { productKey: 'gaseosa', quantity: 1 }
  ], daysAgo(6, 10, 35), { voided: true, reason: 'Producto devuelto en demo' });
  addConsumption('daniel', [
    { productKey: 'sandwich', quantity: 2 },
    { productKey: 'gaseosa', quantity: 1 }
  ], daysAgo(6, 12));
  addConsumption('papa', [
    { productKey: 'chocorramo', quantity: 2 },
    { productKey: 'agua', quantity: 2 }
  ], daysAgo(5, 15));
  addConsumption('mama', [
    { productKey: 'yogur', quantity: 1 },
    { productKey: 'galletas', quantity: 1 },
    { productKey: 'cafe', quantity: 1 }
  ], daysAgo(4, 11));
  addConsumption('hijo', [
    { productKey: 'helado', quantity: 2 },
    { productKey: 'chocolate', quantity: 1 }
  ], daysAgo(4, 17, 45));
  addConsumption('ana', [
    { productKey: 'papas', quantity: 1 },
    { productKey: 'gaseosa', quantity: 1 },
    { productKey: 'agua', quantity: 1 }
  ], daysAgo(3, 16, 10));
  addConsumption('recepcion', [
    { productKey: 'sandwich', quantity: 1 },
    { productKey: 'cafe', quantity: 1 },
    { productKey: 'barra', quantity: 2 }
  ], daysAgo(2, 12, 10));
  addConsumption('daniel', [
    { productKey: 'gaseosa', quantity: 2 },
    { productKey: 'chocorramo', quantity: 1 }
  ], daysAgo(1, 11, 45));
  addConsumption('luis', [
    { productKey: 'helado', quantity: 1 },
    { productKey: 'jugo', quantity: 2 }
  ], daysAgo(1, 18, 5));
  addConsumption('invitada', [
    { productKey: 'agua', quantity: 1 },
    { productKey: 'papas', quantity: 1 }
  ], daysAgo(0, 9, 40));
  addConsumption('solo', [
    { productKey: 'cafe', quantity: 1 },
    { productKey: 'barra', quantity: 1 }
  ], daysAgo(0, 11, 25));

  function addPayment(input: {
    accountKey: string;
    targetType: 'account' | 'user';
    userKey?: string;
    paidByUserKey?: string;
    amount: number;
    note: string;
    createdAt: string;
  }) {
    const accountEntry = accountsByKey.get(input.accountKey);
    if (!accountEntry) throw new Error(`Cuenta demo no encontrada: ${input.accountKey}`);
    const userEntry = input.userKey ? usersByKey.get(input.userKey) : undefined;
    if (input.targetType === 'user' && !userEntry) throw new Error(`Usuario demo no encontrado: ${input.userKey}`);
    const paidByUserEntry = input.paidByUserKey
      ? usersByKey.get(input.paidByUserKey)
      : userEntry ?? users.find((entry) => entry.accountId === accountEntry.id);
    if (!paidByUserEntry) throw new Error(`Pagador demo no encontrado: ${input.paidByUserKey}`);
    const paymentId = createId('pay');
    let remaining = input.amount;
    const candidates = consumptionItems
      .filter((item) => item.accountId === accountEntry.id)
      .filter((item) => input.targetType === 'account' || item.userId === userEntry?.id)
      .filter((item) => item.createdAt <= input.createdAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const item of candidates) {
      if (remaining <= 0) break;
      const currentOpenAmount = openAmount(item, consumptions, paymentApplications);
      if (currentOpenAmount <= 0) continue;
      const amount = Math.min(remaining, currentOpenAmount);
      remaining -= amount;
      paymentApplications.push({
        id: createId('app'),
        paymentId,
        accountId: accountEntry.id,
        userId: item.userId,
        consumptionItemId: item.id,
        amount,
        createdAt: input.createdAt
      });
    }

    payments.push({
      id: paymentId,
      accountId: accountEntry.id,
      targetType: input.targetType,
      userId: input.targetType === 'user' ? userEntry?.id : undefined,
      paidByUserId: paidByUserEntry.id,
      amount: input.amount,
      unappliedAmount: remaining,
      note: input.note,
      createdAt: input.createdAt
    });
  }

  addPayment({
    accountKey: 'perez',
    targetType: 'account',
    amount: 22000,
    note: 'Abono semanal demo',
    createdAt: daysAgo(3, 19)
  });
  addPayment({
    accountKey: 'perez',
    targetType: 'user',
    userKey: 'mama',
    amount: 9000,
    note: 'Pago directo de Mama',
    createdAt: daysAgo(1, 20)
  });
  addPayment({
    accountKey: 'casa',
    targetType: 'account',
    amount: 14000,
    note: 'Transferencia Nequi demo',
    createdAt: daysAgo(2, 18, 15)
  });
  addPayment({
    accountKey: 'oficina',
    targetType: 'account',
    amount: 20000,
    note: 'Caja menor oficina',
    createdAt: daysAgo(1, 17, 30)
  });
  addPayment({
    accountKey: 'invitados',
    targetType: 'user',
    userKey: 'invitada',
    amount: 8000,
    note: 'Pago con credito a favor',
    createdAt: daysAgo(0, 10, 15)
  });

  function addBalanceAdjustment(input: {
    accountKey: string;
    scope: 'account' | 'user';
    userKey?: string;
    amount: number;
    note: string;
    createdAt: string;
  }) {
    const accountEntry = accountsByKey.get(input.accountKey);
    if (!accountEntry) throw new Error(`Cuenta demo no encontrada: ${input.accountKey}`);
    const userEntry = input.userKey ? usersByKey.get(input.userKey) : undefined;
    adjustments.push({
      id: createId('adj'),
      accountId: accountEntry.id,
      scope: input.scope,
      userId: input.scope === 'user' ? userEntry?.id : undefined,
      amount: input.amount,
      note: input.note,
      createdAt: input.createdAt
    });
  }

  addBalanceAdjustment({
    accountKey: 'perez',
    scope: 'account',
    amount: -1500,
    note: 'Descuento cierre semana',
    createdAt: daysAgo(1, 19)
  });
  addBalanceAdjustment({
    accountKey: 'oficina',
    scope: 'user',
    userKey: 'daniel',
    amount: 1200,
    note: 'Ajuste redondeo pendiente',
    createdAt: daysAgo(0, 8, 45)
  });
  addBalanceAdjustment({
    accountKey: 'casa',
    scope: 'user',
    userKey: 'luis',
    amount: -1000,
    note: 'Bonificacion cumpleanos',
    createdAt: daysAgo(1, 9, 15)
  });

  function addInventoryAdjustment(productKey: string, quantityDelta: number, note: string, createdAt: string) {
    const product = productsByKey.get(productKey);
    if (!product) throw new Error(`Producto demo no encontrado: ${productKey}`);
    if (quantityDelta > 0) {
      inventoryLots.push({
        id: createId('lot'),
        productId: product.id,
        purchaseId: 'demo_adjustment',
        quantity: quantityDelta,
        remainingQuantity: quantityDelta,
        unitCost: product.lastCost,
        createdAt
      });
    }
    inventoryMovements.push({
      id: createId('mov'),
      productId: product.id,
      type: 'adjustment',
      quantityDelta,
      unitCost: product.lastCost,
      note,
      createdAt
    });
  }

  addInventoryAdjustment('agua', 4, 'Ajuste conteo nevera', daysAgo(0, 8, 30));
  addInventoryAdjustment('galletas', -2, 'Merma producto roto', daysAgo(0, 8, 35));

  const settings: Setting[] = [
    { key: 'seeded', value: 'true' },
    { key: 'demo_seed_version', value: DEMO_SEED_VERSION },
    { key: 'demo_cleanup_version', value: DEMO_CLEANUP_VERSION },
    { key: 'admin_pin_hash', value: adminPinHash },
    { key: 'sheet_id', value: import.meta.env.VITE_DEFAULT_SHEET_ID ?? '' }
  ];

  return {
    accounts,
    users,
    products,
    consumptions,
    consumptionItems,
    payments,
    paymentApplications,
    purchases,
    inventoryLots,
    inventoryMovements,
    adjustments,
    settings
  };
}

async function clearLocalData(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.accounts,
      db.users,
      db.products,
      db.consumptions,
      db.consumptionItems,
      db.payments,
      db.paymentApplications,
      db.purchases,
      db.inventoryLots,
      db.inventoryMovements,
      db.adjustments,
      db.accountTransfers,
      db.syncOperations,
      db.exportBatches,
      db.settings
    ],
    async () => {
      await db.accounts.clear();
      await db.users.clear();
      await db.products.clear();
      await db.consumptions.clear();
      await db.consumptionItems.clear();
      await db.payments.clear();
      await db.paymentApplications.clear();
      await db.purchases.clear();
      await db.inventoryLots.clear();
      await db.inventoryMovements.clear();
      await db.adjustments.clear();
      await db.accountTransfers.clear();
      await db.syncOperations.clear();
      await db.exportBatches.clear();
      await db.settings.clear();
    }
  );
}

async function writeDemoData(options: { skipIfSeeded?: boolean } = {}): Promise<void> {
  const demo = await buildDemoData();

  await db.transaction(
    'rw',
    [
      db.accounts,
      db.users,
      db.products,
      db.consumptions,
      db.consumptionItems,
      db.payments,
      db.paymentApplications,
      db.purchases,
      db.inventoryLots,
      db.inventoryMovements,
      db.adjustments,
      db.settings
    ],
    async () => {
      if (options.skipIfSeeded) {
        const [seedVersion, productCount] = await Promise.all([
          db.settings.get('demo_seed_version'),
          db.products.count()
        ]);
        if (seedVersion?.value === DEMO_SEED_VERSION || productCount > 0) return;
      }
      await db.accounts.bulkAdd(demo.accounts);
      await db.users.bulkAdd(demo.users);
      await db.products.bulkAdd(demo.products);
      await db.consumptions.bulkAdd(demo.consumptions);
      await db.consumptionItems.bulkAdd(demo.consumptionItems);
      await db.payments.bulkAdd(demo.payments);
      await db.paymentApplications.bulkAdd(demo.paymentApplications);
      await db.purchases.bulkAdd(demo.purchases);
      await db.inventoryLots.bulkAdd(demo.inventoryLots);
      await db.inventoryMovements.bulkAdd(demo.inventoryMovements);
      await db.adjustments.bulkAdd(demo.adjustments);
      await db.settings.bulkPut(demo.settings);
    }
  );
}

async function addMissingCatalogProducts(): Promise<void> {
  const existingProducts = await db.products.toArray();
  const existingNames = new Set(existingProducts.map((product) => normalizeProductName(product.name)));
  const timestamp = nowIso();
  const products: Product[] = [];
  const purchases: Purchase[] = [];
  const inventoryLots: InventoryLot[] = [];
  const inventoryMovements: InventoryMovement[] = [];

  productSeeds.forEach((seed, index) => {
    if (existingNames.has(normalizeProductName(seed.name))) return;
    const product: Product = {
      id: createId('prd'),
      name: seed.name,
      category: seed.category,
      price: seed.price,
      stockMin: seed.stockMin,
      lastCost: seed.lastCost,
      imageUrl: seed.imageUrl,
      imageSourceUrl: seed.imageSourceUrl,
      imageCredit: seed.imageCredit,
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const createdAt = addMinutes(timestamp, index);
    const purchase: Purchase = {
      id: createId('pur'),
      productId: product.id,
      quantity: seed.initialStock,
      unitCost: seed.lastCost,
      totalCost: seed.initialStock * seed.lastCost,
      note: 'Catalogo demo ampliado',
      createdAt
    };

    products.push(product);
    purchases.push(purchase);
    inventoryLots.push({
      id: createId('lot'),
      productId: product.id,
      purchaseId: purchase.id,
      quantity: seed.initialStock,
      remainingQuantity: seed.initialStock,
      unitCost: seed.lastCost,
      createdAt
    });
    inventoryMovements.push({
      id: createId('mov'),
      productId: product.id,
      type: 'purchase',
      quantityDelta: seed.initialStock,
      unitCost: seed.lastCost,
      referenceId: purchase.id,
      note: 'Catalogo demo ampliado',
      createdAt
    });
  });

  await db.transaction('rw', db.products, db.purchases, db.inventoryLots, db.inventoryMovements, db.settings, async () => {
    if (products.length > 0) {
      await db.products.bulkAdd(products);
      await db.purchases.bulkAdd(purchases);
      await db.inventoryLots.bulkAdd(inventoryLots);
      await db.inventoryMovements.bulkAdd(inventoryMovements);
    }
    await db.settings.put({ key: 'demo_seed_version', value: DEMO_SEED_VERSION });
  });
}

async function hasDuplicateDemoProducts(): Promise<boolean> {
  const demoNames = catalogProductNames();
  const seen = new Set<string>();
  const products = await db.products.toArray();

  for (const product of products) {
    const name = normalizeProductName(product.name);
    if (!demoNames.has(name)) continue;
    if (seen.has(name)) return true;
    seen.add(name);
  }

  return false;
}

async function ensureDemoConsistency(): Promise<void> {
  const cleanupVersion = await db.settings.get('demo_cleanup_version');
  if (cleanupVersion?.value === DEMO_CLEANUP_VERSION) return;

  if (await hasDuplicateDemoProducts()) {
    await resetDemoData();
    return;
  }

  await db.settings.put({ key: 'demo_cleanup_version', value: DEMO_CLEANUP_VERSION });
}

export async function resetDemoData(): Promise<void> {
  await clearLocalData();
  await writeDemoData();
}

async function ensureSeedDataInternal(): Promise<void> {
  const seedVersion = await db.settings.get('demo_seed_version');
  if (seedVersion?.value === DEMO_SEED_VERSION) {
    await ensureDemoConsistency();
    return;
  }

  const [accountCount, productCount, consumptionCount, paymentCount, legacySeeded] = await Promise.all([
    db.accounts.count(),
    db.products.count(),
    db.consumptions.count(),
    db.payments.count(),
    db.settings.get('seeded')
  ]);

  if (accountCount === 0 && productCount === 0) {
    await writeDemoData({ skipIfSeeded: true });
    return;
  }

  if (legacySeeded?.value === 'true' && consumptionCount === 0 && paymentCount === 0) {
    await resetDemoData();
    return;
  }

  if (seedVersion?.value?.startsWith('demo-')) {
    await resetDemoData();
    return;
  }

  if (legacySeeded?.value === 'true') {
    await addMissingCatalogProducts();
    await ensureDemoConsistency();
  }
}

export async function ensureSeedData(): Promise<void> {
  ensureSeedDataPromise ??= ensureSeedDataInternal().finally(() => {
    ensureSeedDataPromise = null;
  });
  return ensureSeedDataPromise;
}
