import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import prisma from '../config/prisma';
import { config } from '../config/env';
import { AuthRequest } from '../middleware/auth';

const googleClient = new OAuth2Client(config.googleClientId);

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  timezone: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
      return;
    }

    const { email, password, name, timezone } = parsed.data;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        timezone: timezone || 'UTC',
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        coupleId: true,
        timezone: true,
        createdAt: true,
      },
    });

    const token = jwt.sign({ id: user.id, email: user.email }, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn as any,
    });

    res.status(201).json({
      message: 'Account created successfully',
      user,
      token,
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid email or password format' });
      return;
    }

    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email },
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
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Update last active
    await prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() },
    });

    const token = jwt.sign({ id: user.id, email: user.email }, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn as any,
    });

    const { passwordHash, ...userProfile } = user;

    res.json({
      message: 'Login successful',
      user: userProfile,
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
};

export const socialLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { provider, email, name, avatarUrl } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email is required for social login' });
      return;
    }

    let user = await prisma.user.findUnique({
      where: { email },
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
      // Auto-register social user
      user = await prisma.user.create({
        data: {
          email,
          name: name || (email.split('@')[0]),
          passwordHash: await bcrypt.hash(`social_${provider}_${Date.now()}`, 10),
          avatarUrl: avatarUrl || null,
        },
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
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() },
    });

    const token = jwt.sign({ id: user.id, email: user.email }, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn as any,
    });

    const { passwordHash, ...userProfile } = user;

    res.json({
      message: `Successfully signed in with ${provider || 'social'}`,
      user: userProfile,
      token,
    });
  } catch (error) {
    console.error('Social login error:', error);
    res.status(500).json({ error: 'Server error during social login' });
  }
};

export const googleLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      res.status(400).json({ error: 'idToken is required for Google Sign-In' });
      return;
    }

    let email: string | undefined;
    let name: string | undefined;
    let picture: string | undefined;

    if (config.googleClientId) {
      // Cryptographically verify Google ID Token directly against Google's servers
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: config.googleClientId,
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.email) {
        res.status(401).json({ error: 'Invalid Google token payload' });
        return;
      }
      email = payload.email;
      name = payload.name;
      picture = payload.picture;
    } else {
      // In development fallback if client ID is pending configuration
      res.status(400).json({
        error: 'GOOGLE_CLIENT_ID not configured in backend .env yet. Please provide your Google Client ID.',
      });
      return;
    }

    let user = await prisma.user.findUnique({
      where: { email },
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
      // Auto-register verified Google user
      user = await prisma.user.create({
        data: {
          email,
          name: name || email.split('@')[0],
          passwordHash: await bcrypt.hash(`google_oauth_${Date.now()}`, 10),
          avatarUrl: picture || null,
        },
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
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() },
    });

    const token = jwt.sign({ id: user.id, email: user.email }, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn as any,
    });

    const { passwordHash, ...userProfile } = user;

    res.json({
      message: 'Successfully verified with Google',
      user: userProfile,
      token,
    });
  } catch (error) {
    console.error('Google verification error:', error);
    res.status(401).json({ error: 'Failed to verify Google ID token with Google servers' });
  }
};

export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        coupleId: true,
        timezone: true,
        lastActiveAt: true,
        createdAt: true,
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

    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching user' });
  }
};

export const updateFcmToken = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { fcmToken } = req.body;

    if (!fcmToken) {
      res.status(400).json({ error: 'FCM token is required' });
      return;
    }

    await prisma.user.update({
      where: { id: userId },
      data: { fcmToken },
    });

    res.json({ message: 'FCM token updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update FCM token' });
  }
};
