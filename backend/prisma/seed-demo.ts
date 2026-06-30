import "dotenv/config";
import { prisma } from "../src/prisma.js";
import { hashPassword } from "../src/lib/password.js";
import { encrypt } from "../src/lib/crypto.js";
import { VENDOR_COMMUNICATION, CUSTOMER_COMMUNICATION } from "../src/features/registry.js";

/**
 * Demo seed: a realistic auto-service tenant so the UI looks populated.
 * Idempotent — deletes any prior "Auto Service Demo SRL" org and rebuilds it.
 * Run: npm run db:seed:demo
 */

const ORG_NAME = "Auto Service Demo SRL";
const DEMO_EMAIL = "demo@flowforge.ro";
const DEMO_PASSWORD = "demo1234";

const MONTH_START = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
const NOW = new Date();

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}
/** A timestamp `n` of `total` evenly across this month up to now. */
function spread(n: number, total: number): Date {
  const span = NOW.getTime() - MONTH_START.getTime();
  return new Date(MONTH_START.getTime() + Math.floor((span * (n + 1)) / (total + 1)));
}

async function wipe() {
  const org = await prisma.organization.findFirst({ where: { name: ORG_NAME } });
  if (!org) return;
  const id = org.id;
  const mailboxes = await prisma.mailbox.findMany({ where: { orgId: id }, select: { id: true } });
  const mbxIds = mailboxes.map((m) => m.id);
  await prisma.orderReply.deleteMany({ where: { order: { orgId: id } } });
  await prisma.order.deleteMany({ where: { orgId: id } });
  await prisma.appointment.deleteMany({ where: { orgId: id } });
  await prisma.appointmentFieldConfig.deleteMany({ where: { orgId: id } });
  await prisma.usageEvent.deleteMany({ where: { orgId: id } });
  await prisma.organizationFeature.deleteMany({ where: { orgId: id } });
  if (mbxIds.length) {
    await prisma.seenMessage.deleteMany({ where: { mailboxId: { in: mbxIds } } });
    await prisma.mailboxFeature.deleteMany({ where: { mailboxId: { in: mbxIds } } });
    await prisma.mailbox.deleteMany({ where: { id: { in: mbxIds } } });
  }
  await prisma.user.deleteMany({ where: { orgId: id } });
  await prisma.organization.delete({ where: { id } });
  console.log(`Wiped existing "${ORG_NAME}".`);
}

