import crypto from "crypto";
import type { Express, Request, Response } from "express";
import { getSquareClient, getSquareLocationId } from "../squareClient";
import { getBaseUrl, getConfig } from "../config";
import {
  hasPaidServiceAccess,
  invalidatePaidAccessCache,
  isIdentityAuthenticated,
  issueLocalSessionCookie,
} from "../auth";
import {
  getLocalUserByIdHttp,
  updateLocalUserSubscriptionHttp,
  type StatelessLocalUser,
} from "../statelessLocalAuth";
import { sendLegalWhatSubscriptionNotification } from "../emailService";

const SUBSCRIPTION_NAME = "LegalWhat Subscription";
const SUBSCRIPTION_PRICE_CENTS = 1999;
const PAYMENT_NOTE_PREFIX = "legalwhat-subscription:";
const PLAN_CACHE_TTL_MS = 5 * 60_000;
let resolvedPlanCache: { id: string; expiresAt: number } | null = null;

async function persistSubscriptionState(
  update: Parameters<typeof updateLocalUserSubscriptionHttp>[0],
): Promise<StatelessLocalUser> {
  const user = await updateLocalUserSubscriptionHttp(update);
  invalidatePaidAccessCache(user.id);
  return user;
}

function configuredPlanVariationId(): string {
  const value = String(getConfig().SQUARE_SUBSCRIPTION_PLAN_VARIATION_ID || "").trim();
  if (!value || /placeholder/i.test(value)) {
    throw new Error("Square subscription plan variation is not configured");
  }
  return value;
}

function phaseIsMonthly(phase: any): boolean {
  return String(phase?.cadence || "").toUpperCase() === "MONTHLY";
}

function staticPhaseIs1999(phase: any): boolean {
  const pricing = phase?.pricing || {};
  const amount = Number(pricing?.price?.amount ?? pricing?.priceMoney?.amount ?? NaN);
  const currency = String(pricing?.price?.currency || pricing?.priceMoney?.currency || "").toUpperCase();
  return phaseIsMonthly(phase) && String(pricing?.type || "").toUpperCase() === "STATIC" && amount === SUBSCRIPTION_PRICE_CENTS && currency === "USD";
}

function relativePhaseIsMonthly(phase: any): boolean {
  return phaseIsMonthly(phase) && String(phase?.pricing?.type || "").toUpperCase() === "RELATIVE";
}

function activeCatalogObject(object: any): boolean {
  if (!object) return false;
  if (object?.isDeleted === true || object?.is_deleted === true) return false;
  if (object?.presentAtAllLocations === false || object?.present_at_all_locations === false) return false;
  return true;
}

function itemHas1999UsdVariation(item: any): boolean {
  if (!activeCatalogObject(item) || String(item?.type || "").toUpperCase() !== "ITEM") return false;
  const data = item?.itemData || item?.item_data || {};
  const variations = Array.isArray(data?.variations) ? data.variations : [];
  return variations.some((variation: any) => {
    if (!activeCatalogObject(variation)) return false;
    const variationData = variation?.itemVariationData || variation?.item_variation_data || {};
    const money = variationData?.priceMoney || variationData?.price_money || {};
    return Number(money?.amount ?? NaN) === SUBSCRIPTION_PRICE_CENTS && String(money?.currency || "").toUpperCase() === "USD";
  });
}

function planVariationData(variation: any): any {
  return variation?.subscriptionPlanVariationData || variation?.subscription_plan_variation_data || {};
}

function planData(plan: any): any {
  return plan?.subscriptionPlanData || plan?.subscription_plan_data || {};
}

function variationIsStaticMonthly1999(variation: any): boolean {
  if (!activeCatalogObject(variation) || String(variation?.type || "").toUpperCase() !== "SUBSCRIPTION_PLAN_VARIATION") return false;
  const phases = Array.isArray(planVariationData(variation)?.phases) ? planVariationData(variation).phases : [];
  return phases.length === 1 && staticPhaseIs1999(phases[0]);
}

