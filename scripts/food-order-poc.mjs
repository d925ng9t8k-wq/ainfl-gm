#!/usr/bin/env node

/**
 * Food Ordering Proof-of-Concept for 9 Enterprises Pilot
 *
 * Uses the unofficial Domino's Pizza API (npm: dominos) to:
 *   1. Find the nearest open Domino's store
 *   2. Browse the menu
 *   3. Build an order (pepperoni pizza)
 *   4. Validate and price the order
 *   5. (Optionally) place the order with payment
 *
 * Usage:
 *   DRY_RUN=true node scripts/food-order-poc.mjs           # Safe: validate + price only
 *   PLACE_ORDER=true node scripts/food-order-poc.mjs        # Actually places the order
 *
 * Required env vars for real orders:
 *   DOMINOS_FIRST_NAME, DOMINOS_LAST_NAME, DOMINOS_PHONE, DOMINOS_EMAIL
 *   DOMINOS_ADDRESS (full delivery address string)
 *   DOMINOS_CARD_NUMBER, DOMINOS_CARD_EXPIRY, DOMINOS_CARD_CVV, DOMINOS_CARD_ZIP
 *   DOMINOS_TIP (optional, defaults to 5.00)
 */

import { Order, Customer, Item, Payment, NearbyStores, Menu } from 'dominos';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DRY_RUN = process.env.PLACE_ORDER !== 'true';

const DEFAULT_ADDRESS = '1 Fountain Square Plaza, Cincinnati, OH 45202'; // placeholder

const config = {
  firstName:  process.env.DOMINOS_FIRST_NAME || 'Test',
  lastName:   process.env.DOMINOS_LAST_NAME  || 'User',
  phone:      process.env.DOMINOS_PHONE      || '5135551234',
  email:      process.env.DOMINOS_EMAIL       || 'test@example.com',
  address:    process.env.DOMINOS_ADDRESS     || DEFAULT_ADDRESS,
  card: {
    number:     process.env.DOMINOS_CARD_NUMBER || '',
    expiration: process.env.DOMINOS_CARD_EXPIRY || '',
    cvv:        process.env.DOMINOS_CARD_CVV    || '',
    zip:        process.env.DOMINOS_CARD_ZIP    || '',
  },
  tip: parseFloat(process.env.DOMINOS_TIP || '5.00'),
};

// ---------------------------------------------------------------------------
// Step 1: Find the nearest open Domino's store
// ---------------------------------------------------------------------------

async function findNearestStore(address) {
  console.log(`\n[1/5] Finding nearest Domino's to: ${address}`);

  const nearbyStores = await new NearbyStores(address);

  let bestStore = null;
  let bestDistance = Infinity;

  for (const store of nearbyStores.stores) {
    if (
      store.IsOnlineCapable &&
      store.IsDeliveryStore &&
      store.IsOpen &&
      store.ServiceIsOpen?.Delivery &&
      store.MinDistance < bestDistance
    ) {
      bestDistance = store.MinDistance;
      bestStore = store;
    }
  }

  if (!bestStore) {
    throw new Error('No open Domino\'s delivery stores found nearby.');
  }

  console.log(`    Found: Store #${bestStore.StoreID}`);
  console.log(`    Address: ${bestStore.AddressDescription}`);
  console.log(`    Distance: ${bestStore.MinDistance} mi`);
  console.log(`    Phone: ${bestStore.Phone}`);

  return bestStore;
}

// ---------------------------------------------------------------------------
// Step 2: Browse the menu (optional, for discovery)
// ---------------------------------------------------------------------------

async function browseMenu(storeID) {
  console.log(`\n[2/5] Fetching menu for store #${storeID}`);

  const menu = await new Menu(storeID);

  // Find pizza category and list some items
  const products = menu.menu?.products || {};
  const pizzaProducts = [];

  for (const [code, product] of Object.entries(products)) {
    if (product.ProductType === 'Pizza' ||
        (product.Tags?.DefaultSides && code.includes('PIZZA')) ||
        product.Name?.toLowerCase().includes('pizza')) {
      pizzaProducts.push({ code, name: product.Name, description: product.Description });
    }
  }

  if (pizzaProducts.length > 0) {
    console.log(`    Found ${pizzaProducts.length} pizza products. Sample:`);
    for (const p of pizzaProducts.slice(0, 5)) {
      console.log(`      ${p.code}: ${p.name}`);
    }
  }

  return menu;
}

// ---------------------------------------------------------------------------
// Step 3: Build the order
// ---------------------------------------------------------------------------

