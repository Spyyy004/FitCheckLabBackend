import express from "express";
import multer from "multer";
import { OpenAI } from "openai";
import { supabase } from "../config/supabaseClient.js";
import { v4 as uuidv4 } from "uuid";
import { authenticateUser } from "../middleware/authMiddleware.js";
import { trackEvent } from "../mixpanel.js";
import fs from "fs";
import path from "path";
const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

router.post("/", upload.single("image"), async (req, res) => {
  try {
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
          const { data: refreshedSession, error: refreshError } =
            await supabase.auth.refreshSession({
              refresh_token: refreshToken,
            });

          if (refreshError) {
            console.error("❌ Refresh Token Error:", refreshError);
          } else {
            user = refreshedSession.user;
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
        isPremium = userProfile?.is_premium || true;
        const { error: updateError } = await supabase
          .from("profiles")
          .update({
            ai_outfit_analysis_count:
              (userProfile.ai_outfit_analysis_count || 0) + 1,
          })
          .eq("id", user_id);

        if (updateError) {
          console.error("⚠️ Failed to increment analysis count:", updateError);
        }
      }
    }
    // **2️⃣ Prepare Image for Upload**
    const file = req.file;

    // **3️⃣ Upload Image to Supabase Storage**
    const filePath = `outfit_${Date.now()}.jpg`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("outfits")
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error("❌ Supabase Upload Error:", uploadError);
      return res
        .status(500)
        .json({ error: "Error uploading image to Supabase." });
    }

    const imageUrl = `${supabaseUrl}/storage/v1/object/public/outfits/${uploadData.path}`;

    // **4️⃣ Generate AI Prompt Based on Occasion**
    const prompt = getPromptForOccasion(occasion || "casual", true);

    // **5️⃣ Call OpenAI API for Outfit Analysis**
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze this outfit image for the occasion: ${occasion}. Please make sure your response must contain only and only JSON and nothing else.`,
            },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    });

    // **6️⃣ Validate OpenAI Response**
    if (
      !aiResponse ||
      !aiResponse.choices ||
      !aiResponse.choices[0]?.message?.content
    ) {
      console.error("❌ OpenAI Response Error: No valid response received");
      return res.status(500).json({ error: "Error processing AI response." });
    }

    let rawResponse = aiResponse.choices[0].message.content.trim();
    if (rawResponse.startsWith("```json"))
      rawResponse = rawResponse.replace("```json", "").trim();
    if (rawResponse.endsWith("```"))
      rawResponse = rawResponse.replace("```", "").trim();

    let analysisResult;
    try {
      analysisResult = JSON.parse(rawResponse);
    } catch (parseError) {
      console.error("❌ Failed to parse OpenAI response:", parseError);
      return res.status(500).json({ error: "Invalid AI response format." });
    }

    // **7️⃣ Store Analysis in Supabase**
    const newSessionToken = session_token || uuidv4(); // Generate new session token for guests

    const { data: savedAnalysis, error: dbError } = await supabase
      .from("outfit_analyses")
      .insert([
        {
          user_id: user_id || null, // ✅ If logged in, store `user_id`, otherwise `null`
          session_token: user_id ? null : newSessionToken, // ✅ Store session_token only for guests
          image_url: imageUrl,
          overall_score: analysisResult?.overall_score ?? 0,
          analysis: analysisResult,
        },
      ])
      .select("id");

    if (dbError) {
      console.error("❌ Database Insert Error:", dbError);
      return res
        .status(500)
        .json({ error: "Error saving analysis to database." });
    }

    trackEvent(user_id, "Outfit Analyzed", {
      isPremium,
      imageUrl,
    });
    console.log(savedAnalysis,'outdit analyssiss',savedAnalysis)
    // **8️⃣ Return Final Response**
    return res.json({
      imageUrl,
      outfit_id:savedAnalysis,
      ...analysisResult,
      isPremium,
      session_token: user_id ? null : newSessionToken, // ✅ Return session_token for guests only
    });
  } catch (error) {
    // const timestamp = new Date().toISOString();
    // const logEntry = `[${timestamp}] ❌ Fatal Server Error: ${error.stack || error.message || error}\n`;

    // // Append to logs/errors.log (create folder if needed)
    // const logFilePath = path.join(__dirname, "../logs/errors.log");

    // fs.mkdirSync(path.dirname(logFilePath), { recursive: true }); // Ensure logs directory exists
    // fs.appendFileSync(logFilePath, logEntry);
    trackEvent("", "API Failure", {
      error: error?.message ?? "Error Message",
      type: "signup",
      imageUrl,
    });

    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/map-analyses", async (req, res) => {
  try {
    const { user_id, session_token } = req.body;

    if (!user_id || !session_token) {
      return res
        .status(400)
        .json({ error: "Missing user_id or session_token" });
    }

    // **Update analyses where session_token matches**
    const { error } = await supabase
      .from("outfit_analyses")
      .update({ user_id })
      .match({ session_token });

    if (error) {
      console.error("❌ Error updating analyses:", error);
      return res.status(500).json({ error: "Failed to map analyses to user." });
    }

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
      case "casual":
        return `You are a high-end fashion consultant providing **detailed casual outfit insights**. Analyze the outfit based on:
            - **Comfort & Effortlessness**
            - **Fabric Choice & Breathability**
            - **Color Coordination**
            - **Style Cohesion**
            - **Layering & Accessories**
            - **Weather Appropriateness**
          
            Provide a **structured JSON** response with:
            - **overall_score** (0-10): Overall evaluation of the outfit.
            - **colors**: Array of dominant and secondary colors detected.
            - Individual category scores with feedback, using the following keys:
              - **Comfort**
              - **Fabric**
              - **ColorHarmony**
              - **StyleConsistency**
              - **LayeringAndAccessories**
              - **WeatherSuitability**
            - **suggestions**: At least 3 personalized outfit improvement ideas.
            - **alternative_outfit**: Suggest an alternative casual outfit with keys:
              - **top**, **bottom**, **footwear**, and **accessories**.
          
            Example format:
            {
              "overall_score": 8.7,
              "colors": ["Olive Green", "White", "Tan"],
              "Comfort": { "score": 9, "feedback": "Loose fit and cotton fabric make this very wearable for a casual day." },
              "Fabric": { "score": 8, "feedback": "Breathable material suitable for mild weather." },
              "ColorHarmony": { "score": 7, "feedback": "Neutral tones work well together, but lacks a pop element." },
              "StyleConsistency": { "score": 8, "feedback": "Laid-back vibe maintained across pieces." },
              "LayeringAndAccessories": { "score": 7, "feedback": "Minimal layering; sunglasses or watch could add style." },
              "WeatherSuitability": { "score": 9, "feedback": "Ideal for spring or early summer." },
              "suggestions": [
                "Add a light denim jacket for dimension.",
                "Swap sneakers for loafers for smart casual look.",
                "Consider a hat or cap for sunny days.",
             
              ],
              "alternative_outfit": {
                "top": "White linen shirt",
                "bottom": "Beige chinos",
                "footwear": "Espadrilles",
                "accessories": "Brown leather strap watch"
              }
            }`;
      case "wedding":
        return `You are a fashion consultant providing **wedding outfit analysis**. Evaluate the outfit based on:
          - **Elegance & Formality**
          - **Wedding Appropriateness**
          
          Provide a **structured JSON** response with:
          - **Colors detected** in the outfit.
          - **Overall Score (0-10).**
          - **Brief feedback (1-2 sentences max) per category.**
          
          Example format:
          {
            "overall_score": 8.5,
            "colors": ["Blue", "Black", "White"],
            "Elegance": { "score": 7, "feedback": "The outfit is stylish but could use a richer fabric." },
            "Formality": { "score": 9, "feedback": "This outfit fits well within formal wedding settings." }
          }`;

      case "party":
        return `You are a fashion expert providing **party outfit insights**. Analyze the outfit based on:
          - **Trendiness**
          - **Party Appropriateness**
          
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
        return `You are a corporate stylist providing **office outfit analysis**. Analyze the outfit based on:
          - **Professionalism**
          - **Office Appropriateness**
          
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
        return `You are a fashion expert analyzing **party outfits** for premium users. Assess the outfit based on:
              - **Trend Relevance**
              - **Color Boldness & Contrast**
              - **Visual Impact & Styling**
              - **Accessories & Layering for a Striking Look**

              Provide a **structured JSON** response with:
              - **Overall Score (0-10).**
              - **Scores (1-10) for each category.**
              - **Colors detected in the outfit.**
              - **3+ targeted styling improvements.**
              - **An alternative outfit using wardrobe items.**

              Example format:
              {
                "overall_score": 8.9,
                "colors": ["Black", "Gold", "Red"],
                "Trendiness": { "score": 9, "feedback": "The outfit reflects current trends with a confident, edgy twist." },
                "suggestions": [
                  "Add a leather jacket for a rebellious finish.",
                  "Introduce metallic accents for extra flair."
                ],
                "alternative_outfit": {
                  "top": "Black fitted shirt",
                  "bottom": "Slim-fit red pants"
                }
              }`;

      case "office":
        return `You are a workplace fashion consultant analyzing **professional office outfits** for premium users. Adapt your analysis to suit different work environments—corporate, creative, tech, or startup.

Evaluate the outfit based on:
- **Appropriateness for the Work Environment**
- **Fit & Neatness**
- **Balance of Comfort and Professionalism**
- **Styling Effort (accessories, color coordination, polish)**

Provide a **structured JSON** response with:
- **Overall Score (0-10).**
- **Scores (1-10) for each category.**
- **Colors detected in the outfit.**
- **5+ styling tips to enhance workplace readiness.**
- **An alternative work-friendly outfit suggestion.**

Example format:
{
  "overall_score": 8.8,
  "colors": ["Olive", "Beige", "White"],
  "Workplace Fit": { "score": 9, "feedback": "The polo and chinos are great for a tech workplace—clean, modern, and comfortable." },
  "suggestions": [
    "Consider adding a casual blazer for meetings.",
    "Monochrome sneakers would complete the look neatly."
  ],
  "alternative_outfit": {
    "top": "Olive green polo",
    "bottom": "Beige chinos"
  }
}`;

      case "date":
        return `You are a casual fashion expert analyzing **date night outfits** for premium users. Consider different date settings—dinner, movie, café, or outdoors.

Evaluate the outfit based on:
- **Balance of Comfort and Style**
- **Color Appeal and Coordination**
- **Accessories for a Thoughtful Touch**
- **Footwear Appropriateness for the Setting**

Provide a **structured JSON** response with:
- **Overall Score (0-10).**
- **Scores (1-10) for each category.**
- **Colors detected in the outfit.**
- **5+ personalized styling tips.**
- **An alternative outfit for date confidence.**

Example format:
{
  "overall_score": 8.7,
  "colors": ["Blue", "Beige", "White"],
  "Comfort & Style": { "score": 9, "feedback": "Looks relaxed yet intentional—perfect for a casual date night." },
  "suggestions": [
    "Add a casual jacket for layering and polish.",
    "Go for leather sneakers to elevate the vibe."
  ],
  "alternative_outfit": {
    "top": "Fitted navy polo",
    "bottom": "Slim-fit khaki chinos"
  }
}`;

      case "casual":
        return `You are a high-end fashion consultant providing **casual outfit insights**. Assess the outfit on:

          - **Comfort & Ease**
          - **Fabric Quality & Breathability**
          - **Color Coordination**
          - **Style Cohesion**
          - **Layering & Accessories**
          - **Weather Appropriateness**
          
          Provide a **structured JSON** response with:
          - **overall_score** (0–10): Overall evaluation.
          - **colors**: Array of primary and secondary colors.
          - Category scores with feedback, using:
            - **Comfort**
            - **Fabric**
            - **ColorHarmony**
            - **StyleConsistency**
            - **LayeringAndAccessories**
            - **WeatherSuitability**
          - **suggestions**: At least 3 styling improvements.
          - **alternative_outfit**: Suggest a new casual look with:
            - **top**, **bottom**, **footwear**, and **accessories**
          
          Example:
          {
            "overall_score": 8.7,
            "colors": ["Olive Green", "White", "Tan"],
            "Comfort": { "score": 9, "feedback": "Relaxed fit and cotton fabric are ideal for comfort." },
            "Fabric": { "score": 8, "feedback": "Breathable material works well for warm days." },
            "ColorHarmony": { "score": 7, "feedback": "Earthy tones blend well, though a contrast element could enhance it." },
            "StyleConsistency": { "score": 8, "feedback": "Outfit maintains a cohesive casual aesthetic." },
            "LayeringAndAccessories": { "score": 7, "feedback": "Add-ons like a cap or bracelet would enhance depth." },
            "WeatherSuitability": { "score": 9, "feedback": "Appropriate for spring or early summer." },
            "suggestions": [
              "Add a light jacket for layering.",
              "Try suede loafers for a refined casual twist.",
              "Include subtle accessories like a canvas watch."
            ],
            "alternative_outfit": {
              "top": "White linen shirt",
              "bottom": "Beige chinos",
              "footwear": "Espadrilles",
              "accessories": "Brown leather strap watch"
            }
          }`;

      default:
        return `You are analyzing a general outfit for a premium user with in-depth styling insights.`;
    }
  }
};

export default router;
