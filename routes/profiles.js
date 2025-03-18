import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { authenticateUser } from "../middleware/authMiddleware.js"; // Ensures user is logged in

const router = express.Router();

// **🔹 Get User Profile**
router.get("/", authenticateUser, async (req, res) => {
    try {
        const userId = req.user.id; // Extracted from authentication middleware

        console.log(`📌 Fetching profile for user: ${userId}`);

        // 🔹 Fetch user profile from Supabase
        const { data: profile, error } = await supabase
            .from("profiles")
            .select("id, full_name, date_of_birth, gender, height, weight, created_at")
            .eq("id", userId)
            .single(); // Ensures we get a single user profile

        if (error) {
            console.error("❌ Supabase Error Fetching Profile:", error);
            return res.status(500).json({ error: "Failed to fetch profile" });
        }

        if (!profile) {
            return res.status(404).json({ error: "Profile not found" });
        }

        console.log("✅ Profile fetched successfully:", profile);
        return res.json(profile);
    } catch (error) {
        console.error("❌ Server error fetching profile:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

export default router;
