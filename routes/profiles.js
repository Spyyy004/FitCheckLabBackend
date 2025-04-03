import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { authenticateUser } from "../middleware/authMiddleware.js"; // Ensures user is logged in
import { trackEvent } from "../mixpanel.js";
const router = express.Router();

// **🔹 Get User Profile**
router.get("/", authenticateUser, async (req, res) => {
    try {
        const userId = req.user.id; // Extracted from authentication middleware

        // Run both database queries in parallel
        const [profileResult, occasionsResult] = await Promise.all([
            // 🔹 Fetch user profile from Supabase, including profile image
            supabase
                .from("profiles")
                .select("id, full_name, date_of_birth, gender, height, weight, profile_image_url, created_at, is_premium, ai_outfit_analysis_count, cloth_to_metadata_count, full_outfit_gen_count, ai_occasion_suggestion_count, ai_outfit_from_wardrobe_count, subscription_tier")
                .eq("id", userId)
                .single(), // Ensures we get a single user profile
            
            // Fetch upcoming occasions
            supabase
                .from("occasions")
                .select("*")
                .eq("user_id", userId)
                .gte("date_time", new Date().toISOString())
                .order("date_time", { ascending: true })
                .limit(1)
        ]);

        const { data: profile, error } = profileResult;
        const { data: upcomingOccasions, error: occasionError } = occasionsResult;

        if (error) {
            console.error("❌ Supabase Error Fetching Profile:", error);
            return res.status(500).json({ error: "Failed to fetch profile" });
        }

        if (!profile) {
            return res.status(404).json({ error: "Profile not found" });
        }

        if (occasionError) {
            console.error("⚠️ Error fetching upcoming occasion:", occasionError);
        }
  
        const nextOccasion = upcomingOccasions?.[0] || null;

        return res.json({
            ...profile,
            next_occasion: nextOccasion,
        });
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
