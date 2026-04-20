import { Router } from "express";
import {
  getMe,
  getUserById,
  patchMe,
  deleteMe,
  listUsers,
} from "../controllers/users.controller";

const router = Router();

/**
 * @openapi
 * /me:
 *   get:
 *     summary: Get my profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       404:
 *         description: Profile not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProblemDetail'
 */
router.get("/me", getMe);

/**
 * @openapi
 * /:
 *   get:
 *     summary: List all users (admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Max items per page
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Pagination cursor (_id of last item from previous page)
 *     responses:
 *       200:
 *         description: Paginated user list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *                 nextCursor:
 *                   type: string
 *                   nullable: true
 *       403:
 *         description: Admin role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProblemDetail'
 */
router.get("/", listUsers);

/**
 * @openapi
 * /{id}:
 *   get:
 *     summary: Get user by ID
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Auth service user ID
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProblemDetail'
 */
router.get("/:id", getUserById);

/**
 * @openapi
 * /me:
 *   patch:
 *     summary: Update my profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               displayName:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 50
 *               bio:
 *                 type: string
 *                 maxLength: 500
 *     responses:
 *       200:
 *         description: Updated profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProblemDetail'
 *       404:
 *         description: Profile not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProblemDetail'
 */
router.patch("/me", patchMe);

/**
 * @openapi
 * /me:
 *   delete:
 *     summary: Delete my account (soft delete)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       204:
 *         description: Account deleted
 *       404:
 *         description: Profile not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProblemDetail'
 */
router.delete("/me", deleteMe);

export default router;
