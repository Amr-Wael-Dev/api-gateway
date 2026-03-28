import express from "express";
import cors from "cors";
import { config } from "dotenv";

config();

const USERS_SERVICE_URL = process.env.USERS_SERVICE_URL!;
const ORDERS_SERVICE_URL = process.env.ORDERS_SERVICE_URL!;
const PORT = process.env.PORT!;

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (_, res) => {
  res.send("API running");
});

app.post("/users", async (req, res) => {
  try {
    const response = await fetch(`${USERS_SERVICE_URL}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    res.status(response.status).json(await response.json());
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/users", async (_, res) => {
  try {
    const response = await fetch(`${USERS_SERVICE_URL}/users`);
    res.status(response.status).json(await response.json());
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/users/:id", async (req, res) => {
  try {
    const response = await fetch(`${USERS_SERVICE_URL}/users/${req.params.id}`);
    res.status(response.status).json(await response.json());
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/orders", async (req, res) => {
  try {
    const response = await fetch(`${ORDERS_SERVICE_URL}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    res.status(response.status).json(await response.json());
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/orders", async (_, res) => {
  try {
    const response = await fetch(`${ORDERS_SERVICE_URL}/orders`);
    res.status(response.status).json(await response.json());
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/orders/:id", async (req, res) => {
  try {
    const response = await fetch(`${ORDERS_SERVICE_URL}/orders/${req.params.id}`);
    res.status(response.status).json(await response.json());
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
});
