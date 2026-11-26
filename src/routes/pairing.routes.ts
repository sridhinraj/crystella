import { Router } from 'express';
import {
  generateCode,
  joinWithCode,
  getPairingStatus,
  updateDates,
  simulatePartnerJoin,
  unpair,
} from '../controllers/pairing.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.post('/generate-code', authenticateToken, generateCode);
router.post('/join', authenticateToken, joinWithCode);
router.post('/simulate-partner', authenticateToken, simulatePartnerJoin);
router.post('/unpair', authenticateToken, unpair);
router.get('/status', authenticateToken, getPairingStatus);
router.patch('/dates', authenticateToken, updateDates);

export default router;
