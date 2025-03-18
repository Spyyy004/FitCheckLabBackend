import express from "express";
import multer from "multer";
import { OpenAI } from "openai";
import { supabase } from "../config/supabaseClient.js";
import { v4 as uuidv4 } from "uuid"; 
import { authenticateUser } from "../middleware/authMiddleware.js";

const upload = multer({ storage: multer.memoryStorage() });




const router = express.Router();

router.post("/", upload.single("image"), async (req, res) => {
    try {
      console.log("📸 Received a request to analyze an outfit");
  
      // **1️⃣ Validate Request**
      if (!req.file) {
        console.error("❌ No image uploaded");
        return res.status(400).json({ error: "No image uploaded." });
      }
  
      let accessToken = req.cookies.access_token;
      let refreshToken = req.cookies.refresh_token;
  
      // 🔹 If no access token in cookies, check Authorization header
      if (!accessToken && req.headers.authorization?.startsWith("Bearer ")) {
        accessToken = req.headers.authorization.split(" ")[1]; // Extract token from "Bearer <token>"
      }
  
      let user = null;
  
      if (accessToken) {
        const { data, error } = await supabase.auth.getUser(accessToken);
  
        if (error || !data.user) {
          console.warn("⚠️ Access token might be expired. Attempting refresh...");
  
          if (refreshToken) {
            // 🔄 Refresh the session if possible
            const { data: refreshedSession, error: refreshError } = await supabase.auth.refreshSession({
              refresh_token: refreshToken,
            });
  
            if (refreshError) {
              console.error("❌ Refresh Token Error:", refreshError);
            } else {
              user = refreshedSession.user;
              console.log("✅ Session refreshed!");
              res.cookie("access_token", refreshedSession.access_token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "Strict",
              });
              res.cookie("refresh_token", refreshedSession.refresh_token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "Strict",
              });
            }
          }
        } else {
          user = data.user;
        }
      }
  
      const { occasion, session_token } = req.body;
      const user_id = user?.id || null; // ✅ Use authenticated user_id if available
  
      console.log(`🔑 Authenticated User ID: ${user_id || "None"}`);
      console.log(`🔑 Session Token: ${session_token || "None (User might be logged in)"}`);
  
      // **2️⃣ Prepare Image for Upload**
      const file = req.file;
      console.log("🖼️ File Details:", {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      });
  
      // **3️⃣ Upload Image to Supabase Storage**
      console.log("🚀 Uploading image to Supabase...");
      const filePath = `outfit_${Date.now()}.jpg`;
  
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("outfits")
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });
  
      if (uploadError) {
        console.error("❌ Supabase Upload Error:", uploadError);
        return res.status(500).json({ error: "Error uploading image to Supabase." });
      }
  
      const imageUrl = `https://itdkorjbpoddeiarmbji.supabase.co/storage/v1/object/public/outfits/${uploadData.path}`;
      console.log(`✅ Image uploaded successfully: ${imageUrl}`);
  
      // **4️⃣ Generate AI Prompt Based on Occasion**
      const prompt = getPromptForOccasion(occasion || "casual");
      console.log("📝 Generated AI prompt:", prompt);
  
      // **5️⃣ Call OpenAI API for Outfit Analysis**
      console.log("🤖 Sending request to OpenAI...");
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: prompt },
          {
            role: "user",
            content: [
              { type: "text", text: `Analyze this outfit image for the occasion: ${occasion}` },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      });
  
      // **6️⃣ Validate OpenAI Response**
      if (!aiResponse || !aiResponse.choices || !aiResponse.choices[0]?.message?.content) {
        console.error("❌ OpenAI Response Error: No valid response received");
        return res.status(500).json({ error: "Error processing AI response." });
      }
  
      console.log("✅ AI Response Received:", aiResponse.choices[0].message.content);
      let rawResponse = aiResponse.choices[0].message.content.trim();
      if (rawResponse.startsWith("```json")) rawResponse = rawResponse.replace("```json", "").trim();
      if (rawResponse.endsWith("```")) rawResponse = rawResponse.replace("```", "").trim();
  
      let analysisResult;
      try {
        analysisResult = JSON.parse(rawResponse);
      } catch (parseError) {
        console.error("❌ Failed to parse OpenAI response:", parseError);
        return res.status(500).json({ error: "Invalid AI response format." });
      }
  
      // **7️⃣ Store Analysis in Supabase**
      console.log("📝 Storing analysis in Supabase...");
      const newSessionToken = session_token || uuidv4(); // Generate new session token for guests
  
      const { data: savedAnalysis, error: dbError } = await supabase
        .from("outfit_analyses")
        .insert([
          {
            user_id: user_id || null, // ✅ If logged in, store `user_id`, otherwise `null`
            session_token: user_id ? null : newSessionToken, // ✅ Store session_token only for guests
            image_url: imageUrl,
            overall_score: analysisResult.overall_score,
            analysis: analysisResult,
          },
        ])
        .select("id");
  
      if (dbError) {
        console.error("❌ Database Insert Error:", dbError);
        return res.status(500).json({ error: "Error saving analysis to database." });
      }
  
      console.log(`✅ Analysis saved with ID: ${savedAnalysis[0].id}`);
  
      // **8️⃣ Return Final Response**
      console.log("🚀 Successfully analyzed outfit. Sending response...");
      return res.json({
        imageUrl,
        ...analysisResult,
        session_token: user_id ? null : newSessionToken, // ✅ Return session_token for guests only
      });
  
    } catch (error) {
      console.error("❌ Fatal Server Error:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  });


router.post("/map-analyses", async (req, res) => {
    try {
      const { user_id, session_token } = req.body;
  
      if (!user_id || !session_token) {
        return res.status(400).json({ error: "Missing user_id or session_token" });
      }
  
      console.log(`🔄 Mapping analyses for user: ${user_id}`);
  
      // **Update analyses where session_token matches**
      const { error } = await supabase
        .from("outfit_analyses")
        .update({ user_id })
        .match({ session_token });
  
      if (error) {
        console.error("❌ Error updating analyses:", error);
        return res.status(500).json({ error: "Failed to map analyses to user." });
      }
  
      console.log("✅ Analyses successfully mapped to user.");
      return res.json({ message: "Successfully linked analyses to account." });
    } catch (error) {
      console.error("❌ Server Error:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  });
  


const getPromptForOccasion = (occasion) => {
  switch (occasion.toLowerCase()) {
    case "wedding":
      return `You are a fashion stylist specializing in formal and wedding outfits. Analyze the provided outfit image based on:
      - Elegance & Sophistication
      - Formality Level
      - Suitability for a Wedding
      - Trend Alignment in Formalwear
      - Accessories & Layering for a Polished Look
      - Footwear Appropriateness
  
      Provide a **structured JSON** response with:
      - Scores (1-10) for each category.
      - Colors found in the outfit
      - Overall Score (0-10)
      - Detailed feedback for each category.
      - **A key named "suggestions"** that contains a **list of strings** with outfit improvement ideas.
  
      Example format:
      {
       "overall_score": 9.3,
        "colors": ["Blue", "Red", "Black"],
        "Elegance & Sophistication": { "score": 8, "feedback": "The outfit has a classy appeal, but a richer fabric would enhance it." },
        "Formality Level": { "score": 9, "feedback": "Perfectly formal for a wedding setting." },
        "suggestions": [
          "Consider adding a silk pocket square for refinement.",
          "Opt for patent leather shoes for a sleek finish."
        ]
      }`;
  
    case "party":
      return `You are an expert in party fashion trends. Analyze the provided outfit image based on:
      - Trendiness & Fashion-Forward Appeal
      - Color Boldness & Contrast
      - Occasion Suitability for a Party
      - Accessories & Layering for a Stylish Look
      - Footwear Compatibility with a Party Outfit
  
      Provide a structured JSON response with:
      - Scores (1-10) for each category.
      - Colors found in the outfit
      - Detailed feedback for each category.
      - Overall Score (0-10)
      - **A key named "suggestions"** that contains a **list of strings** with outfit improvement ideas.
  
      Example format:
      {
       "overall_score": 9.3,
        "colors": ["Blue", "Red", "Black"],
        "Trendiness": { "score": 7, "feedback": "The outfit is fashionable, but adding a statement piece would elevate it." },
        "Color Coordination": { "score": 6, "feedback": "The color mix is fun but could be more balanced." },
        "suggestions": [
          "Try neon accessories for a bolder party vibe.",
          "Switch to high-top sneakers for an edgier look."
        ]
      }`;
  
    case "office":
      return `You are a corporate fashion stylist specializing in professional outfits. Analyze the provided outfit image based on:
      - Professionalism & Business-Appropriate Style
      - Color Coordination for a Polished Look
      - Fit & Tailoring for a Sharp Appearance
      - Accessories & Layering for a Refined Corporate Look
      - Footwear Suitability for a Work Environment
  
      Provide a structured JSON response with:
      - Scores (1-10) for each category.
      - Colors found in the outfit
      - Overall Score (0-10)
      - Detailed feedback for each category.
      - **A key named "suggestions"** that contains a **list of strings** with outfit improvement ideas.
  
      Example format:
      {
       "overall_score": 9.3,
        "colors": ["Blue", "Red", "Black"],
        "Professionalism": { "score": 9, "feedback": "The suit looks professional, but the shirt could be more tailored." },
        "Accessories & Layering": { "score": 7, "feedback": "Adding a tie pin would add elegance." },
        "suggestions": [
          "Opt for a fitted blazer for a sharper look.",
          "Wear a leather belt matching your shoes."
        ]
      }`;
  
    case "date":
      return `You are a casual fashion expert. Analyze the provided outfit image based on:
      - Comfort & Effortlessness
      - Trend Alignment in Everyday Wear
      - Color Coordination for a Relaxed Look
      - Accessories & Layering for a Stylish Edge
      - Footwear Compatibility for a Date Outfit
  
      Provide a structured JSON response with:
      - Scores (1-10) for each category.
      - Colors found in the outfit
      - Overall Score (0-10)
      - Detailed feedback for each category.
      - **A key named "suggestions"** that contains a **list of strings** with outfit improvement ideas.
  
      Example format:
      {
       "overall_score": 9.3,
       "colors": ["Blue", "Red", "Black"],
        "Comfort": { "score": 9, "feedback": "The outfit looks cozy and breathable." },
        "Footwear Compatibility": { "score": 7, "feedback": "Sneakers work well, but loafers would add polish." },
        "suggestions": [
          "Try layering with a denim jacket for extra style.",
          "Swap sneakers for loafers for a more refined casual look."
        ]
      }`;
  
    default:
      return `You are a fashion stylist analyzing an outfit for an unspecified event. Provide general fashion feedback based on:
      - Fit & Proportion
      - Color Coordination
      - Occasion Suitability
      - Trend Alignment
      - Accessories & Layering
      - Footwear Compatibility
  
      Provide a structured JSON response with:
      - Overall Score (0-10)
      - Scores (1-10) for each category.
      - Colors found in the outfit
      - Detailed feedback for each category.
      - **A key named "suggestions"** that contains a **list of strings** with outfit improvement ideas.
  
      Example format:
      {
        "overall_score": 9.3,
        "colors": ["Blue", "Red", "Black"],
        "Fit & Proportion": { "score": 7, "feedback": "The fit is good, but slightly baggy in some areas." },
        "Occasion Suitability": { "score": 8, "feedback": "This outfit works well for casual settings." },
        "suggestions": [
          "Tuck in your shirt for a cleaner look.",
          "Try a different belt to add contrast."
        ]
      }`;
  }
};


export default router;