import express from "express";
import { Webhook } from "standardwebhooks";
import { supabase } from "../config/supabaseClient.js"; // Ensure proper Supabase setup
import axios from "axios";
import { trackEvent } from "../mixpanel.js";
const router = express.Router();

const webhook = new Webhook(process.env.NEXT_PUBLIC_DODO_WEBHOOK_KEY);
router.post("/", express.raw({ type: "application/json" }), async (req, res) => {
    try {

    console.log("🔔 Received webhook from Dodo Payments");
    const rawBody = JSON.stringify(req.body);

    const webhookHeaders = {
      "webhook-id": req.headers["webhook-id"] || "",
      "webhook-signature": req.headers["webhook-signature"] || "",
      "webhook-timestamp": req.headers["webhook-timestamp"] || "",
    };

    await webhook.verify(rawBody, webhookHeaders);
    const payload = JSON.parse(rawBody);
    console.log(" Webhook Payload:", payload);

    const eventType = payload.type;
    const customerEmail = payload.data?.customer?.email;

    if (!customerEmail) {
      console.error(" Missing customer email in webhook payload.");
      return res.status(400).json({ error: "Invalid payload" });
    }

    if (eventType === "subscription.active") {
        console.log(`Activating subscription for ${customerEmail}...`);
      
        // Extract product_id from the event object
        const productId = event?.data?.product_id;
        if (!productId) {
          console.error("❌ Missing product_id in webhook event");
          return res.status(400).json({ error: "Missing product_id" });
        }
      
        // Determine subscription tier and duration based on product ID
        let subscriptionTier = "free";
        let subscriptionDuration = "monthly";
      
        const tierMap = {
          // Premium
          "pdt_hrJJLlSDOfTi0FGdx0WlI": { tier: "premium", duration: "yearly" }, // Global
          "pdt_HbxDpbFRynHdxLmvKD8HZ": { tier: "premium", duration: "yearly" }, // India
          "pdt_5JI7ZFfy9sdAuj48cSahD": { tier: "premium", duration: "monthly" }, // Global
          "pdt_ZXZM5pANYxgvdbd3Iu1iY": { tier: "premium", duration: "monthly" }, // India
      
          // Ultimate
          "pdt_MkzTqLKqf4Qs8m9Fk5LXL": { tier: "ultimate", duration: "yearly" }, // Global
          "pdt_eTPRuicmF7WMB30vSIRuT": { tier: "ultimate", duration: "yearly" }, // India
          "pdt_5NIn6ffAO2dEO1moYzsTp": { tier: "ultimate", duration: "monthly" }, // Global
          "pdt_UjV4LHdt1j3tfNu8MfTnW": { tier: "ultimate", duration: "monthly" }, // India
        };
      
        const matchedPlan = tierMap[productId];
      
        if (!matchedPlan) {
          console.error("❌ Unrecognized product_id:", productId);
          return res.status(400).json({ error: "Invalid product_id" });
        }
      
        subscriptionTier = matchedPlan.tier;
        subscriptionDuration = matchedPlan.duration;
      
        // Update user profile in Supabase
        const { error } = await supabase
          .from("profiles")
          .update({
            is_premium: true,
            subscription_tier: subscriptionTier,
            subscription_duration: subscriptionDuration,
            last_usage_reset: new Date().toISOString(),
          })
          .eq("email", customerEmail);
      
        if (error) {
          console.error("❌ Failed to update user subscription:", error);
          return res.status(500).json({ error: "Database update failed" });
        }
      
        console.log(`✅ ${customerEmail} upgraded to ${subscriptionTier} (${subscriptionDuration})`);
      }
      

    else if (eventType === "subscription.renewed") {
      console.log(` Renewing premium status for ${customerEmail}`);

      const { error } = await supabase
        .from("profiles")
        .update({ is_premium: true, subscription_tier : 'ultimate',last_usage_reset: new Date().toISOString() })
        .eq("email", customerEmail);

      if (error) {
        console.error(" Failed to renew user premium status:", error);
        return res.status(500).json({ error: "Database update failed" });
      }
    }

    else if (eventType === "payment.succeeded") {
      console.log(`💰 Payment successful for ${customerEmail}`);
      console.log("📄 Payment Details:", payload.data);
     
    }

    else if (eventType === "subscription.cancelled") {
      console.log(` Downgrading ${customerEmail} to free tier`);

      const { error } = await supabase
        .from("profiles")
        .update({ is_premium: true, subscription_tier : 'free',last_usage_reset: new Date().toISOString() })
        .eq("email", customerEmail);

      if (error) {
        console.error("❌ Failed to downgrade user:", error);
        return res.status(500).json({ error: "Database downgrade failed" });
      }
    }
   
    else {
      console.log(` Unhandled webhook event: ${eventType}`);
    }
    trackEvent("","Payments",{
        type : eventType,
        email : customerEmail
      })
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ Webhook Processing Error:", error);
    trackEvent("","API Failure",{
        error : error?.message ?? "Error Message",
        type: "payments-webhook"
      })
    return res.status(500).json({ error: "Internal Server Error" });
  }
});




router.get("/ip-address", async (req, res) => {
  try {
    // Get IP address from request headers
    const forwardedFor = req.headers["x-forwarded-for"];
    const ip = forwardedFor ? forwardedFor.split(",")[0] : req.connection.remoteAddress;

    // Use ipapi.co or ipinfo.io to get geolocation info
    const { data } = await axios.get(`https://ipapi.co/${ip}/json/`);

    const countryCode = data.country || "IN"; // Fallback to "IN"

    // Determine payment link
    const isIndia = countryCode === "IN";

    const paymentLink = isIndia
      ? {"ultimate_monthly" : process.env.DODO_PAYMENT_LINK_INDIA,
         "ultimate_yearly": process.env.DODO_PAYMENT_LINK_INDIA_YEARLY,
         "premium_monthly": process.env.DODO_PAYMENT_LINK_INDIA_PREMIUM,
         "premium_yearly": process.env.DODO_PAYMENT_LINK_INDIA_PREMIUM_YEARLY
      }
      : {"ultimate_monthly" : process.env.DODO_PAYMENT_LINK_GLOBAL,
        "ultimate_yearly": process.env.DODO_PAYMENT_LINK_GLOBAL_YEARLY,
        "premium_monthly": process.env.DODO_PAYMENT_LINK_GLOBAL_PREMIUM,
        "premium_yearly": process.env.DODO_PAYMENT_LINK_GLOBAL_PREMIUM_YEARLY
     };

    return res.json({
      success: true,
      location: countryCode,
      paymentLink,
    });
  } catch (error) {
    console.error("❌ Failed to fetch geolocation or payment link:", error.message);
    return res.status(500).json({
      success: false,
      error: "Unable to determine location or generate payment link.",
    });
  }
});




export default router;