function buildPepperoniPizzaOrder(customer, storeID) {
  console.log(`\n[3/5] Building pepperoni pizza order`);

  // 14SCREEN = Large (14") Hand Tossed
  // Options: X = sauce, C = cheese, P = pepperoni
  // '1/1' means whole pizza, value '1' = normal amount, '1.5' = extra
  const pepperoniPizza = new Item({
    code: '14SCREEN',
    options: {
      X:  { '1/1': '1' },    // Regular sauce, whole pizza
      C:  { '1/1': '1' },    // Regular cheese, whole pizza
      P:  { '1/1': '1.5' },  // Extra pepperoni, whole pizza
    },
    quantity: 1,
  });

  console.log(`    Item: Large Hand Tossed Pepperoni Pizza (14SCREEN)`);
  console.log(`    Pepperoni: Extra`);

  const order = new Order(customer);
  order.storeID = storeID;
  order.addItem(pepperoniPizza);

  return order;
}

// ---------------------------------------------------------------------------
// Step 4: Validate and price
// ---------------------------------------------------------------------------

async function validateAndPrice(order) {
  console.log(`\n[4/5] Validating and pricing order`);

  await order.validate();
  console.log(`    Validation: PASSED`);

  await order.price();

  const amounts = order.amountsBreakdown;
  console.log(`    Subtotal:  $${amounts?.foodAndBeverage || 'N/A'}`);
  console.log(`    Tax:       $${amounts?.tax || 'N/A'}`);
  console.log(`    Delivery:  $${amounts?.deliveryFee || 'N/A'}`);
  console.log(`    Total:     $${amounts?.customer || 'N/A'}`);

  return amounts;
}

// ---------------------------------------------------------------------------
// Step 5: Place order (only when PLACE_ORDER=true)
// ---------------------------------------------------------------------------

async function placeOrder(order, cardConfig, tipAmount) {
  console.log(`\n[5/5] Placing order...`);

  if (!cardConfig.number || !cardConfig.expiration || !cardConfig.cvv) {
    throw new Error(
      'Payment details not configured. Set DOMINOS_CARD_NUMBER, DOMINOS_CARD_EXPIRY, DOMINOS_CARD_CVV env vars.'
    );
  }

  const payment = new Payment({
    amount:       order.amountsBreakdown.customer,
    number:       cardConfig.number,
    expiration:   cardConfig.expiration,
    securityCode: cardConfig.cvv,
    postalCode:   cardConfig.zip,
    tipAmount:    tipAmount,
  });

  order.payments.push(payment);

  try {
    await order.place();
    console.log(`    Order placed successfully!`);
    console.log(`    Order ID: ${order.placeResponse?.Order?.OrderID || 'unknown'}`);
    return order.placeResponse;
  } catch (err) {
    console.error(`    Order failed:`, order.placeResponse?.Order?.StatusItems || err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('='.repeat(60));
  console.log('  9 Enterprises Pilot - Food Order POC (Domino\'s Pizza)');
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (validate + price only)' : 'LIVE ORDER'}`);
  console.log('='.repeat(60));

  // Create customer
  const customer = new Customer({
    address:   config.address,
    firstName: config.firstName,
    lastName:  config.lastName,
    phone:     config.phone,
    email:     config.email,
  });

  // Step 1: Find store
  const store = await findNearestStore(config.address);

  // Step 2: Browse menu (informational)
  await browseMenu(store.StoreID);

  // Step 3: Build order
  const order = buildPepperoniPizzaOrder(customer, store.StoreID);

  // Step 4: Validate and price
  const amounts = await validateAndPrice(order);

  // Step 5: Place order (or skip in dry run)
  if (DRY_RUN) {
    console.log(`\n[5/5] SKIPPED - Dry run mode. Set PLACE_ORDER=true to actually order.`);
    console.log(`\n${'='.repeat(60)}`);
    console.log('  DRY RUN COMPLETE - Order validated and priced successfully.');
    console.log(`  Would have ordered from Store #${store.StoreID}`);
    console.log(`  Total: $${amounts?.customer || 'N/A'} + $${config.tip} tip`);
    console.log('='.repeat(60));
  } else {
    const result = await placeOrder(order, config.card, config.tip);
    console.log(`\n${'='.repeat(60)}`);
    console.log('  ORDER PLACED SUCCESSFULLY');
    console.log('='.repeat(60));
  }
}

main().catch(err => {
  console.error('\nFATAL ERROR:', err.message);
  process.exit(1);
});
