import { Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { AuthRequest } from '../middleware/auth';
import { io } from '../server';

const saveDrawingSchema = z.object({
  imageUrl: z.string().min(1),
  strokeData: z.string().optional(),
  caption: z.string().max(100).optional(),
});

export const saveDrawing = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const parsed = saveDrawingSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid drawing payload', details: parsed.error.format() });
      return;
    }

    const { imageUrl, strokeData, caption } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, coupleId: true },
    });

    if (!user || !user.coupleId) {
      res.status(400).json({ error: 'You must be in an active couple space to save drawings' });
      return;
    }

    const coupleId = user.coupleId;

    // Save drawing in database
    const drawing = await prisma.drawing.create({
      data: {
        coupleId,
        senderId: userId,
        imageUrl,
        strokeData: strokeData || '[]',
        caption: caption || null,
      },
      include: {
        sender: {
          select: { id: true, name: true, avatarUrl: true },
        },
      },
    });

    // Update couple's latest widget preview cache
    await prisma.coupleSpace.update({
      where: { id: coupleId },
      data: {
        latestWidgetType: 'DRAWING',
        latestWidgetContent: imageUrl,
        latestWidgetSender: user.name,
        latestWidgetTimestamp: new Date(),
      },
    });

    // Broadcast new drawing event to partner in the space
    const room = `space_${coupleId}`;
    io.to(room).emit('draw:new', {
      drawingId: drawing.id,
      senderId: userId,
      senderName: user.name,
      imageUrl,
      caption: caption || 'Sent a new drawing for your widget! 🎨',
      timestamp: drawing.createdAt.toISOString(),
    });

    res.status(201).json({
      message: 'Drawing saved and sent to partner widget successfully',
      drawing,
    });
  } catch (error) {
    console.error('saveDrawing error:', error);
    res.status(500).json({ error: 'Failed to save drawing' });
  }
};

export const getDrawings = async (req: AuthRequest, res: Response): Promise<void> => {
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

    const drawings = await prisma.drawing.findMany({
      where: { coupleId: user.coupleId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: {
        sender: {
          select: { id: true, name: true, avatarUrl: true },
        },
      },
    });

    res.json({ drawings });
  } catch (error) {
    console.error('getDrawings error:', error);
    res.status(500).json({ error: 'Failed to fetch drawings' });
  }
};
