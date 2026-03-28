import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import cors from "cors";
import { config } from "dotenv";

config();

const USERS_SERVICE_URL = process.env.USERS_SERVICE_URL!;
const ORDERS_SERVICE_URL = process.env.ORDERS_SERVICE_URL!;
const PORT = process.env.PORT!;

const app = express();

app.use(cors());
app.use(express.json());

app.use(
  "/users",
  createProxyMiddleware({
    target: USERS_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: {
      "^/users": "/",
    },
  }),
);

app.use(
  "/orders",
  createProxyMiddleware({
    target: ORDERS_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: {
      "^/orders": "/",
    },
  }),
);

app.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
});