async function main() {
  await wipe();

  const org = await prisma.organization.create({ data: { name: ORG_NAME } });

  const user = await prisma.user.create({
    data: {
      orgId: org.id,
      email: DEMO_EMAIL,
      passwordHash: await hashPassword(DEMO_PASSWORD),
      role: "admin",
      name: "Andrei Popescu",
    },
  });

  // Two mailboxes, one per pipeline.
  const vendorMbx = await prisma.mailbox.create({
    data: {
      orgId: org.id,
      microsoftId: `demo-vendor-${Date.now()}`,
      email: "comenzi@autoservice-demo.ro",
      encryptedRefreshToken: encrypt("demo-refresh-token"),
      connectedByUserId: user.id,
      lastPolledAt: new Date(NOW.getTime() - 5 * 60_000),
      features: { create: [{ featureKey: VENDOR_COMMUNICATION }] },
    },
  });
  const customerMbx = await prisma.mailbox.create({
    data: {
      orgId: org.id,
      microsoftId: `demo-customer-${Date.now()}`,
      email: "programari@autoservice-demo.ro",
      encryptedRefreshToken: encrypt("demo-refresh-token"),
      connectedByUserId: user.id,
      lastPolledAt: new Date(NOW.getTime() - 3 * 60_000),
      features: { create: [{ featureKey: CUSTOMER_COMMUNICATION }] },
    },
  });

  // Enable both features with monthly soft limits (some intentionally tight).
  await prisma.organizationFeature.createMany({
    data: [
      { orgId: org.id, featureKey: VENDOR_COMMUNICATION, enabled: true, config: {}, limits: { orders: 40, emailsSent: 200, llmCostUsd: 5 } },
      { orgId: org.id, featureKey: CUSTOMER_COMMUNICATION, enabled: true, config: {}, limits: { appointments: 20, emailsSent: 100, llmCostUsd: 3 } },
    ],
  });

  // Orders — varied status / reply / email state, some flagged, some closed.
  const vendors = ["piese@bosch-dist.ro", "comenzi@autototal.ro", "office@elit.ro", "vanzari@inter-cars.ro"];
  const chassis = ["WVWZZZ1KZAW", "WAUZZZ8K9BA", "WBA3B1C50EK", "VF1RFB00X66", "ZFA31200000"];
  const parts = ["BRK-PAD-front", "FLT-OIL-2.0TDI", "ALT-14V-150A", "SHK-ABS-rear", "TBL-kit-1.6"];
  const ORDER_COUNT = 34;
  for (let i = 0; i < ORDER_COUNT; i++) {
    const created = spread(i, ORDER_COUNT);

    // Mirror the real pipeline lifecycle — the only states the system can derive:
    //  - email failed to send  -> stays "În așteptare", nothing extracted
    //  - sent, no reply yet     -> "În așteptare" / awaiting_reply
    //  - vendor replied + extracted (offer) -> "extracted" / offer_pending
    //  - extracted, low confidence -> "needs_review"
    //  - manually closed by the user -> closedAt set
    // No "delivered"/"in transit"/"cancelled": we have no courier or supplier-cancel signal.
    const emailFailed = i % 11 === 0;
    const phase = emailFailed ? "failed" : (["awaiting", "offer", "review", "closed", "offer"] as const)[i % 5];
    const extracted = phase === "offer" || phase === "review" || phase === "closed";

    const status = phase === "review" ? "needs_review" : extracted ? "extracted" : "În așteptare";
    const replyStatus = emailFailed
      ? "awaiting_reply"
      : phase === "awaiting"
        ? "awaiting_reply"
        : phase === "review"
          ? "needs_review"
          : "offer_pending";

    await prisma.order.create({
      data: {
        orgId: org.id,
        mailboxId: vendorMbx.id,
        createdByUserId: user.id,
        vendorEmail: pick(vendors, i),
        chassisSeries: `${pick(chassis, i)}${100000 + i}`,
        partCode: pick(parts, i),
        registrationNumber: `B ${100 + i} ABC`,
        // Offer fields exist only once the vendor replied and we extracted them.
        offerPrice: extracted ? `${(120 + i * 7.5).toFixed(2)} RON` : null,
        orderNumber: extracted ? `CMD${4200 + i}` : null,
        deliveryTime: extracted ? pick(["2-3 zile", "în stoc", "5 zile lucrătoare"], i) : null,
        orderNumberConfidence: phase === "review" ? "low" : extracted ? "high" : null,
        deliveryConfidence: phase === "review" ? "low" : extracted ? "high" : null,
        reviewReasons: phase === "review" ? "Număr comandă incert\nTermen livrare ambiguu" : null,
        status,
        replyStatus,
        emailStatus: emailFailed ? "esuat" : "trimis",
        closedAt: phase === "closed" ? new Date(created.getTime() + 36 * 3600_000) : null,
        // User-reported "this order is wrong" — a real human action, kept.
        flaggedAt: i % 13 === 0 ? new Date(created.getTime() + 2 * 3600_000) : null,
        flaggedByUserId: i % 13 === 0 ? user.id : null,
        flagReason: i % 13 === 0 ? "Cod piesă greșit extras din ofertă" : null,
        createdAt: created,
      },
    });
  }

  // Appointment field config (what the customer pipeline collects).
  await prisma.appointmentFieldConfig.createMany({
    data: [
      { orgId: org.id, key: "nume", label: "Nume", description: "Numele clientului", required: true, sortOrder: 0 },
      { orgId: org.id, key: "telefon", label: "Telefon", description: "Număr de contact", required: true, sortOrder: 1 },
      { orgId: org.id, key: "masina", label: "Mașină", description: "Marcă și model", required: true, sortOrder: 2 },
      { orgId: org.id, key: "serviciu", label: "Serviciu", description: "Tip serviciu dorit", required: true, sortOrder: 3 },
      { orgId: org.id, key: "data", label: "Dată preferată", description: "Data programării", required: false, sortOrder: 4 },
    ],
  });

  // Appointments — mix of collecting / complete.
  const customers = ["ion.marin", "elena.dima", "vlad.nistor", "raluca.toma"];
  const domains = ["gmail.com", "yahoo.com", "outlook.com"];
  const cars = ["VW Golf 7", "Audi A4 B8", "Dacia Duster", "BMW 320d", "Ford Focus"];
  const services = ["Schimb ulei", "Revizie generală", "Frâne față", "Diagnoză", "Schimb anvelope"];
  const APPT_COUNT = 14;
  for (let i = 0; i < APPT_COUNT; i++) {
    const created = spread(i, APPT_COUNT);
    const complete = i % 3 !== 0;
    const fields: Record<string, string> = {
      nume: pick(["Ion Marin", "Elena Dima", "Vlad Nistor", "Raluca Toma"], i),
      telefon: `07${20 + (i % 70)} ${100 + i} ${200 + i}`,
      masina: pick(cars, i),
      serviciu: pick(services, i),
    };
    if (complete) fields.data = new Date(created.getTime() + 5 * 86400_000).toISOString().slice(0, 10);
    await prisma.appointment.create({
      data: {
        orgId: org.id,
        mailboxId: customerMbx.id,
        customerEmail: `${pick(customers, i)}${i}@${pick(domains, i)}`,
        conversationId: `demo-conv-${i}`,
        status: complete ? "complete" : "collecting",
        fields,
        lastMessageAt: new Date(created.getTime() + 3600_000),
        createdAt: created,
      },
    });
  }

  // Usage events attributed per feature so usage/quota dashboards show numbers.
  type UsageRow = {
    orgId: string;
    featureKey: string;
    kind: string;
    emails?: number;
    provider?: string;
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    costUsd?: number;
    outcome?: string;
    createdAt: Date;
  };
  const usage: UsageRow[] = [];
  // Vendor: email_read (poll), email_write (orders), llm (extraction).
  for (let i = 0; i < 50; i++) {
    const at = spread(i, 50);
    usage.push({ orgId: org.id, featureKey: VENDOR_COMMUNICATION, kind: "email_read", emails: 3, createdAt: at });
  }
  for (let i = 0; i < ORDER_COUNT; i++) {
    usage.push({ orgId: org.id, featureKey: VENDOR_COMMUNICATION, kind: "email_write", emails: 1, createdAt: spread(i, ORDER_COUNT) });
  }
  for (let i = 0; i < 40; i++) {
    const at = spread(i, 40);
    usage.push({ orgId: org.id, featureKey: VENDOR_COMMUNICATION, kind: "llm", provider: "openai", model: "gpt-4o-mini", promptTokens: 1200 + i * 10, completionTokens: 300 + i * 5, costUsd: 0.11, createdAt: at });
  }
  // Customer: classification, email_write, llm.
  for (let i = 0; i < 30; i++) {
    const at = spread(i, 30);
    usage.push({ orgId: org.id, featureKey: CUSTOMER_COMMUNICATION, kind: "classification", provider: "openai", model: "gpt-4o-mini", outcome: i % 2 === 0 ? "appointment" : "other", costUsd: 0.01, createdAt: at });
  }
  for (let i = 0; i < APPT_COUNT * 2; i++) {
    usage.push({ orgId: org.id, featureKey: CUSTOMER_COMMUNICATION, kind: "email_write", emails: 1, createdAt: spread(i, APPT_COUNT * 2) });
  }
  for (let i = 0; i < 25; i++) {
    usage.push({ orgId: org.id, featureKey: CUSTOMER_COMMUNICATION, kind: "llm", provider: "openai", model: "gpt-4o-mini", promptTokens: 900 + i * 8, completionTokens: 250, costUsd: 0.09, createdAt: spread(i, 25) });
  }
  await prisma.usageEvent.createMany({ data: usage });

  console.log(`Seeded "${org.name}" (${org.id})`);
  console.log(`  login: ${DEMO_EMAIL} / ${DEMO_PASSWORD} (role admin)`);
  console.log(`  ${ORDER_COUNT} orders, ${APPT_COUNT} appointments, ${usage.length} usage events`);
  console.log(`  mailboxes: ${vendorMbx.email} (vendor), ${customerMbx.email} (customer)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
