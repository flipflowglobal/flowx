import { getUncachableStripeClient } from "./stripeClient.js";

async function createProducts() {
  try {
    const stripe = await getUncachableStripeClient();

    console.log("Seeding JDL subscription plans in Stripe...");

    const plans = [
      {
        name: "JDL Pro",
        description: "Pro subscription — 5 AI Agents, 6 chains, flash loans, full analytics. A$49/month.",
        tierKey: "pro",
        unitAmount: 4900,
        currency: "aud",
      },
      {
        name: "JDL Elite",
        description: "Elite subscription — Unlimited agents, all chains + DEX, custom strategies. A$299/month.",
        tierKey: "elite",
        unitAmount: 29900,
        currency: "aud",
      },
    ];

    for (const plan of plans) {
      const existing = await stripe.products.search({
        query: `name:'${plan.name}' AND active:'true'`,
      });

      if (existing.data.length > 0) {
        const prod = existing.data[0];
        console.log(`${plan.name} already exists: ${prod.id}`);

        const prices = await stripe.prices.list({ product: prod.id, active: true });
        if (prices.data.length > 0) {
          console.log(`  Price: ${prices.data[0].id} (${prices.data[0].unit_amount} ${prices.data[0].currency}/month)`);
        } else {
          const price = await stripe.prices.create({
            product: prod.id,
            unit_amount: plan.unitAmount,
            currency: plan.currency,
            recurring: { interval: "month" },
            metadata: { tier: plan.tierKey },
          });
          console.log(`  Created price: ${price.id}`);
        }
        continue;
      }

      const product = await stripe.products.create({
        name: plan.name,
        description: plan.description,
        metadata: { tier: plan.tierKey, platform: "jdl-trading" },
      });
      console.log(`Created product: ${product.name} (${product.id})`);

      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.unitAmount,
        currency: plan.currency,
        recurring: { interval: "month" },
        metadata: { tier: plan.tierKey },
      });
      console.log(`  Created price: ${price.id} (A$${plan.unitAmount / 100}/month)`);
    }

    console.log("Done seeding Stripe products.");
  } catch (error: any) {
    console.error("Error seeding products:", error.message);
    process.exit(1);
  }
}

createProducts();
