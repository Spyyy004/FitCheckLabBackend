import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { authenticateUser } from "../middleware/authMiddleware.js";
const router = express.Router();

// Add an Occasion
router.post("/add",authenticateUser, async (req, res) => {
  const userId = req?.user?.id;
  const { occasion, name, date_time, recurring, season, outfit_id } = req.body;

  const { data, error } = await supabase
    .from("occasions")
    .insert([{ user_id: userId, occasion, name, date_time, recurring, season, outfit_id }]);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: "Occasion added successfully", occasion: data });
});

// Get Occasions for a User
router.get("/",authenticateUser, async (req, res) => {
  const userId = req?.user?.id;

  // First get all occasions for the user
  const { data: occasions, error: occasionsError } = await supabase
    .from("occasions")
    .select("*")
    .eq("user_id", userId);

  if (occasionsError) return res.status(400).json({ error: occasionsError.message });

  // For each occasion with an outfit_id, fetch the outfit details
  const occasionsWithOutfits = await Promise.all(
    occasions.map(async (occasion) => {
      if (occasion.outfit_id) {
        const { data: outfitData, error: outfitError } = await supabase
          .from("outfits")
          .select("*")
          .eq("id", occasion.outfit_id)
          .single();
        
        if (!outfitError && outfitData) {
          return { ...occasion, outfit: outfitData };
        }
      }
      return occasion;
    })
  );

  res.json({ occasions: occasionsWithOutfits });
});

// Delete an Occasion
router.delete("/:occasion_id", async (req, res) => {
  const { occasion_id } = req.params;

  const { data, error } = await supabase
    .from("occasions")
    .delete()
    .eq("id", occasion_id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: "Occasion deleted successfully" });
});

export default router;
