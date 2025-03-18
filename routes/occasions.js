import express from "express";
import { supabase } from "../config/supabaseClient.js";

const router = express.Router();

// Add an Occasion
router.post("/add", async (req, res) => {
  const { user_id, occasion_type, event_name, date_time, recurring, notes } = req.body;

  const { data, error } = await supabase
    .from("occasions")
    .insert([{ user_id, occasion_type, event_name, date_time, recurring, notes }]);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: "Occasion added successfully", occasion: data });
});

// Get Occasions for a User
router.get("/:user_id", async (req, res) => {
  const { user_id } = req.params;

  const { data, error } = await supabase
    .from("occasions")
    .select("*")
    .eq("user_id", user_id);

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
