import { Router } from "express";
import {
  createProfile,
  getMyProfile,
  getProfileByUserId,
  updateMyProfile,
  deleteMyProfile,
  listProfiles,
} from "../controllers/profile.controller";

const router = Router();

router.post("/", createProfile);
router.get("/me", getMyProfile);
router.patch("/me", updateMyProfile);
router.delete("/me", deleteMyProfile);
router.get("/:userId", getProfileByUserId);
router.get("/", listProfiles);

export default router;
