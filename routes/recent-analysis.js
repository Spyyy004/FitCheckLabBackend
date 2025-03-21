import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { authenticateUser } from "../middleware/authMiddleware.js"; // Ensures user is logged in

const router = express.Router();

router.get("/", async (req, res) => {
    const token = req.headers.authorization?.split(" ")[1];
  
    if (!token) {
      return res.status(401).json({ error: "Unauthorized. No token provided." });
    }
  
    const { data: user, error } = await supabase.auth.getUser(token);
  
    if (error || !user) {
      return res.status(401).json({ error: "Invalid token" });
    }
  
    const { data, error: fetchError } = await supabase
  .from("outfit_analyses")
  .select("id, image_url, overall_score, created_at, analysis")
  .eq("user_id", user.user.id)
  .order("created_at", { ascending: false })
  .limit(5);

  const formattedData = data?.map((entry) => ({
    ...entry,
    date: entry.created_at ? new Date(entry.created_at).toISOString() : null,
  }));
  
  
    if (fetchError) {

      return res.status(500).json({ error: "Database error"});
    }
  
    res.json(formattedData);
  });
  


export default router;
