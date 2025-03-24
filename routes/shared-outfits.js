import express from "express";
import { supabase } from "../config/supabaseClient.js"; // Update path if needed
import { v4 as uuidv4 } from "uuid"; // If you want to manually generate UUIDs
import { authenticateUser } from "../middleware/authMiddleware.js";

const router = express.Router();


router.post("/", authenticateUser,async (req, res) => {
    const { outfit_id, analysis_json, image_url, is_private } = req.body;
    const user_id = req.user?.id || null;
  
    if (!outfit_id || !analysis_json) {
      return res.status(400).json({ error: "Missing required fields" });
    }
  
    const { data, error } = await supabase
      .from("shared_outfits")
      .insert([
        {
          outfit_id,
          user_id,
          analysis_json,
          image_url,
          is_private: is_private || false,
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        }
      ])
      .select()
      .single();
  
    if (error) {
      console.error("Error creating shareable link:", error);
      return res.status(500).json({ error: "Failed to create shareable link" });
    }
  
    return res.status(201).json({ link_id: data.id });
  });

  
  router.get("/:id", async (req, res) => {
    const { id } = req.params;
  
    const { data, error } = await supabase
      .from("shared_outfits")
      .select("*")
      .eq("id", id)
      .single();
  
    if (error || !data) {
      return res.status(404).json({ error: "Shared outfit not found" });
    }
  
    // Check expiration
    if (new Date(data.expires_at) < new Date()) {
      return res.status(410).json({ error: "This link has expired" });
    }
  
    if (data.is_private && !req.user?.id) {
      return res.status(401).json({ error: "Login required to view this link" });
    }
  
    return res.status(200).json({
      analysis: data.analysis_json,
      image_url: data.image_url,
    });
  });

  
  router.delete("/:id", authenticateUser,async (req, res) => {
    const { id } = req.params;
  
    const { error } = await supabase
      .from("shared_outfits")
      .delete()
      .eq("id", id)
      .eq("user_id", req.user?.id);
  
    if (error) {
      return res.status(500).json({ error: "Failed to delete link" });
    }
  
    return res.status(200).json({ message: "Link deleted successfully" });
  });
  
  export default router;