import express from 'express';
import rateLimit from 'express-rate-limit';
import authController from '../controllers/passwordController.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

router.post('/login', loginLimiter, authController.login);
router.post('/logout', authController.logout);
router.get('/me', requireAuth, authController.getAdminInfo);
router.put('/password', requireAuth, authController.changePassword);

export default router;
