import { connectDB } from "./utils/db";
import User from "./models/User";
import express from "express";
import cors from "cors";
import { config } from "dotenv";

config();

const app = express();
const PORT = process.env.PORT!;

app.use(cors());
app.use(express.json());

app.post("/", async (req, res) => {
  try {
    const { name, email, password, age } = req.body;
    const newUser = new User({ name, email, password, age });
    await newUser.save();
    res.status(201).json(newUser);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/", async (_, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

connectDB();

app.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
});
