import express from "express";
import multer from "multer";
import { supabase } from "../config/supabaseClient.js";
import { authenticateUser } from "../middleware/authMiddleware.js";
import { trackEvent } from "../mixpanel.js";
const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });
router.post("/", authenticateUser, upload.single("profile_image"), async (req, res) => {
    
    try {
      // 🔹 Extract user ID from middleware
      const supabaseUrl = process.env.SUPABASE_URL;
      const user_id = req.user.id;
  
      // 🔹 Extract form fields from `req.body`
      const { date_of_birth = '2007-03-18T18:25:37.332149Z', gender, height = 170, weight = 69 } = req.body;
      let profile_image_url = null;
  
      // 🛑 Validate required fields
      if ( !gender ) {
        return res.status(400).json({ error: "All fields are required." });
      }
  
      // 🔹 If a profile image is uploaded, process it
      if (req.file) {
        
        const fileExt = req.file.mimetype.split("/")[1]; // Extract file extension
        const filePath = `profilepictures/${user_id}.${fileExt}`; // Define file path
  
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("profilepictures")
          .upload(filePath, Buffer.from(req.file.buffer), { contentType: req.file.mimetype});
  
        if (uploadError) {
          console.error("❌ Image Upload Error:", uploadError);
          return res.status(500).json({ error: "Failed to upload profile image." });
        }
  
        profile_image_url = `${supabaseUrl}/storage/v1/object/public/profilepictures/${uploadData.path}`;
      }
  
      // 🔹 Update user profile in database
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ 
          date_of_birth, 
          gender, 
          height: parseFloat(height), 
          weight: parseFloat(weight),
          is_premium: true, 
          ...(profile_image_url && { profile_image_url }) // Add image only if uploaded
        })
        .eq("id", user_id);
  
      if (updateError) {
        console.error("❌ Profile Update Error:", updateError);
        return res.status(500).json({ error: "Failed to update profile." });
      }
  
      return res.json({ message: "Profile updated successfully!" });
  
    } catch (error) {
      console.error("❌ Server Error:", error);
      trackEvent("","API Failure",{
        error : error?.message ?? "Error Message",
        type: "onboarding"
      })
      return res.status(500).json({ error: "Internal Server Error" });
    }
  });
export default router;
