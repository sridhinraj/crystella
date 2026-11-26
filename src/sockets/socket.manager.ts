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
    const coupleId = socket.coupleId;

    if (coupleId) {
      const room = `space_${coupleId}`;
      socket.join(room);

      // Broadcast partner is online
      socket.to(room).emit('presence:update', { userId, status: 'online' });

      // Drawing real-time stroke relay
      socket.on('draw:stroke', (strokeData) => {
        socket.to(room).emit('draw:stroke', {
          senderId: userId,
          ...strokeData,
        });
      });

      socket.on('draw:undo', () => {
        socket.to(room).emit('draw:undo', { senderId: userId });
      });

      socket.on('draw:clear', () => {
        socket.to(room).emit('draw:clear', { senderId: userId });
      });

      // Instant love tap / thinking of you nudge
      socket.on('note:tap', async (data) => {
        // Look up sender name from DB for the partner's notification banner
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
      });

      // Realtime game actions
      socket.on('game:action', (gameAction) => {
        socket.to(room).emit('game:action', {
          senderId: userId,
          ...gameAction,
        });
      });

      socket.on('disconnect', () => {
        socket.to(room).emit('presence:update', { userId, status: 'offline' });
      });
    }
  });
};
