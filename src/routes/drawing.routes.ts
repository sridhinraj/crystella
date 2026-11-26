import { Router } from 'express';
import { saveDrawing, getDrawings } from '../controllers/drawing.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.use(authenticateToken);

router.post('/save', saveDrawing);
router.get('/', getDrawings);

export default router;
