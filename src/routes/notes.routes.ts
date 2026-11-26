import { Router } from 'express';
import { sendNote, getRecentNotes } from '../controllers/notes.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.post('/send', authenticateToken, sendNote);
router.get('/recent', authenticateToken, getRecentNotes);

export default router;
