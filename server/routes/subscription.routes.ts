import crypto from "crypto";
import type { Express, Request, Response } from "express";
import { getSquareClient, getSquareLocationId } from "../squareClient";
import { getBaseUrl, getConfig } from "../config";
import { isIdentityAuthenticated, issueLocalSessionCookie } from "../auth";
import { updateLocalUserSubscriptionHttp, type StatelessLocalUser } from "../statelessLocalAuth";

const SUBSCRIPTION_NAME = "LegalWhat Subscription";
const SUBSCRIPTION_PRICE_CENTS = 2599;
const PAYMENT_NOTE_PREFIX = "legalwhat-subscription:";

function planVariationId(): string {
  const value = String(getConfig().SQUARE_SUBSCRIPTION_PLAN_VARIATION_ID || "").trim();
  if (!value) throw new Error("Square subscription plan variation is not configured");
  return value;
}

function userId(req: Request): string {
  const user = req.user as any;
  return String(user?.id || user?.claims?.sub || "").trim();
}

function userEmail(req: Request): string {
  const user = req.user as any;
  return String(user?.email || user?.claims?.email || "").trim();
}

function noteForUser(id: string): string {
  return `${PAYMENT_NOTE_PREFIX}${id}`;
}

function userFromNote(note: unknown): string | null {
  const value = String(note || "");
  if (!value.startsWith(PAYMENT_NOTE_PREFIX)) return null;
  const id = value.slice(PAYMENT_NOTE_PREFIX.length).trim();
  return /^[A-Za-z0-9_-]{8,128}$/.test(id) ? id : null;
}

async function squareJson(square: any, path: string, init: RequestInit): Promise<any> {
  const response = await square.fetch(path, init, { timeoutInSeconds: 10, maxRetries: 2 });
  const raw = await response.text();
  let body: any = {};
  if (raw) {
    try { body = JSON.parse(raw); } catch { body = {}; }
  }
  if (!response.ok) {
    throw new Error(body?.errors?.[0]?.detail || `Square returned HTTP ${response.status}`);
  }
  return body;
}

async function subscriptionsForCustomer(square: any, customerId: string, locationId: string): Promise<any[]> {
  const body = await squareJson(square, "/v2/subscriptions/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: { filter: { customer_ids: [customerId], location_ids: [locationId] } },
      limit: 100,
    }),
  });
  return Array.isArray(body?.subscriptions) ? body.subscriptions : [];
}

function activeMatchingSubscription(items: any[], variationId: string): any | null {
  return items.find((item) =>
    String(item?.plan_variation_id || "") === variationId &&
    String(item?.status || "").toUpperCase() === "ACTIVE"
  ) || null;
}

async function bindAndReconcile(id: string, customerId: string): Promise<{ active: boolean; user: StatelessLocalUser }> {
  const pendingUser = await updateLocalUserSubscriptionHttp({
    userId: id,
    squareCustomerId: customerId,
    status: "pending_payment",
    hasPaidForAccess: false,
  });

  const square = getSquareClient() as any;
  const variationId = planVariationId();
  const items = await subscriptionsForCustomer(square, customerId, getSquareLocationId());
  const subscription = activeMatchingSubscription(items, variationId);
  if (!subscription) return { active: false, user: pendingUser };

  const user = await updateLocalUserSubscriptionHttp({
    userId: id,
    squareCustomerId: customerId,
    squareSubscriptionId: String(subscription.id || ""),
    squarePlanVariationId: variationId,
    status: "active",
    hasPaidForAccess: true,
  });
  return { active: true, user };
}

async function verifyCheckout(id: string, orderId: string): Promise<{ active: boolean; user: StatelessLocalUser }> {
  const square = getSquareClient() as any;
  const orderBody = await squareJson(square, `/v2/orders/${encodeURIComponent(orderId)}`, { method: "GET" });
  const order = orderBody?.order;
  if (!order) throw new Error("Square order was not found");
  if (String(order.location_id || "") !== getSquareLocationId()) throw new Error("Square order location does not match");

  const tenders = Array.isArray(order.tenders) ? order.tenders : [];
  const paymentId = String(tenders.find((t: any) => t?.payment_id)?.payment_id || "").trim();
  if (!paymentId) {
    return {
      active: false,
      user: await updateLocalUserSubscriptionHttp({ userId: id, status: "pending_payment", hasPaidForAccess: false }),
    };
  }

  const paymentBody = await squareJson(square, `/v2/payments/${encodeURIComponent(paymentId)}`, { method: "GET" });
  const payment = paymentBody?.payment;
  if (!payment) throw new Error("Square payment was not found");
  if (String(payment.status || "").toUpperCase() !== "COMPLETED") {
    return {
      active: false,
      user: await updateLocalUserSubscriptionHttp({ userId: id, status: "pending_payment", hasPaidForAccess: false }),
    };
  }
  if (String(payment.order_id || "") !== orderId) throw new Error("Square payment does not belong to this order");
  if (String(payment.note || "") !== noteForUser(id)) throw new Error("Square payment identity does not match");
  if (Number(payment.amount_money?.amount || 0) !== SUBSCRIPTION_PRICE_CENTS ||
      String(payment.amount_money?.currency || "").toUpperCase() !== "USD") {
    throw new Error("Square payment amount does not match the LegalWhat subscription");
  }

  const customerId = String(payment.customer_id || order.customer_id || "").trim();
  if (!customerId) throw new Error("Square customer is missing from the completed payment");
  return bindAndReconcile(id, customerId);
}

