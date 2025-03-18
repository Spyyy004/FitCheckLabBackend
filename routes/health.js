import express from "express";

const router = express.Router();

router.get("/", async (req, res) => {
  res.json({ message: "Abhi hum zinda hai" });
});

export default router;
