import { randomBytes } from 'crypto';
export const newTicketId = () =>
  `TCK-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex').toUpperCase()}`;
