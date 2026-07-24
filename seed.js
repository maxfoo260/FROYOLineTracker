// One-off seed script: `npm run seed`. Loads shop metadata into the database.
import { seedShops } from "./db.js";

const count = seedShops();
console.log(`Seeded ${count} froyo shops.`);
