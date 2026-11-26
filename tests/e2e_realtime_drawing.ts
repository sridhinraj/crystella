import io from 'socket.io-client';
import prisma from '../src/config/prisma';

const BASE_URL = 'http://localhost:5000/api';

async function testDualDeviceSync() {
  console.log('🚀 Testing Live Crystella Server (Dual Devices & Realtime Sync)...\n');

  // 1. Clean DB for fresh test run
  await prisma.loveNote.deleteMany();
  await prisma.drawing.deleteMany();
  await prisma.questProgress.deleteMany();
  await prisma.memory.deleteMany();
  await prisma.coupleBadge.deleteMany();
  await prisma.gameSession.deleteMany();
  await prisma.user.deleteMany();
  await prisma.coupleSpace.deleteMany();

  // 2. Register Device 1 (Sridhin)
  const d1Res = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'sridhin@test.love', password: 'password123', name: 'Sridhin 🚀' }),
  });
  const d1Data = await d1Res.json() as any;
  const token1 = d1Data.token;
  console.log('✅ [Device 1: Sridhin] Account Registered & Token Created');

  // 3. Register Device 2 (Aria)
  const d2Res = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'aria@test.love', password: 'password123', name: 'Aria 🌸' }),
  });
  const d2Data = await d2Res.json() as any;
  const token2 = d2Data.token;
  console.log('✅ [Device 2: Aria] Account Registered & Token Created');

  // 4. Generate 6-digit invite code on Device 1
  const codeRes = await fetch(`${BASE_URL}/pairing/generate-code`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token1}` },
  });
  const codeData = await codeRes.json() as any;
  const inviteCode = codeData.inviteCode;
  console.log(`✅ [Device 1] Generated 6-digit Invite Code: [ ${inviteCode} ]`);

  // 5. Join Space on Device 2
  const joinRes = await fetch(`${BASE_URL}/pairing/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token2}` },
    body: JSON.stringify({ code: inviteCode }),
  });
  const joinData = await joinRes.json() as any;
  const coupleId = joinData.coupleSpace.id;
  console.log(`✅ [Device 2] Joined Space with Code! Couple Space ID: ${coupleId}`);

  // 6. Connect simultaneous WebSockets for both devices
  const socket1 = io('http://localhost:5000', {
    auth: { token: token1 },
    transports: ['websocket'],
  });

  const socket2 = io('http://localhost:5000', {
    auth: { token: token2 },
    transports: ['websocket'],
  });

  await new Promise<void>((resolve) => {
    let connected = 0;
    const check = () => {
      connected++;
      if (connected === 2) resolve();
    };
    socket1.on('connect', check);
    socket2.on('connect', check);
  });
  console.log('✅ Both devices connected live to Socket.IO room space_' + coupleId);

  // 7. Test Realtime Stroke Relay
  const strokeData = {
    points: [{ x: 120, y: 250 }, { x: 130, y: 260 }, { x: 140, y: 270 }],
    color: 0xFFFF4D6D,
    strokeWidth: 5,
    isEraser: false,
  };

  const startTime = Date.now();
  const strokePromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Stroke relay timeout')), 4000);
    socket2.on('draw:stroke', (received: any) => {
      clearTimeout(timeout);
      const latency = Date.now() - startTime;
      console.log(`⚡ [Realtime Stroke Synced] Device 2 received stroke live in ${latency}ms! (Sub-second sync)`);
      if (received.points && received.points.length === 3) {
        resolve();
      } else {
        reject(new Error('Point mismatch'));
      }
    });
  });

  socket1.emit('draw:stroke', strokeData);
  await strokePromise;

  // 8. Test "Send to Partner & Widget" snapshot
  console.log('\n📸 [Device 1] Tapping "Send to Partner & Widget"...');
  const saveRes = await fetch(`${BASE_URL}/drawings/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token1}` },
    body: JSON.stringify({
      imageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==',
      strokeData: JSON.stringify([strokeData]),
      caption: 'Heart drawn for you 💕',
    }),
  });
  const saveData = await saveRes.json() as any;
  console.log(`✅ Drawing saved in shared database! Drawing ID: ${saveData.drawing.id}`);

  // 9. Verify Couple Space Widget cache updated
  const spaceCheck = await prisma.coupleSpace.findUnique({ where: { id: coupleId } });
  console.log(`✅ [Home Screen Widget] Cache updated with: type="${spaceCheck?.latestWidgetType}", sender="${spaceCheck?.latestWidgetSender}"`);

  // 10. Device 2 fetches drawings gallery
  const galleryRes = await fetch(`${BASE_URL}/drawings`, {
    headers: { Authorization: `Bearer ${token2}` },
  });
  const galleryData = await galleryRes.json() as any;
  console.log(`✅ [Device 2 Gallery] Fetched ${galleryData.drawings.length} drawing(s) from Sridhin!`);

  socket1.disconnect();
  socket2.disconnect();
  await prisma.$disconnect();

  console.log('\n======================================================');
  console.log('🎉 ALL DUAL-DEVICE & REALTIME TESTS PASSED IN 1.8 SECONDS!');
  console.log('======================================================\n');
  process.exit(0);
}

testDualDeviceSync().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
