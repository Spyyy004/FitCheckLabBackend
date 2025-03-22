import express from "express";
import { supabase } from "../config/supabaseClient.js";
import authMiddleware from "../middleware/authMiddleware.js";
const router = express.Router();

// Add an Occasion
router.post("/add", async (req, res) => {
  const userId = req?.user?.id;
  const { occasion, name, date_time, recurring, season, outfit_id } = req.body;

  const { data, error } = await supabase
    .from("occasions")
    .insert([{ user_id: userId, occasion, name, date_time, recurring, season, outfit_id }]);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: "Occasion added successfully", occasion: data });
});

// Get Occasions for a User
router.get("/",authMiddleware, async (req, res) => {
  const userId = req?.user?.id;

  const { data, error } = await supabase
    .from("occasions")
    .select("*")
    .eq("user_id", userId);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ occasions: data });
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
