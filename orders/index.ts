import { connectDB } from "./utils/db";
import Order from "./models/Order";
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
    const { user, items, totalAmount, status } = req.body;
    const newOrder = new Order({ user, items, totalAmount, status });
    await newOrder.save();
    res.status(201).json(newOrder);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/", async (_, res) => {
  try {
    const orders = await Order.find();
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/:id", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

connectDB();

app.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
});