function variationIsRelativeMonthlyFor1999Item(variation: any, parentPlan: any, itemIds1999: Set<string>): boolean {
  if (!activeCatalogObject(variation) || String(variation?.type || "").toUpperCase() !== "SUBSCRIPTION_PLAN_VARIATION") return false;
  const phases = Array.isArray(planVariationData(variation)?.phases) ? planVariationData(variation).phases : [];
  if (phases.length !== 1 || !relativePhaseIsMonthly(phases[0])) return false;
  const data = planData(parentPlan);
  const eligibleIds = (data?.eligibleItemIds || data?.eligible_item_ids || []).map((id: unknown) => String(id));
  if (eligibleIds.some((id: string) => itemIds1999.has(id))) return true;
  return Boolean(data?.allItems || data?.all_items) && itemIds1999.size === 1;
}

async function squareCatalogSnapshot(square: ReturnType<typeof getSquareClient>): Promise<{ plans: any[]; itemIds1999: Set<string> }> {
  const plans: any[] = [];
  const itemIds1999 = new Set<string>();
  for await (const object of await square.catalog.list({ types: "ITEM,SUBSCRIPTION_PLAN" }, SQUARE_REQUEST_OPTIONS) as any) {
    const type = String(object?.type || "").toUpperCase();
    if (type === "ITEM" && itemHas1999UsdVariation(object)) itemIds1999.add(String(object.id || ""));
    if (type === "SUBSCRIPTION_PLAN" && activeCatalogObject(object)) plans.push(object);
  }
  return { plans, itemIds1999 };
}

function matchingVariations(plans: any[], itemIds1999: Set<string>): any[] {
  const matches: any[] = [];
  for (const plan of plans) {
    const data = planData(plan);
    const variations = data?.subscriptionPlanVariations || data?.subscription_plan_variations || [];
    for (const variation of Array.isArray(variations) ? variations : []) {
      if (variationIsStaticMonthly1999(variation) || variationIsRelativeMonthlyFor1999Item(variation, plan, itemIds1999)) matches.push(variation);
    }
  }
  return matches;
}

async function resolvePlanVariationId(square: ReturnType<typeof getSquareClient>): Promise<string> {
  if (resolvedPlanCache && resolvedPlanCache.expiresAt > Date.now()) return resolvedPlanCache.id;

  const configured = configuredPlanVariationId();
  const snapshot = await squareCatalogSnapshot(square);
  const matches = matchingVariations(snapshot.plans, snapshot.itemIds1999);
  const uniqueIds = [...new Set(matches.map((variation) => String(variation?.id || "").trim()).filter(Boolean))];

  if (uniqueIds.includes(configured)) {
    resolvedPlanCache = { id: configured, expiresAt: Date.now() + PLAN_CACHE_TTL_MS };
    return configured;
  }
  if (uniqueIds.length !== 1) {
    throw new Error(`Expected exactly one Square MONTHLY variation resolving to $19.99; found ${uniqueIds.length}`);
  }

  const id = uniqueIds[0];
  resolvedPlanCache = { id, expiresAt: Date.now() + PLAN_CACHE_TTL_MS };
  console.log("[SUBSCRIPTION] Resolved canonical $19.99/month Square plan variation from Catalog");
  return id;
}

