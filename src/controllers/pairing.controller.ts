import { Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { AuthRequest } from '../middleware/auth';

function generateRandom6Code(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous characters like 0/O, 1/I
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export const generateCode = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { coupleSpace: { include: { users: true } } },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (user.coupleSpace && user.coupleSpace.status === 'ACTIVE') {
      res.status(400).json({
        error: 'You are already paired in an active couple space.',
        coupleSpace: user.coupleSpace,
      });
      return;
    }

    let code = generateRandom6Code();
    // Ensure uniqueness
    let existing = await prisma.coupleSpace.findUnique({ where: { inviteCode: code } });
    while (existing) {
      code = generateRandom6Code();
      existing = await prisma.coupleSpace.findUnique({ where: { inviteCode: code } });
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    let coupleSpace;
    if (user.coupleSpace && user.coupleSpace.status === 'PENDING') {
      // Refresh existing pending space
      coupleSpace = await prisma.coupleSpace.update({
        where: { id: user.coupleSpace.id },
        data: {
          inviteCode: code,
          codeExpiresAt: expiresAt,
        },
      });
    } else {
      // Create new space
      coupleSpace = await prisma.coupleSpace.create({
        data: {
          inviteCode: code,
          codeExpiresAt: expiresAt,
          status: 'PENDING',
          users: {
            connect: { id: userId },
          },
        },
      });
    }

    res.json({
      message: 'Invite code generated successfully',
      inviteCode: code,
      expiresAt,
      coupleSpaceId: coupleSpace.id,
    });
  } catch (error) {
    console.error('generateCode error:', error);
    res.status(500).json({ error: 'Failed to generate invite code' });
  }
};

const joinCodeSchema = z.object({
  code: z.string().min(6).max(6).transform((val) => val.toUpperCase().trim()),
});

export const joinWithCode = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const parsed = joinCodeSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Valid 6-character invite code is required' });
      return;
    }

    const { code } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { coupleSpace: true },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (user.coupleSpace && user.coupleSpace.status === 'ACTIVE') {
      res.status(400).json({ error: 'You are already paired in an active couple space.' });
      return;
    }

    const space = await prisma.coupleSpace.findUnique({
      where: { inviteCode: code },
      include: { users: true },
    });

    if (!space) {
      res.status(404).json({ error: 'Invalid invite code or space does not exist.' });
      return;
    }

    if (space.codeExpiresAt && space.codeExpiresAt < new Date()) {
      res.status(400).json({ error: 'This invite code has expired. Ask your partner to generate a new one.' });
      return;
    }

    // Check if user is trying to pair with themselves
    if (space.users.some((u) => u.id === userId)) {
      res.status(400).json({ error: 'You cannot pair with yourself using your own code.' });
      return;
    }

    if (space.users.length >= 2) {
      res.status(400).json({ error: 'This space already has 2 partners paired.' });
      return;
    }

    // If user previously had an orphaned pending space, clean it up
    if (user.coupleSpace && user.coupleSpace.status === 'PENDING') {
      await prisma.user.update({
        where: { id: userId },
        data: { coupleId: null },
      });
      const pendingUsersCount = await prisma.user.count({ where: { coupleId: user.coupleSpace.id } });
      if (pendingUsersCount === 0) {
        await prisma.coupleSpace.delete({ where: { id: user.coupleSpace.id } });
      }
    }

    // Join the space, activate it, consume invite code
    const updatedSpace = await prisma.coupleSpace.update({
      where: { id: space.id },
      data: {
        status: 'ACTIVE',
        inviteCode: null,
        codeExpiresAt: null,
        users: {
          connect: { id: userId },
        },
      },
      include: {
        users: {
          select: { id: true, name: true, email: true, avatarUrl: true, lastActiveAt: true },
        },
      },
    });

    res.json({
      message: 'Successfully paired! Welcome to your shared space.',
      coupleSpace: updatedSpace,
    });
  } catch (error) {
    console.error('joinWithCode error:', error);
    res.status(500).json({ error: 'Failed to pair with invite code' });
  }
};

