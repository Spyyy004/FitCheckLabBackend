import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { authenticateUser } from "../middleware/authMiddleware.js"; // Ensures user is logged in
import { trackEvent } from "../mixpanel.js";
const router = express.Router();

router.get("/", authenticateUser, async (req, res) => {

  try {

  

  const userId = req?.user?.id;

  if (!userId) {
    return res.status(401).json({ error: "Invalid token" });
  }


  // 🟡 Fetch premium status from `profiles`
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_premium")
    .eq("id", userId)
    .single();

  if (profileError) {
    console.error("❌ Failed to fetch user profile:", profileError);
    return res.status(500).json({ error: "Failed to fetch user profile." });
  }

  // 🔵 Fetch outfit analyses
  const { data, error: fetchError } = await supabase
    .from("outfit_analyses")
    .select("id, image_url, overall_score, created_at, analysis")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (fetchError) {
    console.error("❌ Failed to fetch outfit analyses:", fetchError);
    return res.status(500).json({ error: "Database error" });
  }

  const formattedData = data?.map((entry) => ({
    ...entry,
    date: entry.created_at ? new Date(entry.created_at).toISOString() : null,
    isPremium: profile.is_premium,
  }));

  res.json(formattedData);
}
catch(error){
  trackEvent("","API Failure",{
    error : error?.message ?? "Error Message",
    type: "recent-analysis"
  })
  return res.status(500).json({ error: "Some Error occured" });
}
});



export default router;