function isSuspended(user: Pick<StatelessLocalUser, "status"> | null | undefined): boolean {
  return String(user?.status || "").trim().toLowerCase() === "suspended";
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

const SQUARE_REQUEST_OPTIONS = { timeoutInSeconds: 10, maxRetries: 2 } as const;

async function subscriptionsForCustomer(
  square: ReturnType<typeof getSquareClient>,
  customerId: string,
  locationId: string,
): Promise<any[]> {
  const response = await square.subscriptions.search({
    query: {
      filter: {
        customerIds: [customerId],
        locationIds: [locationId],
      },
    },
    limit: 100,
  }, SQUARE_REQUEST_OPTIONS);
  return Array.isArray(response?.subscriptions) ? response.subscriptions : [];
}

function activeMatchingSubscription(items: any[], variationId: string): any | null {
  return items.find((item) =>
    String(item?.planVariationId || "") === variationId &&
    String(item?.status || "").toUpperCase() === "ACTIVE"
  ) || null;
}

async function bindAndReconcile(id: string, customerId: string): Promise<{ active: boolean; user: StatelessLocalUser }> {
  const currentUser = await getLocalUserByIdHttp(id);
  if (!currentUser) throw new Error("LegalWhat user was not found");
  if (isSuspended(currentUser)) {
    return { active: false, user: currentUser };
  }

  const pendingUser = await persistSubscriptionState({
    userId: id,
    squareCustomerId: customerId,
    status: "pending_payment",
    hasPaidForAccess: false,
  });

  const square = getSquareClient();
  const variationId = await resolvePlanVariationId(square);
  const items = await subscriptionsForCustomer(square, customerId, getSquareLocationId());
  const subscription = activeMatchingSubscription(items, variationId);
  if (!subscription) return { active: false, user: pendingUser };

  const user = await persistSubscriptionState({
    userId: id,
    squareCustomerId: customerId,
    squareSubscriptionId: String(subscription.id || ""),
    squarePlanVariationId: variationId,
    status: "active",
    hasPaidForAccess: true,
  });
  if (!currentUser.hasPaidForAccess) {
    void sendLegalWhatSubscriptionNotification(user).catch((error) =>
      console.error("[SUBSCRIPTION] Payment notification failed:", error instanceof Error ? error.message : String(error)));
  }
  return { active: true, user };
}

async function verifyCheckout(id: string, orderId: string): Promise<{ active: boolean; user: StatelessLocalUser }> {
  const square = getSquareClient();
  const orderBody = await square.orders.get({ orderId }, SQUARE_REQUEST_OPTIONS);
  const order = orderBody?.order;
  if (!order) throw new Error("Square order was not found");
  if (String(order.locationId || "") !== getSquareLocationId()) throw new Error("Square order location does not match");

  const tenders = Array.isArray(order.tenders) ? order.tenders : [];
  const paymentId = String(tenders.find((t: any) => t?.paymentId)?.paymentId || "").trim();
  if (!paymentId) {
    return {
      active: false,
      user: await persistSubscriptionState({ userId: id, status: "pending_payment", hasPaidForAccess: false }),
    };
  }

  const paymentBody = await square.payments.get({ paymentId }, SQUARE_REQUEST_OPTIONS);
  const payment = paymentBody?.payment;
  if (!payment) throw new Error("Square payment was not found");
  if (String(payment.status || "").toUpperCase() !== "COMPLETED") {
    return {
      active: false,
      user: await persistSubscriptionState({ userId: id, status: "pending_payment", hasPaidForAccess: false }),
    };
  }
  if (String(payment.orderId || "") !== orderId) throw new Error("Square payment does not belong to this order");
  if (String(payment.note || "") !== noteForUser(id)) throw new Error("Square payment identity does not match");
  if (Number(payment.amountMoney?.amount || 0) !== SUBSCRIPTION_PRICE_CENTS ||
      String(payment.amountMoney?.currency || "").toUpperCase() !== "USD") {
    throw new Error("Square payment amount does not match the LegalWhat subscription");
  }

  const customerId = String(payment.customerId || order.customerId || "").trim();
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
    const variationId = await resolvePlanVariationId(getSquareClient());
    if (!subscription || String(subscription.plan_variation_id || "") !== variationId) return false;
    const customerId = String(subscription.customer_id || "").trim();
    const subscriptionId = String(subscription.id || "").trim();
    if (!customerId || !subscriptionId) throw new Error("Square subscription webhook identity is incomplete");

    // Reconcile the customer's complete current Square state before revoking.
    // This prevents a stale/canceled older subscription event from disabling a
    // newer active LegalWhat subscription for the same customer.
    const square = getSquareClient();
    const items = await subscriptionsForCustomer(square, customerId, getSquareLocationId());
    const activeSubscription = activeMatchingSubscription(items, variationId);
    if (activeSubscription) {
      // The completed-payment path binds this Square customer ID to the LegalWhat
      // user. Once Square's current state becomes ACTIVE, that durable binding is
      // sufficient to finish activation even if the browser has already closed.
      // Unknown customers are ignored here; their payment webhook can bind them
      // later and immediately reconcile this same current Square state.
      try {
        await persistSubscriptionState({
          squareCustomerId: customerId,
          squareSubscriptionId: String(activeSubscription.id || subscriptionId),
          squarePlanVariationId: variationId,
          status: "active",
          hasPaidForAccess: true,
        });
      } catch (error) {
        if (/User not found for Square subscription/i.test(error instanceof Error ? error.message : String(error))) {
          return true;
        }
        throw error;
      }
      return true;
    }

    // Never authorize from the status embedded in the delivery itself. Square
    // retries and out-of-order delivery can replay an older ACTIVE event after a
    // pause/cancel. The just-fetched customer subscription set is the authority.
    const currentSubscription = items.find((item) =>
      String(item?.id || "") === subscriptionId &&
      String(item?.planVariationId || "") === variationId
    ) || null;
    const state = currentSubscription
      ? canonicalState(currentSubscription.status)
      : { status: "pending_payment", hasPaidForAccess: false };

    await persistSubscriptionState({
      squareCustomerId: customerId,
      squareSubscriptionId: subscriptionId,
      squarePlanVariationId: variationId,
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
      if ((req.user as any)?.isMasterBypass) return res.json({ alreadyActive: true, redirectUrl: "/lexara-consent" });

      const id = userId(req);
      const email = userEmail(req);
      if (!id || !email) return res.status(400).json({ message: "A signed-in user email is required" });

      const current = await getLocalUserByIdHttp(id);
      if (!current) return res.status(401).json({ message: "User account was not found" });
      if (isSuspended(current)) {
        return res.status(403).json({
          message: "This account is suspended and cannot start subscription checkout",
          code: "ACCOUNT_SUSPENDED",
        });
      }
      if (hasPaidServiceAccess(current)) {
        return res.json({ alreadyActive: true, redirectUrl: "/lexara-consent" });
      }

      const square = getSquareClient();
      const response = await square.checkout.paymentLinks.create({
        idempotencyKey: crypto.randomUUID(),
        quickPay: {
          name: SUBSCRIPTION_NAME,
          priceMoney: { amount: BigInt(SUBSCRIPTION_PRICE_CENTS), currency: "USD" },
          locationId: getSquareLocationId(),
        },
        checkoutOptions: {
          allowTipping: false,
          subscriptionPlanId: await resolvePlanVariationId(square),
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
      if ((req.user as any)?.isMasterBypass) return res.json({ active: true, redirectTo: "/lexara-consent" });

      const id = userId(req);
      const orderId = typeof req.body?.orderId === "string" ? req.body.orderId.trim() : "";
      if (!id) return res.status(401).json({ message: "Authentication required" });
      if (!orderId || !/^[A-Za-z0-9_-]{6,200}$/.test(orderId)) {
        return res.status(400).json({ message: "A valid Square order is required" });
      }

      const current = await getLocalUserByIdHttp(id);
      if (!current) return res.status(401).json({ message: "User account was not found" });
      if (isSuspended(current)) {
        return res.status(403).json({
          active: false,
          message: "This account is suspended",
          code: "ACCOUNT_SUSPENDED",
        });
      }

      const result = await verifyCheckout(id, orderId);
      if (!result.active) {
        return res.status(202).json({ active: false, pending: true, message: "Square is still finalizing the subscription" });
      }

      issueLocalSessionCookie(res, result.user);
      return res.json({ active: true, redirectTo: "/lexara-consent" });
    } catch (error) {
      console.error("[SUBSCRIPTION] Checkout verification failed:", error instanceof Error ? error.message : String(error));
      return res.status(503).json({ message: "Subscription verification is temporarily unavailable" });
    }
  });
}