function canonicalState(status: unknown): { status: string; hasPaidForAccess: boolean } {
  switch (String(status || "").toUpperCase()) {
    case "ACTIVE": return { status: "active", hasPaidForAccess: true };
    case "PENDING": return { status: "pending_payment", hasPaidForAccess: false };
    case "PAUSED": return { status: "past_due", hasPaidForAccess: false };
    case "CANCELED": return { status: "canceled", hasPaidForAccess: false };
    case "DEACTIVATED":
    case "COMPLETED": return { status: "expired", hasPaidForAccess: false };
    default: return { status: "pending_payment", hasPaidForAccess: false };
  }
}

export async function handleLegalWhatSubscriptionWebhook(event: any): Promise<boolean> {
  const eventType = String(event?.type || "");
  const object = event?.data?.object || {};

  if (eventType === "payment.created" || eventType === "payment.updated") {
    const payment = object?.payment;
    const id = userFromNote(payment?.note);
    if (!id) return false;
    if (String(payment?.status || "").toUpperCase() !== "COMPLETED") return true;
    if (Number(payment?.amount_money?.amount || 0) !== SUBSCRIPTION_PRICE_CENTS ||
        String(payment?.amount_money?.currency || "").toUpperCase() !== "USD") {
      throw new Error("LegalWhat subscription webhook payment amount mismatch");
    }
    const customerId = String(payment?.customer_id || "").trim();
    if (!customerId) throw new Error("LegalWhat subscription webhook has no Square customer");
    await bindAndReconcile(id, customerId);
    return true;
  }

  if (eventType === "subscription.created" || eventType === "subscription.updated") {
    const subscription = object?.subscription;
    if (!subscription || String(subscription.plan_variation_id || "") !== planVariationId()) return false;
    const customerId = String(subscription.customer_id || "").trim();
    const subscriptionId = String(subscription.id || "").trim();
    if (!customerId || !subscriptionId) throw new Error("Square subscription webhook identity is incomplete");
    const state = canonicalState(subscription.status);
    await updateLocalUserSubscriptionHttp({
      squareCustomerId: customerId,
      squareSubscriptionId: subscriptionId,
      squarePlanVariationId: planVariationId(),
      status: state.status,
      hasPaidForAccess: state.hasPaidForAccess,
    });
    return true;
  }

  return false;
}

export function setupSubscriptionRoutes(app: Express): void {
  app.post("/api/subscription/checkout", isIdentityAuthenticated, async (req: Request, res: Response) => {
    try {
      if ((req.user as any)?.isMasterBypass) return res.json({ alreadyActive: true, redirectUrl: "/welcome" });

      const id = userId(req);
      const email = userEmail(req);
      if (!id || !email) return res.status(400).json({ message: "A signed-in user email is required" });

      const current = req.user as any;
      if (current?.status === "active" && current?.hasPaidForAccess === true) {
        return res.json({ alreadyActive: true, redirectUrl: "/welcome" });
      }

      const square = getSquareClient() as any;
      const response = await square.checkout.paymentLinks.create({
        idempotencyKey: crypto.randomUUID(),
        quickPay: {
          name: SUBSCRIPTION_NAME,
          priceMoney: { amount: BigInt(SUBSCRIPTION_PRICE_CENTS), currency: "USD" },
          locationId: getSquareLocationId(),
        },
        checkoutOptions: {
          allowTipping: false,
          subscriptionPlanId: planVariationId(),
          redirectUrl: `${getBaseUrl().replace(/\/$/, "")}/subscription-success`,
        },
        prePopulatedData: { buyerEmail: email },
        paymentNote: noteForUser(id),
      } as any);

      const checkoutUrl = String(response?.paymentLink?.url || "").trim();
      if (!checkoutUrl) throw new Error("Square did not return a checkout URL");
      return res.json({ checkoutUrl, orderId: response?.paymentLink?.orderId || null });
    } catch (error) {
      console.error("[SUBSCRIPTION] Checkout creation failed:", error instanceof Error ? error.message : String(error));
      return res.status(503).json({ message: "Subscription checkout is temporarily unavailable" });
    }
  });

  app.post("/api/subscription/confirm", isIdentityAuthenticated, async (req: Request, res: Response) => {
    try {
      if ((req.user as any)?.isMasterBypass) return res.json({ active: true, redirectTo: "/welcome" });

      const id = userId(req);
      const orderId = typeof req.body?.orderId === "string" ? req.body.orderId.trim() : "";
      if (!id) return res.status(401).json({ message: "Authentication required" });
      if (!orderId || !/^[A-Za-z0-9_-]{6,200}$/.test(orderId)) {
        return res.status(400).json({ message: "A valid Square order is required" });
      }

      const result = await verifyCheckout(id, orderId);
      if (!result.active) {
        return res.status(202).json({ active: false, pending: true, message: "Square is still finalizing the subscription" });
      }

      issueLocalSessionCookie(res, result.user);
      return res.json({ active: true, redirectTo: "/welcome" });
    } catch (error) {
      console.error("[SUBSCRIPTION] Checkout verification failed:", error instanceof Error ? error.message : String(error));
      return res.status(503).json({ message: "Subscription verification is temporarily unavailable" });
    }
  });
}
