import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import type { AppConfig } from '../config/schema.js';
import { configRoutes } from './routes/config.js';
import { statusRoutes } from './routes/status.js';
import { chatRoutes } from './routes/chat.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('web');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolvePublicDir(): string {
  // In dev mode (tsx): __dirname = src/web, public = src/web/public
  // In prod mode (tsc): __dirname = dist/web, public may be at src/web/public
  const local = path.join(__dirname, 'public');
  if (fs.existsSync(local)) return local;
  // Fallback: resolve from project root
  const fromRoot = path.resolve(__dirname, '../../src/web/public');
  if (fs.existsSync(fromRoot)) return fromRoot;
  return local; // default
}

export async function startWebServer(config: AppConfig) {
  const app = Fastify({ logger: false });

  // Register plugins
  await app.register(fastifyWebsocket);
  await app.register(fastifyStatic, {
    root: resolvePublicDir(),
    prefix: '/',
  });

  // Register routes
  await app.register(configRoutes);
  await app.register(statusRoutes);
  await app.register(chatRoutes);

  const { port, host } = config.server;
  await app.listen({ port, host });
  log.info({ port, host }, 'Web dashboard started at http://%s:%d', host, port);

  return app;
}
