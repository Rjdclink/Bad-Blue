import type { Express, Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(req: Request, secret: string): boolean {
  const id = req.header("svix-id"), ts = req.header("svix-timestamp"), sig = req.header("svix-signature");
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!id || !ts || !sig || !secret.startsWith("whsec_") || !Buffer.isBuffer(raw) || Math.abs(Date.now()/1000 - Number(ts)) > 300) return false;
  const digest = createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(id + "." + ts + "." + raw.toString("utf8")).digest();
  return sig.split(" ").some(part => {
    if (!part.startsWith("v1,")) return false;
    const value = Buffer.from(part.slice(3), "base64");
    return value.length === digest.length && timingSafeEqual(value, digest);
  });
}

const processed = new Set<string>();
export function registerResendForwardingWebhook(app: Express) {
  app.post("/api/webhooks/resend", async (req, res) => {
    const secret = process.env.RESEND_WEBHOOK_SECRET, key = process.env.RESEND_API_KEY;
    if (!secret || !key) return res.status(503).json({ error: "Not configured" });
    if (!verify(req, secret)) return res.status(401).json({ error: "Invalid signature" });
    if (req.body?.type !== "email.received") return res.json({ ok: true });
    const id = req.body?.data?.email_id;
    if (typeof id !== "string" || !/^[\w-]{8,100}$/.test(id)) return res.status(400).json({ error: "Invalid ID" });
    if (processed.has(id)) return res.json({ ok: true, duplicate: true });
    try {
      const headers = { Authorization: "Bearer " + key };
      const response = await fetch("https://api.resend.com/emails/receiving/" + encodeURIComponent(id), { headers, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error("Retrieve failed: " + response.status);
      const mail = await response.json() as { from?: string; to?: string[]; subject?: string; text?: string; html?: string };
      if (!mail.to?.some(to => to.toLowerCase() === "contact@legalwhat.com")) return res.json({ ok: true, skipped: true });
      const from = mail.from || "unknown", subject = mail.subject || "(no subject)";
      const sent = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "LegalWhat Mail <contact@legalwhat.com>",
          to: ["contact.badblue@gmail.com"],
          subject: ("Fwd: " + subject).slice(0, 500),
          text: "Forwarded from: " + from + "\nSubject: " + subject + "\n\n" + (mail.text || "[HTML message]"),
          ...(mail.html ? { html: "<p>Forwarded message from " + from.replace(/[<>&"]/g, "") + "</p><hr/>" + mail.html } : {}),
        }), signal: AbortSignal.timeout(15000)
      });
      if (!sent.ok) throw Error("Send failed: " + sent.status);
      processed.add(id);
      if (processed.size > 1000) processed.delete(processed.values().next().value!);
      return res.json({ ok: true });
    } catch (error) {
      console.error("[Resend forwarding]", error);
      return res.status(500).json({ error: "Forwarding failed" });
    }
  });
}
