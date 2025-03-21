import express from "express";
import { Webhook } from "standardwebhooks";
import { supabase } from "../config/supabaseClient.js"; // Adjust based on your project setup

const router = express.Router();

// Initialize webhook instance with secret key
const webhook = new Webhook(process.env.DODO_WEBHOOK_SECRET); 

router.post("/", express.text(), async (req, res) => {
  try {
    console.log("🔔 Received webhook from Dodo Payments");

    const webhookHeaders = {
      "webhook-id": req.headers["webhook-id"] || "",
      "webhook-signature": req.headers["webhook-signature"] || "",
      "webhook-timestamp": req.headers["webhook-timestamp"] || "",
    };

    // Verify the webhook signature
    await webhook.verify(req.body, webhookHeaders);

    const payload = JSON.parse(req.body);
    console.log("📦 Webhook Payload:", payload);

    // Extract important data
    const { event, data } = payload;
    
    if (!data || !data.customer || !data.customer.email) {
      console.error("❌ Missing customer email in webhook payload.");
      return res.status(400).json({ error: "Invalid payload" });
    }

    const userEmail = data.customer.email;
    const eventType = event.type;

    // ✅ Handle different webhook events
    if (eventType === "subscription.created" || eventType === "subscription.renewed") {
      console.log(`🎉 Premium subscription activated for ${userEmail}`);

      // 🔹 Mark user as premium in Supabase
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ is_premium: true })
        .eq("email", userEmail);

      if (updateError) {
        console.error("❌ Failed to update user as premium:", updateError);
        return res.status(500).json({ error: "Database update failed" });
      }
    } else if (eventType === "subscription.cancelled") {
      console.log(`🚨 Subscription cancelled for ${userEmail}`);

      // 🔹 Downgrade user to non-premium
      const { error: downgradeError } = await supabase
        .from("profiles")
        .update({ is_premium: false })
        .eq("email", userEmail);

      if (downgradeError) {
        console.error("❌ Failed to downgrade user:", downgradeError);
        return res.status(500).json({ error: "Database downgrade failed" });
      }
    } else {
      console.log("ℹ️ Unhandled webhook event:", eventType);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ Webhook Processing Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
