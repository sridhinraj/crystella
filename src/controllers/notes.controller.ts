import { Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { AuthRequest } from '../middleware/auth';

const sendNoteSchema = z.object({
  type: z.enum(['HEARTBEAT', 'HUG', 'SPARKLE', 'NIGHT', 'MORNING', 'TAP', 'TEXT']),
  content: z.string().min(1).max(280),
});

export const sendNote = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const parsed = sendNoteSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid note payload', details: parsed.error.format() });
      return;
    }

    const { type, content } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, coupleId: true },
    });

    if (!user || !user.coupleId) {
      res.status(400).json({ error: 'You must be in an active couple space to send nudges' });
      return;
    }

    const coupleId = user.coupleId;

    // Save to database
    const note = await prisma.loveNote.create({
      data: {
        coupleId,
        senderId: userId,
        type,
        content,
      },
    });

    // Update couple's latest widget cache
    await prisma.coupleSpace.update({
      where: { id: coupleId },
      data: {
        latestWidgetType: 'NOTE',
        latestWidgetContent: content,
        latestWidgetSender: user.name,
        latestWidgetTimestamp: new Date(),
      },
    });

    // Note: Socket.IO relay in socket.manager.ts handles realtime delivery
    // This endpoint only persists the note and updates the widget cache

    res.status(201).json({
      message: 'Love nudge sent successfully',
      note,
    });
  } catch (error) {
    console.error('sendNote error:', error);
    res.status(500).json({ error: 'Failed to send love note' });
  }
};

export const getRecentNotes = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { coupleId: true },
    });

    if (!user?.coupleId) {
      res.status(400).json({ error: 'No couple space found' });
      return;
    }

    const notes = await prisma.loveNote.findMany({
      where: { coupleId: user.coupleId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        sender: {
          select: { id: true, name: true, avatarUrl: true },
        },
      },
    });

    res.json({ notes });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notes history' });
  }
};
