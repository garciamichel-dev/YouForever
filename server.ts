import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

// Filter benign Firestore internal gRPC idle stream cancellation messages
const originalWarn = console.warn;
console.warn = (...args: any[]) => {
  const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a) || '')).join(' ');
  if (msg.includes('Disconnecting idle stream') || (msg.includes("RPC 'Listen'") && msg.includes('CANCELLED'))) {
    return;
  }
  originalWarn(...args);
};

const originalError = console.error;
console.error = (...args: any[]) => {
  const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a) || '')).join(' ');
  if (msg.includes('Disconnecting idle stream') || (msg.includes("RPC 'Listen'") && msg.includes('CANCELLED'))) {
    return;
  }
  originalError(...args);
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Generous limit for long audio recordings (10+ min) and photo attachments
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '100mb' }));

  // Load heavy backend router asynchronously AFTER binding port 3000 so startup probes succeed immediately
  let resolvedApiRouter: express.Router | null = null;
  let apiLoadError: Error | null = null;
  let apiReadyPromise: Promise<express.Router> | null = null;

  app.get('/api/health', (_req, res, next) => {
    if (resolvedApiRouter) {
      return next();
    }
    res.json({
      success: true,
      status: 'ok',
      initializing: true,
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api', async (req, res, next) => {
    try {
      if (resolvedApiRouter) {
        return resolvedApiRouter(req, res, next);
      }
      if (apiLoadError) {
        return next(apiLoadError);
      }
      const router = apiReadyPromise
        ? await apiReadyPromise
        : (await import('./src/server/api.ts')).apiRouter;
      resolvedApiRouter = router;
      return router(req, res, next);
    } catch (err) {
      return next(err);
    }
  });

  // Catch-all for undefined /api/* endpoints: Always return JSON, never HTML
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint API no encontrado.' });
  });

  // Global Error Handler for /api: Always return JSON, never HTML
  app.use('/api', (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[API Unhandled Error]:', err);
    res.status(err?.status || 500).json({
      success: false,
      error: err?.message || 'Error interno del servidor.',
    });
  });

  let viteMiddleware: express.RequestHandler | null = null;

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    process.env.DISABLE_HMR = 'true';
    app.use((req, res, next) => {
      if (viteMiddleware) {
        return viteMiddleware(req, res, next);
      }
      res
        .status(200)
        .set('Content-Type', 'text/html')
        .send(
          '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="1"><title>YouForever</title></head><body>Cargando...</body></html>'
        );
    });
  }

  // Bind port 3000 immediately before loading heavy server modules or Vite bundler
  await new Promise<void>((resolve) => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`ForeverYou full-stack ${process.env.NODE_ENV === 'production' ? 'production' : 'dev'} server running on port ${PORT}`);
      resolve();
    });
  });

  apiReadyPromise = import('./src/server/api.ts')
    .then((mod) => {
      resolvedApiRouter = mod.apiRouter;
      return mod.apiRouter;
    })
    .catch((err) => {
      apiLoadError = err instanceof Error ? err : new Error(String(err));
      console.error('Failed to initialize API router:', apiLoadError);
      throw apiLoadError;
    });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: null,
      },
      appType: 'spa',
    });
    viteMiddleware = vite.middlewares;
  }

  await apiReadyPromise;
}

startServer().catch((err) => {
  console.error('Failed to start full-stack server:', err);
  process.exit(1);
});
