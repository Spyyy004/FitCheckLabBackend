import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
// Correctly import routes
import authRoutes from "./routes/auth.js";
import occasionRoutes from "./routes/occasions.js";
import outfitRoutes from "./routes/outfits.js";
import analyzeRoutes from "./routes/analyze-outfit.js"; // Already built
import recentAnalysisRoutes from "./routes/recent-analysis.js";
import profileRoutes from "./routes/profiles.js";
import onboardingRoutes from './routes/onboarding.js';
import healthRoutes from './routes/health.js';
import editProfileRoutes from './routes/edit-profile.js';

dotenv.config();
const app = express();

app.use(express.json()); // Middleware for JSON request bodies

app.use(cookieParser());

// ✅ Set up CORS properly
app.use(
  cors({
    origin: ["http://localhost:8080","https://fitchecklab.in"], // ✅ Allow your frontend domain explicitly
    credentials: true, // ✅ Allow cookies/authentication
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
// ✅ Fix: Ensure routes are correctly used
app.use("/api/auth", authRoutes);
app.use("/api/occasions", occasionRoutes);
app.use("/api/outfits", outfitRoutes);
app.use("/api/analyze-outfit", analyzeRoutes); // Existing Analysis Route
app.use("/api/recent-analysis", recentAnalysisRoutes);
app.use("/api/profile",profileRoutes)
app.use("/api/onboarding",onboardingRoutes);
app.use("/health",healthRoutes);
app.use("/api/update-profile",editProfileRoutes)
// Start Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
