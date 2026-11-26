import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import prisma from '../config/prisma';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  coupleId?: string;
}

export const setupSocketHandlers = (io: SocketIOServer) => {
  // Middleware to authenticate socket connections
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(' ')[1] ||
        (socket.handshake.query?.token as string);

      if (!token) {
        return next(new Error('Authentication required for socket'));
      }

      const decoded = jwt.verify(token, config.jwtSecret) as { id: string; email: string };
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, coupleId: true },
      });

      if (!user) {
        return next(new Error('User not found'));
      }

      socket.userId = user.id;
      socket.coupleId = user.coupleId || undefined;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    const userId = socket.userId;
    let coupleId = socket.coupleId;

    const joinRoom = (targetCoupleId: string) => {
      coupleId = targetCoupleId;
      socket.coupleId = targetCoupleId;
      const room = `space_${targetCoupleId}`;
      socket.join(room);
      console.log(`[Socket] User ${userId} joined room ${room}`);
      socket.to(room).emit('presence:update', { userId, status: 'online' });
    };

    if (coupleId) {
      joinRoom(coupleId);
    }

    // Explicit room join event from client
    socket.on('join:space', async (data?: { coupleId?: string }) => {
      let targetId = data?.coupleId || coupleId;
      if (!targetId && userId) {
        // Query database in case pairing occurred after socket handshake
        try {
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { coupleId: true },
          });
          if (user?.coupleId) targetId = user.coupleId;
        } catch (_) {}
      }
      if (targetId) {
        joinRoom(targetId);
        socket.emit('joined:space', { coupleId: targetId });
      }
    });

    const getRoom = async (): Promise<string | null> => {
      if (coupleId) return `space_${coupleId}`;
      if (userId) {
        try {
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { coupleId: true },
          });
          if (user?.coupleId) {
            joinRoom(user.coupleId);
            return `space_${user.coupleId}`;
          }
        } catch (_) {}
      }
      return null;
    };

    // Drawing real-time stroke relay
    socket.on('draw:stroke', async (strokeData) => {
      const room = await getRoom();
      if (room) {
        socket.to(room).emit('draw:stroke', {
          senderId: userId,
          ...strokeData,
        });
      }
    });

    socket.on('draw:undo', async () => {
      const room = await getRoom();
      if (room) {
        socket.to(room).emit('draw:undo', { senderId: userId });
      }
    });

    socket.on('draw:clear', async () => {
      const room = await getRoom();
      if (room) {
        socket.to(room).emit('draw:clear', { senderId: userId });
      }
    });

    // Instant love tap / thinking of you nudge
    socket.on('note:tap', async (data) => {
      const room = await getRoom();
      if (room) {
        let senderName = 'Your Partner';
        try {
          const sender = await prisma.user.findUnique({
            where: { id: userId },
            select: { name: true },
          });
          if (sender) senderName = sender.name;
        } catch (_) {}

        socket.to(room).emit('note:tap', {
          senderId: userId,
          senderName,
          type: data.type || 'TAP',
          content: data.content || 'Sent you love!',
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Realtime game actions
    socket.on('game:action', async (gameAction) => {
      const room = await getRoom();
      if (room) {
        socket.to(room).emit('game:action', {
          senderId: userId,
          ...gameAction,
        });
      }
    });

    socket.on('disconnect', () => {
      if (coupleId) {
        socket.to(`space_${coupleId}`).emit('presence:update', { userId, status: 'offline' });
      }
    });
  });
};
