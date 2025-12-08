import { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { type CallToolResult, isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { InMemoryEventStore } from './inMemoryEventStore.js';
import { createActualClient } from './actual/client.js';

const actualClient = createActualClient();

const registerTools = (server: McpServer): void => {
  // Get Accounts
  server.registerTool(
    'get-accounts',
    {
      title: 'Get Accounts',
      description: 'Retrieve all accounts with their current balances'
    },
    async (): Promise<CallToolResult> => {
      const accounts = await actualClient.getAccounts();
      return { content: [{ type: 'text', text: JSON.stringify(accounts, null, 2) }] };
    }
  );

  // Get Transactions
  server.registerTool(
    'get-transactions',
    {
      title: 'Get Transactions',
      description: 'Retrieve transactions with optional filters',
      inputSchema: {
        accountId: z.string().describe('Account ID to filter'),
        startDate: z.string().describe('Start date YYYY-MM-DD'),
        endDate: z.string().describe('End date YYYY-MM-DD'),
        minAmount: z.number().nullish().describe('Minimum amount (positive=income, negative=expense)'),
        maxAmount: z.number().nullish().describe('Maximum amount'),
        categoryId: z.string().nullish().describe('Category ID to filter'),
        payeeId: z.string().nullish().describe('Payee ID to filter')
      }
    },
    async args => {
      const txns = await actualClient.getTransactions(args);
      return { content: [{ type: 'text', text: JSON.stringify(txns, null, 2) }] };
    }
  );

  // Add Transaction
  server.registerTool(
    'add-transaction',
    {
      title: 'Add Transaction',
      description: 'Create a new transaction',
      inputSchema: {
        accountId: z.string(),
        date: z.string().describe('YYYY-MM-DD'),
        amount: z.number().describe('Positive = income, negative = expense'),
        payeeName: z.string(),
        categoryId: z.string().nullish(),
        notes: z.string().nullish()
      }
    },
    async args => {
      // const id = await actualClient.addTransaction(args);
      // return { content: [{ type: 'text', text: `Created transaction ${id}` }] };
      return { content: [{ type: 'text', text: 'Only READ operations are supported currently. Your request was not processed.' }] };
    }
  );

  // Update Transaction
  server.registerTool(
    'update-transaction',
    {
      title: 'Update Transaction',
      description: 'Update an existing transaction',
      inputSchema: {
        transactionId: z.string(),
        amount: z.number().nullish(),
        date: z.string().nullish(),
        payeeId: z.string().nullish(),
        categoryId: z.string().nullish(),
        notes: z.string().nullish()
      }
    },
    async ({ transactionId, ...updated }) => {
      // const sanitized = {
      //     amount: updated.amount ?? undefined,
      //     date: updated.date ?? undefined,
      //     payeeId: updated.payeeId ?? undefined,
      //     categoryId: updated.categoryId ?? undefined,
      //     notes: updated.notes ?? undefined
      // };
      // await actualClient.updateTransaction(transactionId, sanitized);
      // return { content: [{ type: 'text', text: `Updated transaction ${transactionId}` }] };
      return { content: [{ type: 'text', text: 'Only READ operations are supported currently. Your request was not processed.' }] };
    }
  );

  // Delete Transaction
  server.registerTool(
    'delete-transaction',
    {
      title: 'Delete Transaction',
      description: 'Remove a transaction',
      inputSchema: { transactionId: z.string() }
    },
    async ({ transactionId }) => {
      // await actualClient.deleteTransaction(transactionId);
      // return { content: [{ type: 'text', text: `Deleted transaction ${transactionId}` }] };
      return { content: [{ type: 'text', text: 'Only READ operations are supported currently. Your request was not processed.' }] };
    }
  );

  // Get Balance History
  server.registerTool(
    'get-balance-history',
    {
      title: 'Get Balance History',
      description: 'Compute balance history for an account over a date range',
      inputSchema: {
        accountId: z.string(),
        startDate: z.string().describe('YYYY-MM-DD'),
        endDate: z.string().describe('YYYY-MM-DD')
      }
    },
    async args => {
      const history = await actualClient.getBalanceHistory(args.accountId, args.startDate, args.endDate);
      return { content: [{ type: 'text', text: JSON.stringify(history, null, 2) }] };
    }
  );

  // Get Spending By Category
  server.registerTool(
    'get-spending-by-category',
    {
      title: 'Spending By Category',
      description: 'Breakdown of spending by category for a date range',
      inputSchema: {
        startDate: z.string(),
        endDate: z.string()
      }
    },
    async args => {
      const breakdown = await actualClient.getSpendingByCategory(args.startDate, args.endDate);
      return { content: [{ type: 'text', text: JSON.stringify(breakdown, null, 2) }] };
    }
  );

  // Get Monthly Summary
  server.registerTool(
    'get-monthly-summary',
    {
      title: 'Monthly Summary',
      description: 'Income, expenses, and savings for a month',
      inputSchema: {
        year: z.number(),
        month: z.number().describe('1-12')
      }
    },
    async args => {
      const summary = await actualClient.getMonthlySummary(args.year, args.month);
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    }
  );

  // Get Grouped Categories
  server.registerTool(
    'get-grouped-categories',
    {
      title: 'Get Grouped Categories',
      description: 'Retrieve category groups and their categories'
    },
    async () => {
      const groups = await actualClient.getGroupedCategories();
      return { content: [{ type: 'text', text: JSON.stringify(groups, null, 2) }] };
    }
  );

  // Create Category
  server.registerTool(
    'create-category',
    {
      title: 'Create Category',
      description: 'Create a new category within a group',
      inputSchema: {
        groupId: z.string(),
        categoryName: z.string()
      }
    },
    async args => {
      // const id = await actualClient.createCategory(args.groupId, args.categoryName);
      // return { content: [{ type: 'text', text: `Created category ${id}` }] };
      return { content: [{ type: 'text', text: 'Only READ operations are supported currently. Your request was not processed.' }] };
    }
  );

  // Update Category
  server.registerTool(
    'update-category',
    {
      title: 'Update Category',
      description: 'Rename or move a category',
      inputSchema: {
        categoryId: z.string(),
        newName: z.string().nullish(),
        newGroupId: z.string().nullish()
      }
    },
    async args => {
      // await actualClient.updateCategory(args.categoryId, { newName: args.newName, newGroupId: args.newGroupId });
      // return { content: [{ type: 'text', text: `Updated category ${args.categoryId}` }] };
      return { content: [{ type: 'text', text: 'Only READ operations are supported currently. Your request was not processed.' }] };
    }
  );

  // Delete Category
  server.registerTool(
    'delete-category',
    {
      title: 'Delete Category',
      description: 'Delete a category',
      inputSchema: { categoryId: z.string() }
    },
    async args => {
      // await actualClient.deleteCategory(args.categoryId);
      // return { content: [{ type: 'text', text: `Deleted category ${args.categoryId}` }] };
      return { content: [{ type: 'text', text: 'Only READ operations are supported currently. Your request was not processed.' }] };
    }
  );

  // Create Category Group
  server.registerTool(
    'create-category-group',
    {
      title: 'Create Category Group',
      description: 'Create a new category group',
      inputSchema: {
        groupName: z.string(),
        isIncomeGroup: z.boolean().default(false)
      }
    },
    async args => {
      // const id = await actualClient.createCategoryGroup(args.groupName, args.isIncomeGroup);
      // return { content: [{ type: 'text', text: `Created category group ${id}` }] };
      return { content: [{ type: 'text', text: 'Only READ operations are supported currently. Your request was not processed.' }] };
    }
  );

  // Update Category Group
  server.registerTool(
    'update-category-group',
    {
      title: 'Update Category Group',
      description: 'Update a category group name',
      inputSchema: {
        groupId: z.string(),
        newName: z.string()
      }
    },
    async args => {
      // await actualClient.updateCategoryGroup(args.groupId, args.newName);
      // return { content: [{ type: 'text', text: `Updated category group ${args.groupId}` }] };
      return { content: [{ type: 'text', text: 'Only READ operations are supported currently. Your request was not processed.' }] };
    }
  );

  // Delete Category Group
  server.registerTool(
    'delete-category-group',
    {
      title: 'Delete Category Group',
      description: 'Delete a category group',
      inputSchema: { groupId: z.string() }
    },
    async args => {
      // await actualClient.deleteCategoryGroup(args.groupId);
      // return { content: [{ type: 'text', text: `Deleted category group ${args.groupId}` }] };
      return { content: [{ type: 'text', text: 'Only READ operations are supported currently. Your request was not processed.' }] };
    }
  );

  // Get Payees
  server.registerTool(
    'get-payees',
    { title: 'Get Payees', description: 'List all payees' },
    async () => {
      const payees = await actualClient.getPayees();
      return { content: [{ type: 'text', text: JSON.stringify(payees, null, 2) }] };
    }
  );

  // Create Payee
  server.registerTool(
    'create-payee',
    {
      title: 'Create Payee',
      description: 'Create a new payee',
      inputSchema: {
        payeeName: z.string(),
        transferAccountId: z.string().nullish()
      }
    },
    async args => {
      // const id = await actualClient.createPayee(args.payeeName, args.transferAccountId);
      // return { content: [{ type: 'text', text: `Created payee ${id}` }] };
      return { content: [{ type: 'text', text: 'Only READ operations are supported currently. Your request was not processed.' }] };
    }
  );

  // Update Payee
  server.registerTool(
    'update-payee',
    {
      title: 'Update Payee',
      description: 'Update an existing payee',
      inputSchema: {
        payeeId: z.string(),
        newName: z.string().nullish(),
        newTransferAccountId: z.string().nullish()
      }
    },
    async args => {
      // await actualClient.updatePayee(args.payeeId, {
      //     newName: args.newName,
      //     newTransferAccountId: args.newTransferAccountId
      // });
      // return { content: [{ type: 'text', text: `Updated payee ${args.payeeId}` }] };
      return { content: [{ type: 'text', text: 'Only READ operations are supported currently. Your request was not processed.' }] };
    }
  );

  // Delete Payee
  server.registerTool(
    'delete-payee',
    {
      title: 'Delete Payee',
      description: 'Delete a payee',
      inputSchema: { payeeId: z.string() }
    },
    async args => {
      // await actualClient.deletePayee(args.payeeId);
      // return { content: [{ type: 'text', text: `Deleted payee ${args.payeeId}` }] };
      return { content: [{ type: 'text', text: 'Only READ operations are supported currently. Your request was not processed.' }] };
    }
  );

  // Get Rules
  server.registerTool(
    'get-rules',
    { title: 'Get Rules', description: 'List transaction rules' },
    async () => {
      const rules = await actualClient.getRules();
      return { content: [{ type: 'text', text: JSON.stringify(rules, null, 2) }] };
    }
  );

  // Create Rule
  server.registerTool(
    'create-rule',
    {
      title: 'Create Rule',
      description: 'Create a transaction rule',
      inputSchema: {
        name: z.string().nullish(),
        conditions: z.record(z.string(), z.any()),
        actions: z.record(z.string(), z.any())
      }
    },
    async args => {
      // const created = await actualClient.createRule({
      //     id: '',
      //     name: args.name ?? undefined,
      //     conditions: args.conditions,
      //     actions: args.actions
      // });
      // return { content: [{ type: 'text', text: `Created rule ${created.id}` }] };
      return { content: [{ type: 'text', text: 'Only READ operations are supported currently. Your request was not processed.' }] };
    }
  );

  // Update Rule
  server.registerTool(
    'update-rule',
    {
      title: 'Update Rule',
      description: 'Update a transaction rule',
      inputSchema: {
        ruleId: z.string(),
        name: z.string().nullish(),
        conditions: z.record(z.string(), z.any()).nullish(),
        actions: z.record(z.string(), z.any()).nullish()
      }
    },
    async args => {
      // const updated = await actualClient.updateRule(args.ruleId, {
      //     name: args.name ?? undefined,
      //     conditions: args.conditions ?? undefined,
      //     actions: args.actions ?? undefined
      // });
      // return { content: [{ type: 'text', text: `Updated rule ${updated.id}` }] };
      return { content: [{ type: 'text', text: 'Only READ operations are supported currently. Your request was not processed.' }] };
    }
  );

  // Delete Rule
  server.registerTool(
    'delete-rule',
    {
      title: 'Delete Rule',
      description: 'Delete a transaction rule',
      inputSchema: { ruleId: z.string() }
    },
    async args => {
      // await actualClient.deleteRule(args.ruleId);
      // return { content: [{ type: 'text', text: `Deleted rule ${args.ruleId}` }] };
      return { content: [{ type: 'text', text: 'Only READ operations are supported currently. Your request was not processed.' }] };
    }
  );

  // Generate Financial Insights
  server.registerTool(
    'generate-financial-insights',
    { title: 'Generate Financial Insights', description: 'Summarize financial insights' },
    async () => {
      const insights = await actualClient.generateFinancialInsights();
      return { content: [{ type: 'text', text: insights }] };
    }
  );

  // Generate Budget Review
  server.registerTool(
    'generate-budget-review',
    {
      title: 'Generate Budget Review',
      description: 'Analyze budget performance for a given month',
      inputSchema: {
        year: z.number(),
        month: z.number().describe('1-12')
      }
    },
    async args => {
      const review = await actualClient.generateBudgetReview(args.year, args.month);
      return { content: [{ type: 'text', text: review }] };
    }
  );

  // Apply Budget Changes
  server.registerTool(
    'apply-budget-changes',
    {
      title: 'Apply Budget Changes',
      description: 'Flush local changes and sync the budget back to the Actual server'
    },
    async () => {
      // await actualClient.shutdown();
      // return { content: [{ type: 'text', text: 'Budget changes flushed and synced to the Actual server.' }] };
      return { content: [{ type: 'text', text: 'Only READ operations are supported currently. Your request was not processed.' }] };
    }
  );
};

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

  registerTools(server);
  return server;
};

const MCP_PORT_ENV = process.env.MCP_PORT;
const MCP_PORT = MCP_PORT_ENV !== undefined && MCP_PORT_ENV !== '' ? parseInt(MCP_PORT_ENV, 10) : 3000;
const app = createMcpExpressApp();

const transports = new Map<string, StreamableHTTPServerTransport>();

const mcpPostHandler = async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId !== undefined && sessionId !== '') {
    console.log(`Received MCP request for session: ${sessionId}`);
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
          console.log(`Session initialized with ID: ${sid}`);
          transports.set(sid, newTransport);
        }
      });

      newTransport.onclose = () => {
        const sid = newTransport.sessionId;
        if (sid !== undefined && sid !== '' && transports.has(sid)) {
          console.log(`Transport closed for session ${sid}, removing from transports map`);
          transports.delete(sid);
        }
      };

      const server = getServer();
      await server.connect(newTransport);
      await newTransport.handleRequest(req, res, req.body);
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null
      });
    }
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null
      });
    }
  }
};

