import 'dotenv/config';
import path from 'path';
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) throw new Error('JWT_SECRET is required');
export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret,
  jwtExpiresInSeconds: 15 * 60, // short-lived tokens: JWT revocation strategy (decision 5)
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? 'uploads'),
  maxUploadBytes: 10 * 1024 * 1024, // 10 MB (section 11.4)
};
