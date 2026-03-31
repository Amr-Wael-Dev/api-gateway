import mongoose from "mongoose";
import app from "./app";

const PORT = process.env.PORT!;
const MONGO_URI = process.env.MONGO_URI!;

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("Auth MongoDB connected");
    app.listen(PORT, () => console.log(`Auth server running on: ${PORT}`));
  })
  .catch((err) => {
    console.error("Auth MongoDB connection failed:", err);
    process.exit(1);
  });