app.post('/mcp', (req: Request, res: Response) => { void mcpPostHandler(req, res); });

const mcpGetHandler = async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId === undefined || sessionId === '' || !transports.has(sessionId)) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  const lastEventId = req.headers['last-event-id'] as string | undefined;
  if (lastEventId !== undefined && lastEventId !== '') {
    console.log(`Client reconnecting with Last-Event-ID: ${lastEventId}`);
  } else {
    console.log(`Establishing new SSE stream for session ${sessionId}`);
  }

  const transport = transports.get(sessionId);
  if (transport === undefined) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  await transport.handleRequest(req, res);
};

app.get('/mcp', (req: Request, res: Response) => { void mcpGetHandler(req, res); });

const mcpDeleteHandler = async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId === undefined || sessionId === '' || !transports.has(sessionId)) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  console.log(`Received session termination request for session ${sessionId}`);

  try {
    const transport = transports.get(sessionId);
    if (transport === undefined) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error('Error handling session termination:', error);
    if (!res.headersSent) {
      res.status(500).send('Error processing session termination');
    }
  }
};

app.delete('/mcp', (req: Request, res: Response) => { void mcpDeleteHandler(req, res); });

app.listen(MCP_PORT, (error?: Error) => {
  if (error != null) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
  console.log(`Actual Budget MCP Server listening on port ${MCP_PORT}`);
});

const gracefulShutdown = async (): Promise<void> => {
  console.log('Shutting down server...');
  for (const [sessionId, transport] of transports.entries()) {
    try {
      console.log(`Closing transport for session ${sessionId}`);
      await transport.close();
      transports.delete(sessionId);
    } catch (error) {
      console.error(`Error closing transport for session ${sessionId}:`, error);
    }
  }
  try {
    await actualClient.shutdown();
  } catch (error) {
    console.error('Error during Actual API shutdown:', error);
  }
  console.log('Server shutdown complete');
  process.exit(0);
};

process.on('SIGINT', () => { void gracefulShutdown(); });
process.on('SIGTERM', () => { void gracefulShutdown(); });
