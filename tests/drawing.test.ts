import request from 'supertest';
import { app } from '../src/server';
import prisma from '../src/config/prisma';

describe('Realtime Drawing Canvas API Tests', () => {
  let token: string;
  let coupleId: string;

  beforeAll(async () => {
    // Clean up in correct FK order
    await prisma.loveNote.deleteMany();
    await prisma.drawing.deleteMany();
    await prisma.questProgress.deleteMany();
    await prisma.memory.deleteMany();
    await prisma.coupleBadge.deleteMany();
    await prisma.gameSession.deleteMany();
    await prisma.user.deleteMany();
    await prisma.coupleSpace.deleteMany();

    // Setup active paired couple
    const space = await prisma.coupleSpace.create({
      data: { status: 'ACTIVE' },
    });
    coupleId = space.id;

    const userRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'artist@crystella.love',
        password: 'password123',
        name: 'Artist',
      });

    token = userRes.body.token;

    // Link user to space
    await prisma.user.update({
      where: { id: userRes.body.user.id },
      data: { coupleId },
    });
  });

  afterAll(async () => {
    await prisma.loveNote.deleteMany();
    await prisma.drawing.deleteMany();
    await prisma.questProgress.deleteMany();
    await prisma.memory.deleteMany();
    await prisma.coupleBadge.deleteMany();
    await prisma.gameSession.deleteMany();
    await prisma.user.deleteMany();
    await prisma.coupleSpace.deleteMany();
    await prisma.$disconnect();
  });

  it('should save a new drawing and update widget cache', async () => {
    const res = await request(app)
      .post('/api/drawings/save')
      .set('Authorization', `Bearer ${token}`)
      .send({
        imageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        strokeData: '[{"points":[{"x":10,"y":20}],"color":4294921581,"strokeWidth":5}]',
        caption: 'Good morning my love 💖',
      });

    expect(res.status).toBe(201);
    expect(res.body.drawing).toBeDefined();
    expect(res.body.drawing.caption).toBe('Good morning my love 💖');

    // Verify widget cache on couple space was updated
    const updatedSpace = await prisma.coupleSpace.findUnique({
      where: { id: coupleId },
    });
    expect(updatedSpace?.latestWidgetType).toBe('DRAWING');
    expect(updatedSpace?.latestWidgetSender).toBe('Artist');
  });

  it('should fetch the list of drawings for the couple space', async () => {
    const res = await request(app)
      .get('/api/drawings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.drawings)).toBe(true);
    expect(res.body.drawings.length).toBe(1);
    expect(res.body.drawings[0].sender.name).toBe('Artist');
  });
});
