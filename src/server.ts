import { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { mcpAuthMetadataRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { InMemoryEventStore } from './inMemoryEventStore.js';
import { createActualClient } from './actual/client.js';
import { logger } from './logger.js';
import { MCP_PORT, MCP_PUBLIC_URL } from './config.js';
import { buildAuthContext } from './auth.js';
import { registerTools } from './tools/index.js';
import { registerResourcesAndPrompts } from './resources.js';

const actualClient = createActualClient();

const getServer = (): McpServer => {
  const server = new McpServer(
    {
      name: 'actual-budget-mcp',
      version: '0.1.0',
      icons: [{ src: './mcp.svg', sizes: ['512x512'], mimeType: 'image/svg+xml' }]
    },
    {
      capabilities: { logging: {} }
    }
  );

  registerTools(server, actualClient);
  registerResourcesAndPrompts(server, actualClient);
  return server;
};

const app = createMcpExpressApp();
const mcpPublicUrl = new URL(MCP_PUBLIC_URL);
const authContext = await buildAuthContext();

logger.info('MCP auth mode set', { mode: authContext.mode });

if (authContext.oauthMetadata !== undefined) {
  app.use(mcpAuthMetadataRouter({
    oauthMetadata: authContext.oauthMetadata,
    resourceServerUrl: mcpPublicUrl,
    scopesSupported: ['mcp:tools'],
    resourceName: 'Actual Budget MCP Server'
  }));
}

const transports = new Map<string, StreamableHTTPServerTransport>();

const mcpPostHandler = async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId !== undefined && sessionId !== '') {
    logger.debug('Received MCP request', { sessionId });
  }

  try {
    if (sessionId !== undefined && sessionId !== '') {
      const existingTransport = transports.get(sessionId);
      if (existingTransport !== undefined) {
        await existingTransport.handleRequest(req, res, req.body);
      }
      if (existingTransport === undefined) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Bad Request: Transport not initialized' },
          id: null
        });
      }
    } else if ((sessionId === undefined || sessionId === '') && isInitializeRequest(req.body)) {
      const eventStore = new InMemoryEventStore();
      const newTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        eventStore,
        onsessioninitialized: (sid: string) => {
          logger.info('Session initialized', { sessionId: sid });
          transports.set(sid, newTransport);
        }
      });

      newTransport.onclose = () => {
        const sid = newTransport.sessionId;
        if (sid !== undefined && sid !== '' && transports.has(sid)) {
          logger.info('Transport closed, removing from map', { sessionId: sid });
          transports.delete(sid);
        }
      };

      const server = getServer();
      await server.connect(newTransport);
      await newTransport.handleRequest(req, res, req.body);
      const sid = newTransport.sessionId;
      if (sid !== undefined && sid !== '') {
        transports.set(sid, newTransport);
      }
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null
      });
    }
  } catch (error) {
    logger.error('Error handling MCP request', { error: String(error) });
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null
      });
    }
  }
};

const mcpGetHandler = async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId === undefined || sessionId === '' || !transports.has(sessionId)) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  const lastEventId = req.headers['last-event-id'] as string | undefined;
  if (lastEventId !== undefined && lastEventId !== '') {
    logger.debug('Client reconnecting', { sessionId, lastEventId });
  } else {
    logger.info('Establishing new SSE stream', { sessionId });
  }

  const transport = transports.get(sessionId);
  if (transport === undefined) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  await transport.handleRequest(req, res);
};

if (authContext.middleware !== null) {
  app.post('/mcp', authContext.middleware, (req: Request, res: Response) => { void mcpPostHandler(req, res); });
  app.get('/mcp', authContext.middleware, (req: Request, res: Response) => { void mcpGetHandler(req, res); });
} else {
  app.post('/mcp', (req: Request, res: Response) => { void mcpPostHandler(req, res); });
  app.get('/mcp', (req: Request, res: Response) => { void mcpGetHandler(req, res); });
}

const mcpDeleteHandler = async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId === undefined || sessionId === '' || !transports.has(sessionId)) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  logger.info('Received session termination request', { sessionId });

  try {
    const transport = transports.get(sessionId);
    if (transport === undefined) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    await transport.handleRequest(req, res);
  } catch (error) {
    logger.error('Error handling session termination', { error: String(error) });
    if (!res.headersSent) {
      res.status(500).send('Error processing session termination');
    }
  }
};

if (authContext.middleware !== null) {
  app.delete('/mcp', authContext.middleware, (req: Request, res: Response) => { void mcpDeleteHandler(req, res); });
} else {
  app.delete('/mcp', (req: Request, res: Response) => { void mcpDeleteHandler(req, res); });
}

app.listen(MCP_PORT, (error?: Error) => {
  if (error != null) {
    logger.error('Failed to start server', { error: String(error) });
    process.exit(1);
  }
  logger.info('Actual Budget MCP Server listening', { port: MCP_PORT });
});

const gracefulShutdown = async (): Promise<void> => {
  logger.info('Shutting down server');
  for (const [sessionId, transport] of transports.entries()) {
    try {
      logger.debug('Closing transport', { sessionId });
      await transport.close();
      transports.delete(sessionId);
    } catch (error) {
      logger.error('Error closing transport', { sessionId, error: String(error) });
    }
  }
  try {
    await actualClient.shutdown();
  } catch (error) {
    logger.error('Error during Actual API shutdown', { error: String(error) });
  }
  logger.info('Server shutdown complete');
  process.exit(0);
};

process.on('SIGINT', () => { void gracefulShutdown(); });
process.on('SIGTERM', () => { void gracefulShutdown(); });
