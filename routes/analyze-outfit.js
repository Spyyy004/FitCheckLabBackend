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
      let isPremium = false;
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
      const supabaseUrl = process.env.SUPABASE_URL;
      if (user_id) {
        const { data: userProfile, error: profileError } = await supabase
          .from("profiles")
          .select("is_premium")
          .eq("id", user_id)
          .single();
  
        if (profileError) {
          console.error("⚠️ Error fetching user profile:", profileError);
        } else {
          isPremium = userProfile?.is_premium || false;
          console.log(`💎 User Premium Status: ${isPremium ? "Premium" : "Free"}`);
        }
      }
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
  
      const imageUrl = `${supabaseUrl}/storage/v1/object/public/outfits/${uploadData.path}`;
      console.log(`✅ Image uploaded successfully: ${imageUrl}`);
  
      // **4️⃣ Generate AI Prompt Based on Occasion**
      const prompt = getPromptForOccasion(occasion || "casual",isPremium);
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
        isPremium,
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
  


  const getPromptForOccasion = (occasion, isPremium) => {
    if (!isPremium) {
      // **Non-Premium Users: Basic Analysis, No Suggestions**
      switch (occasion.toLowerCase()) {
        case "wedding":
          return `You are a fashion consultant providing **basic wedding outfit analysis**. Analyze the outfit based on:
          - **Elegance & Formality**
          - **Basic Suitability for a Wedding**
          
          Provide a **structured JSON** response with:
          - **Colors detected** in the outfit.
          - **Overall Score (0-10).**
          - **Short feedback (1-2 sentences max) per category.**
          
          Example format:
          {
            "overall_score": 8.5,
            "colors": ["Blue", "Black", "White"],
            "Elegance": { "score": 7, "feedback": "The outfit is stylish but could use a richer fabric." },
            "Formality": { "score": 9, "feedback": "This outfit fits well within formal wedding settings." }
          }`;
  
        case "party":
          return `You are a fashion expert providing **basic party outfit insights**. Analyze the outfit based on:
          - **Trendiness**
          - **Basic Party Suitability**
          
          Provide a **structured JSON** response with:
          - **Colors detected** in the outfit.
          - **Overall Score (0-10).**
          - **Short feedback (1-2 sentences max) per category.**
          
          Example format:
          {
            "overall_score": 7.8,
            "colors": ["Red", "Black", "Gold"],
            "Trendiness": { "score": 7, "feedback": "The outfit is fashionable but could use a statement piece." }
          }`;
  
        case "office":
          return `You are a corporate stylist providing **basic office outfit analysis**. Analyze the outfit based on:
          - **Professionalism**
          - **Basic Color Coordination**
          
          Provide a **structured JSON** response with:
          - **Colors detected** in the outfit.
          - **Overall Score (0-10).**
          - **Short feedback (1-2 sentences max) per category.**
          
          Example format:
          {
            "overall_score": 8.1,
            "colors": ["Navy", "White", "Brown"],
            "Professionalism": { "score": 8, "feedback": "This outfit is suitable for most office settings." }
          }`;
  
        case "date":
          return `You are a casual fashion consultant providing **basic date outfit insights**. Analyze the outfit based on:
          - **Comfort**
          - **Basic Trend Relevance**
          
          Provide a **structured JSON** response with:
          - **Colors detected** in the outfit.
          - **Overall Score (0-10).**
          - **Short feedback (1-2 sentences max) per category.**
          
          Example format:
          {
            "overall_score": 7.5,
            "colors": ["Blue", "Gray", "White"],
            "Comfort": { "score": 9, "feedback": "This outfit looks cozy and easygoing." }
          }`;
  
        default:
          return `You are a fashion consultant providing **basic outfit analysis**. Analyze the outfit based on:
          - **General Fit**
          - **Basic Color Coordination**
          
          Provide a **structured JSON** response with:
          - **Colors detected** in the outfit.
          - **Overall Score (0-10).**
          - **Short feedback (1-2 sentences max) per category.**`;
      }
    } else {
      // **Premium Users: Advanced Analysis, Full Insights, and Suggestions**
      switch (occasion.toLowerCase()) {
        case "wedding":
          return `You are a high-end fashion consultant providing **detailed wedding outfit insights**. Analyze the outfit based on:
          - **Elegance & Formality**
          - **Fabric & Material Suitability**
          - **Accessories & Layering for Refinement**
          - **Weather Considerations**
          - **Wardrobe Enhancement Suggestions**
          
          Provide a **structured JSON** response with:
          - **Overall Score (0-10).**
          - **Scores (1-10) for each category.**
          - **Colors detected in the outfit.**
          - **5+ personalized outfit refinements.**
          - **A key named "alternative_outfit"** suggesting an alternative composition.
  
          Example format:
          {
            "overall_score": 9.4,
            "colors": ["Beige", "Brown", "White"],
            "Elegance": { "score": 9, "feedback": "The outfit exudes sophistication with its tailored fit and material choice." },
            "suggestions": [
              "Opt for a silk tie to enhance the formality.",
              "Consider a pocket square for a touch of elegance."
            ],
            "alternative_outfit": {
              "top": "Beige double-breasted blazer",
              "bottom": "Tailored charcoal gray dress pants"
            }
          }`;
  
        case "party":
          return `You are a fashion expert analyzing **party outfits** for premium users. Analyze the outfit based on:
          - **Trend Relevance**
          - **Color Boldness & Contrast**
          - **Styling for Social Impact**
          - **Accessories & Layering for a Bold Look**
          
          Provide a **structured JSON** response with:
          - **Overall Score (0-10).**
          - **Scores (1-10) for each category.**
          - **Colors detected in the outfit.**
          - **5+ styling improvements.**
          - **Alternative outfit suggestions using wardrobe items.**
  
          Example format:
          {
            "overall_score": 8.9,
            "colors": ["Black", "Gold", "Red"],
            "Trendiness": { "score": 9, "feedback": "The outfit follows modern trends with an edgy appeal." },
            "suggestions": [
              "Try layering with a leather jacket for a rebellious edge.",
              "Metallic accessories would add more impact."
            ],
            "alternative_outfit": {
              "top": "Black fitted shirt",
              "bottom": "Slim-fit red pants"
            }
          }`;
  
        case "office":
          return `You are a corporate fashion stylist analyzing **professional office wear** for premium users. Analyze the outfit based on:
          - **Professionalism & Corporate Appeal**
          - **Fit & Tailoring for Authority**
          - **Minimalist Accessories for a Sophisticated Look**
          - **Comfort for Long Work Hours**
          
          Provide a **structured JSON** response with:
          - **Overall Score (0-10).**
          - **Scores (1-10) for each category.**
          - **Colors detected in the outfit.**
          - **5+ professional styling recommendations.**
          - **An alternative office outfit suggestion.**
  
          Example format:
          {
            "overall_score": 9.2,
            "colors": ["Gray", "Navy", "Black"],
            "Professionalism": { "score": 9, "feedback": "The structured blazer and formal shoes enhance authority." },
            "suggestions": [
              "Add a pocket square for a refined look.",
              "Match belt and shoes for a cohesive aesthetic."
            ],
            "alternative_outfit": {
              "top": "Navy slim-fit blazer",
              "bottom": "Gray dress pants"
            }
          }`;
  
        case "date":
          return `You are a casual fashion expert analyzing **date night outfits** for premium users. Analyze the outfit based on:
          - **Comfort & Style Balance**
          - **Color Coordination for an Attractive Look**
          - **Accessories for a Polished Casual Appeal**
          - **Footwear Suitability for the Date Setting**
          
          Provide a **structured JSON** response with:
          - **Overall Score (0-10).**
          - **Scores (1-10) for each category.**
          - **Colors detected in the outfit.**
          - **5+ styling suggestions.**
          - **Alternative date outfit recommendations.**
  
          Example format:
          {
            "overall_score": 8.7,
            "colors": ["Blue", "Beige", "White"],
            "Comfort": { "score": 9, "feedback": "The outfit strikes a perfect balance between casual and stylish." },
            "suggestions": [
              "Swap sneakers for loafers for a more polished look.",
              "A casual watch would elevate the ensemble."
            ],
            "alternative_outfit": {
              "top": "Fitted navy polo",
              "bottom": "Slim-fit khaki chinos"
            }
          }`;
  
        default:
          return `You are analyzing a general outfit for a premium user with in-depth styling insights.`;
      }
    }
  };
  
  
export default router;