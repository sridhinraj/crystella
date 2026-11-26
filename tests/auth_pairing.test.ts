import request from 'supertest';
import { app } from '../src/server';
import prisma from '../src/config/prisma';

describe('Auth & Couple Pairing Flow Integration Tests', () => {
  beforeAll(async () => {
    // Clean up test data
    await prisma.loveNote.deleteMany();
    await prisma.drawing.deleteMany();
    await prisma.questProgress.deleteMany();
    await prisma.memory.deleteMany();
    await prisma.coupleBadge.deleteMany();
    await prisma.gameSession.deleteMany();
    await prisma.user.deleteMany();
    await prisma.coupleSpace.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  let user1Token: string;
  let user2Token: string;
  let user1Id: string;
  let user2Id: string;
  let inviteCode: string;

  it('should register User 1 successfully', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'alice@crystella.love',
        password: 'password123',
        name: 'Alice',
      });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe('alice@crystella.love');
    user1Token = res.body.token;
    user1Id = res.body.user.id;
  });

  it('should register User 2 successfully', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'bob@crystella.love',
        password: 'password123',
        name: 'Bob',
      });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe('bob@crystella.love');
    user2Token = res.body.token;
    user2Id = res.body.user.id;
  });

  it('should log in User 1 with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'alice@crystella.love',
        password: 'password123',
      });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('should reject invalid password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'alice@crystella.love',
        password: 'wrongpassword',
      });

    expect(res.status).toBe(401);
  });

  it('should return UNPAIRED status initially for User 1', async () => {
    const res = await request(app)
      .get('/api/pairing/status')
      .set('Authorization', `Bearer ${user1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('UNPAIRED');
    expect(res.body.partner).toBeNull();
  });

  it('should generate a 6-digit invite code for User 1', async () => {
    const res = await request(app)
      .post('/api/pairing/generate-code')
      .set('Authorization', `Bearer ${user1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.inviteCode).toBeDefined();
    expect(res.body.inviteCode.length).toBe(6);
    inviteCode = res.body.inviteCode;
  });

  it('should not allow User 1 to pair with their own code', async () => {
    const res = await request(app)
      .post('/api/pairing/join')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ code: inviteCode });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('cannot pair with yourself');
  });

  it('should reject an invalid or non-existent invite code', async () => {
    const res = await request(app)
      .post('/api/pairing/join')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ code: 'ZZZZZZ' });

    expect(res.status).toBe(404);
  });

  it('should successfully pair User 2 with User 1 using valid invite code', async () => {
    const res = await request(app)
      .post('/api/pairing/join')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ code: inviteCode });

    expect(res.status).toBe(200);
    expect(res.body.coupleSpace).toBeDefined();
    expect(res.body.coupleSpace.status).toBe('ACTIVE');
    expect(res.body.coupleSpace.users.length).toBe(2);
  });

  it('should now report ACTIVE status and show Alice as Bob’s partner', async () => {
    const res = await request(app)
      .get('/api/pairing/status')
      .set('Authorization', `Bearer ${user2Token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.partner).toBeDefined();
    expect(res.body.partner.name).toBe('Alice');
  });

  it('should report ACTIVE status and show Bob as Alice’s partner', async () => {
    const res = await request(app)
      .get('/api/pairing/status')
      .set('Authorization', `Bearer ${user1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.partner).toBeDefined();
    expect(res.body.partner.name).toBe('Bob');
  });
});
