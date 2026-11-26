import { Router } from 'express';
import { register, login, getMe, updateFcmToken, socialLogin, googleLogin } from '../controllers/auth.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/social', socialLogin);
router.post('/google', googleLogin);
router.get('/me', authenticateToken, getMe);
router.post('/fcm-token', authenticateToken, updateFcmToken);

export default router;
