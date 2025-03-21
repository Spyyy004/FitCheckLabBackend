import express from "express";
import { Webhook } from "standardwebhooks";
import { supabase } from "../config/supabaseClient.js"; // Ensure proper Supabase setup

const router = express.Router();
const webhook = new Webhook(process.env.NEXT_PUBLIC_DODO_WEBHOOK_KEY);

// Middleware to handle raw body parsing for webhook verification
router.post("/", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    console.log("🔔 Received webhook from Dodo Payments");

    // Ensure raw body is available as a string for verification
    const rawBody = req.body.toString();

    // Extract webhook headers
    const webhookHeaders = {
      "webhook-id": req.headers["webhook-id"] || "",
      "webhook-signature": req.headers["webhook-signature"] || "",
      "webhook-timestamp": req.headers["webhook-timestamp"] || "",
    };

    // Verify the webhook signature
    await webhook.verify(rawBody, webhookHeaders);

    // Parse JSON from raw string
    const payload = JSON.parse(rawBody);
    console.log("📦 Webhook Payload:", payload);

    // Extract required data
    const eventType = payload.type;
    const customerEmail = payload.data?.customer?.email;

    if (!customerEmail) {
      console.error("❌ Missing customer email in webhook payload.");
      return res.status(400).json({ error: "Invalid payload" });
    }

    // ✅ Handle subscription activation
    if (eventType === "subscription.active") {
      console.log(`🎉 Activating premium for ${customerEmail}`);

      const { error } = await supabase
        .from("profiles")
        .update({ is_premium: true })
        .eq("email", customerEmail);

      if (error) {
        console.error("❌ Failed to update user as premium:", error);
        return res.status(500).json({ error: "Database update failed" });
      }
    }

    // ✅ Handle subscription renewal
    else if (eventType === "subscription.renewed") {
      console.log(`🔄 Renewing premium status for ${customerEmail}`);

      const { error } = await supabase
        .from("profiles")
        .update({ is_premium: true })
        .eq("email", customerEmail);

      if (error) {
        console.error("❌ Failed to renew user premium status:", error);
        return res.status(500).json({ error: "Database update failed" });
      }
    }

    // ✅ Handle successful payment (log only, does not affect is_premium status)
    else if (eventType === "payment.succeeded") {
      console.log(`💰 Payment successful for ${customerEmail}`);
      console.log("📄 Payment Details:", payload.data);
      // You can log this payment into a `payments` table if needed.
    }

    // ✅ Handle subscription cancellation
    else if (eventType === "subscription.cancelled") {
      console.log(`🚨 Downgrading ${customerEmail} to free tier`);

      const { error } = await supabase
        .from("profiles")
        .update({ is_premium: false })
        .eq("email", customerEmail);

      if (error) {
        console.error("❌ Failed to downgrade user:", error);
        return res.status(500).json({ error: "Database downgrade failed" });
      }
    }

    // 🚨 If event type is unknown
    else {
      console.log(`⚠️ Unhandled webhook event: ${eventType}`);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ Webhook Processing Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
3