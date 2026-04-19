import { Router } from "express";
import {
  getMe,
  getUserById,
  patchMe,
  deleteMe,
  listUsers,
} from "../controllers/users.controller";

const router = Router();

router.get("/me", getMe);
router.get("/", listUsers);
router.get("/:id", getUserById);
router.patch("/me", patchMe);
router.delete("/me", deleteMe);

export default router;
