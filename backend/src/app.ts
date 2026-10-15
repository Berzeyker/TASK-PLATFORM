import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config';
import { errorHandler } from './utils/http';
import { authRouter } from './routes/auth';
import { ticketsRouter } from './routes/tickets';
import { adminRouter, categoriesRouter } from './routes/admin';

export const app = express();
app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '1mb' }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/tickets', ticketsRouter);
app.use('/api/v1/categories', categoriesRouter);
app.use('/api/v1/admin', adminRouter);
app.use(errorHandler);