export const simulatePartnerJoin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    let user = await prisma.user.findUnique({
      where: { id: userId },
      include: { coupleSpace: true },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    let spaceId = user.coupleSpace?.id;
    if (!spaceId) {
      // Create pending space first
      const newSpace = await prisma.coupleSpace.create({
        data: {
          status: 'PENDING',
          users: { connect: { id: userId } },
        },
      });
      spaceId = newSpace.id;
    }

    // Find or create demo partner Aria
    let demoPartner = await prisma.user.findUnique({
      where: { email: 'aria@crystella.love' },
    });

    if (!demoPartner) {
      demoPartner = await prisma.user.create({
        data: {
          email: 'aria@crystella.love',
          name: 'Aria 🌸',
          passwordHash: 'demopartnerhash',
          timezone: 'UTC',
        },
      });
    }

    // Connect demo partner to this space and activate
    const activeSpace = await prisma.coupleSpace.update({
      where: { id: spaceId },
      data: {
        status: 'ACTIVE',
        inviteCode: null,
        codeExpiresAt: null,
        users: {
          set: [{ id: userId }, { id: demoPartner.id }],
        },
      },
      include: {
        users: {
          select: { id: true, name: true, email: true, avatarUrl: true, lastActiveAt: true },
        },
      },
    });

    res.json({
      message: 'Demo partner Aria 🌸 connected! Your space is now active.',
      coupleSpace: activeSpace,
      partner: demoPartner,
    });
  } catch (error) {
    console.error('simulatePartnerJoin error:', error);
    res.status(500).json({ error: 'Failed to simulate partner join' });
  }
};

export const getPairingStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        coupleSpace: {
          include: {
            users: {
              select: { id: true, name: true, email: true, avatarUrl: true, lastActiveAt: true },
            },
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (!user.coupleSpace) {
      res.json({ status: 'UNPAIRED', coupleSpace: null, partner: null });
      return;
    }

    const partner = user.coupleSpace.users.find((u) => u.id !== userId) || null;

    res.json({
      status: user.coupleSpace.status,
      coupleSpace: user.coupleSpace,
      partner,
      isPending: user.coupleSpace.status === 'PENDING',
      inviteCode: user.coupleSpace.inviteCode,
      codeExpiresAt: user.coupleSpace.codeExpiresAt,
    });
  } catch (error) {
    console.error('getPairingStatus error:', error);
    res.status(500).json({ error: 'Failed to fetch pairing status' });
  }
};

export const updateDates = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { coupleId: true },
    });

    if (!user?.coupleId) {
      res.status(400).json({ error: 'You are not connected to a couple space' });
      return;
    }

    const { anniversaryDate, targetMeetDate } = req.body;

    const updated = await prisma.coupleSpace.update({
      where: { id: user.coupleId },
      data: {
        ...(anniversaryDate && { anniversaryDate: new Date(anniversaryDate) }),
        ...(targetMeetDate && { targetMeetDate: new Date(targetMeetDate) }),
      },
    });

    res.json({ message: 'Dates updated successfully', coupleSpace: updated });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update couple dates' });
  }
};

export const unpair = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { coupleSpace: { include: { users: true } } },
    });

    if (!user || !user.coupleSpace) {
      res.status(400).json({ error: 'You are not connected to any space' });
      return;
    }

    const spaceId = user.coupleSpace.id;

    // Disconnect both users from this couple space
    await prisma.user.updateMany({
      where: { coupleId: spaceId },
      data: { coupleId: null },
    });

    await prisma.coupleSpace.update({
      where: { id: spaceId },
      data: { status: 'UNPAIRED' },
    });

    res.json({ message: 'Successfully unpaired space. You can pair again whenever you wish.' });
  } catch (error) {
    console.error('unpair error:', error);
    res.status(500).json({ error: 'Failed to unpair space' });
  }
};
