import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { config } from './config/env';
import authRoutes from './routes/auth.routes';
import pairingRoutes from './routes/pairing.routes';
import notesRoutes from './routes/notes.routes';
import drawingRoutes from './routes/drawing.routes';
import { errorHandler } from './middleware/errorHandler';
import { setupSocketHandlers } from './sockets/socket.manager';

export const app = express();
export const server = http.createServer(app);

// Enable CORS for mobile clients & web
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Crystella Backend API', timestamp: new Date() });
});

// API Routes (mounted at both /api/* and /* for universal client compatibility)
app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes);

app.use('/api/pairing', pairingRoutes);
app.use('/pairing', pairingRoutes);

app.use('/api/notes', notesRoutes);
app.use('/notes', notesRoutes);

app.use('/api/drawings', drawingRoutes);
app.use('/drawings', drawingRoutes);

// Error Handling Middleware
app.use(errorHandler);

// Realtime WebSockets
export const io = new SocketIOServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});
setupSocketHandlers(io);

if (process.env.NODE_ENV !== 'test') {
  server.listen(config.port, () => {
    console.log(`✨ Crystella Server listening on port ${config.port} (${config.nodeEnv})`);
  });
}
