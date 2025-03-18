import express from "express";
import multer from "multer";
import { supabase } from "../config/supabaseClient.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Upload an Outfit Image
router.post("/upload", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded." });

  const imageBuffer = req.file.buffer;
  const { data, error } = await supabase.storage
    .from("outfits")
    .upload(`outfit_${Date.now()}.jpg`, imageBuffer, { contentType: "image/jpeg" });

  if (error) return res.status(500).json({ error: "Error uploading image." });

  res.json({ imageUrl: `https://your-supabase-url.com/storage/v1/object/public/outfits/${data.path}` });
});

// Get All Outfits for a User
router.get("/:user_id", async (req, res) => {
  const { user_id } = req.params;

  const { data, error } = await supabase
    .from("outfits")
    .select("*")
    .eq("user_id", user_id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ outfits: data });
});

export default router;
