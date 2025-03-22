import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { authenticateUser } from "../middleware/authMiddleware.js"; // Ensures user is logged in
import { trackEvent } from "../mixpanel.js";
const router = express.Router();

// **🔹 Get User Profile**
router.get("/", authenticateUser, async (req, res) => {
    try {
        const userId = req.user.id; // Extracted from authentication middleware


        // 🔹 Fetch user profile from Supabase, including profile image
        const { data: profile, error } = await supabase
            .from("profiles")
            .select("id, full_name, date_of_birth, gender, height, weight, profile_image_url, created_at, is_premium, ai_outfit_analysis_count, cloth_to_metadata_count, full_outfit_gen_count, ai_occasion_suggestion_count, ai_outfit_from_wardrobe_count, subscription_tier")
            .eq("id", userId)
            .single(); // Ensures we get a single user profile

        if (error) {
            console.error("❌ Supabase Error Fetching Profile:", error);
            return res.status(500).json({ error: "Failed to fetch profile" });
        }

        if (!profile) {
            return res.status(404).json({ error: "Profile not found" });
        }

        return res.json(profile);
    } catch (error) {
        console.error("❌ Server error fetching profile:", error);
        trackEvent("","API Failure",{
            error : error?.message ?? "Error Message",
            type: "get-profile"
          })
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

export default router;
