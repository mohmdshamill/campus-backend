import dotenv from 'dotenv';
dotenv.config();

export const ENV = {
  PORT: parseInt(process.env.PORT || '5000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  JWT_SECRET: process.env.JWT_SECRET || 'super-secret-campus-connect-jwt-key-32chars',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  COOKIE_SECRET: process.env.COOKIE_SECRET || 'campus-connect-cookie-secret-key-32',
  COLLEGE_TIMEZONE: process.env.COLLEGE_TIMEZONE || 'Asia/Kolkata',
  DATABASE_URL: process.env.DATABASE_URL || '',
};
