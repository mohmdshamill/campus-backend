import app from './app';
import { ENV } from './config/env';
import { logger } from './utils/logger';
import { prisma } from './config/db';

const server = app.listen(ENV.PORT, async () => {
  try {
    await prisma.$connect();
    logger.info(`🚀 Campus Connect Server running on http://localhost:${ENV.PORT}`);
    logger.info(`📡 Environment: ${ENV.NODE_ENV}`);
    logger.info(`📦 Database connected successfully`);
  } catch (error) {
    logger.error('Failed to connect to database on startup:', error);
  }
});

// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    await prisma.$disconnect();
    logger.info('Database disconnected. Process exited.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
