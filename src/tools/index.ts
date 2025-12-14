import * as z from 'zod/v4';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { type ActualClient } from '../actual/client.js';
import { logger } from '../logger.js';
import { amountSchema, dateSchema, nonEmptyString, RuleActionSchema, RuleConditionSchema } from '../schemas/common.js';

const isDuplicateEntityError = (error: unknown): boolean => {
  const message = String(error ?? '').toLowerCase();
  return message.includes('already exists');
};

export const registerTools = (server: McpServer, actualClient: ActualClient): void => {
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
        accountId: nonEmptyString.nullish().describe('Account ID to filter (optional)'),
        accountIds: z.array(nonEmptyString).min(1).nullish().describe('Account IDs to filter (optional, overrides accountId)'),
        startDate: dateSchema.describe('Start date YYYY-MM-DD'),
        endDate: dateSchema.describe('End date YYYY-MM-DD'),
        minAmount: amountSchema.nullish().describe('Minimum amount (positive=income, negative=expense)'),
        maxAmount: amountSchema.nullish().describe('Maximum amount'),
        categoryId: nonEmptyString.nullish().describe('Category ID to filter'),
        payeeId: nonEmptyString.nullish().describe('Payee ID to filter')
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
        accountId: nonEmptyString,
        date: dateSchema.describe('YYYY-MM-DD'),
        amount: amountSchema.describe('Integer amount in smallest currency unit (e.g., $1.23 -> 123). Positive=income, negative=expense'),
        payeeId: nonEmptyString.nullish(),
        payeeName: nonEmptyString.nullish().describe('Used only if payeeId is not provided'),
        categoryId: nonEmptyString.nullish(),
        notes: z.string().nullish(),
        importedId: nonEmptyString.nullish().describe('Optional imported_id to dedupe'),
        importedPayee: nonEmptyString.nullish(),
        cleared: z.boolean().nullish(),
        subtransactions: z.array(z.object({
          amount: amountSchema,
          categoryId: nonEmptyString.nullish(),
          notes: z.string().nullish()
        })).optional()
      }
    },
    async args => {
      const { transactionId, importedId } = await actualClient.addTransaction(args);
      return { content: [{ type: 'text', text: `Created transaction ${transactionId} (imported_id ${importedId})` }] };
    }
  );

  // Update Transaction
  server.registerTool(
    'update-transaction',
    {
      title: 'Update Transaction',
      description: 'Update an existing transaction',
      inputSchema: {
        transactionId: nonEmptyString,
        amount: amountSchema.nullish(),
        date: dateSchema.nullish(),
        payeeId: nonEmptyString.nullish(),
        categoryId: nonEmptyString.nullish(),
        notes: z.string().nullish(),
        cleared: z.boolean().nullish(),
        reconciled: z.boolean().nullish()
      }
    },
    async ({ transactionId, ...updated }) => {
      const sanitized = {
        amount: updated.amount ?? undefined,
        date: updated.date ?? undefined,
        payeeId: updated.payeeId ?? undefined,
        categoryId: updated.categoryId ?? undefined,
        notes: updated.notes ?? undefined,
        cleared: updated.cleared ?? undefined,
        reconciled: updated.reconciled ?? undefined
      };
      await actualClient.updateTransaction(transactionId, sanitized);
      return { content: [{ type: 'text', text: `Updated transaction ${transactionId}` }] };
    }
  );

  // Delete Transaction
  server.registerTool(
    'delete-transaction',
    {
      title: 'Delete Transaction',
      description: 'Remove a transaction',
      inputSchema: { transactionId: nonEmptyString }
    },
    async ({ transactionId }) => {
      await actualClient.deleteTransaction(transactionId);
      return { content: [{ type: 'text', text: `Deleted transaction ${transactionId}` }] };
    }
  );

  // Get Balance History
  server.registerTool(
    'get-balance-history',
    {
      title: 'Get Balance History',
      description: 'Compute balance history for an account over a date range',
      inputSchema: {
        accountId: nonEmptyString,
        startDate: dateSchema.describe('YYYY-MM-DD'),
        endDate: dateSchema.describe('YYYY-MM-DD')
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
        startDate: dateSchema,
        endDate: dateSchema
      }
    },
    async args => {
      const breakdown = await actualClient.getSpendingByCategory(args.startDate, args.endDate);
      return { content: [{ type: 'text', text: JSON.stringify(breakdown, null, 2) }] };
    }
  );

  // Get Grouped Categories
  server.registerTool(
    'get-category-groups',
    {
      title: 'Get Category Groups',
      description: 'Retrieve categories grouped by category group'
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
        groupId: nonEmptyString,
        categoryName: nonEmptyString,
        isIncome: z.boolean().nullish().describe('Optional; defaults to false'),
        hidden: z.boolean().nullish().describe('Optional; defaults to false')
      }
    },
    async args => {
      try {
        const id = await actualClient.createCategory(args.groupId, args.categoryName);
        return { content: [{ type: 'text', text: `Created category ${id}` }] };
      } catch (error) {
        logger.warn('Create category failed', { error: String(error) });
        if (isDuplicateEntityError(error)) {
          return { content: [{ type: 'text', text: `Category "${args.categoryName}" already exists in group ${args.groupId}` }], isError: false };
        }
        throw error;
      }
    }
  );

  // Update Category
  server.registerTool(
    'update-category',
    {
      title: 'Update Category',
      description: 'Rename or move a category',
      inputSchema: {
        categoryId: nonEmptyString,
        newName: nonEmptyString.nullish(),
        newGroupId: nonEmptyString.nullish()
      }
    },
    async args => {
      await actualClient.updateCategory(args.categoryId, { newName: args.newName, newGroupId: args.newGroupId });
      return { content: [{ type: 'text', text: `Updated category ${args.categoryId}` }] };
    }
  );

  // Delete Category
  server.registerTool(
    'delete-category',
    {
      title: 'Delete Category',
      description: 'Delete a category',
      inputSchema: {
        categoryId: nonEmptyString,
        transferCategoryId: nonEmptyString.nullish().describe('Optional category to transfer remaining amounts into')
      }
    },
    async args => {
      await actualClient.deleteCategory(args.categoryId, args.transferCategoryId ?? undefined);
      return { content: [{ type: 'text', text: `Deleted category ${args.categoryId}` }] };
    }
  );

  // Create Category Group
  server.registerTool(
    'create-category-group',
    {
      title: 'Create Category Group',
      description: 'Create a new category group',
      inputSchema: {
        groupName: nonEmptyString,
        isIncomeGroup: z.boolean().default(false),
        hidden: z.boolean().nullish().describe('Optional; defaults to false')
      }
    },
    async args => {
      try {
        const id = await actualClient.createCategoryGroup(args.groupName, args.isIncomeGroup);
        return { content: [{ type: 'text', text: `Created category group ${id}` }] };
      } catch (error) {
        logger.warn('Create category group failed', { error: String(error) });
        if (isDuplicateEntityError(error)) {
          return { content: [{ type: 'text', text: `Category group "${args.groupName}" already exists` }], isError: false };
        }
        throw error;
      }
    }
  );

  // Update Category Group
  server.registerTool(
    'update-category-group',
    {
      title: 'Update Category Group',
      description: 'Update a category group name',
      inputSchema: {
        groupId: nonEmptyString,
        newName: nonEmptyString
      }
    },
    async args => {
      await actualClient.updateCategoryGroup(args.groupId, args.newName);
      return { content: [{ type: 'text', text: `Updated category group ${args.groupId}` }] };
    }
  );

  // Delete Category Group
  server.registerTool(
    'delete-category-group',
    {
      title: 'Delete Category Group',
      description: 'Delete a category group',
      inputSchema: {
        groupId: nonEmptyString,
        transferCategoryId: nonEmptyString.nullish().describe('Optional category to transfer remaining amounts into')
      }
    },
    async args => {
      await actualClient.deleteCategoryGroup(args.groupId, args.transferCategoryId ?? undefined);
      return { content: [{ type: 'text', text: `Deleted category group ${args.groupId}` }] };
    }
  );

  // Create Payee
  server.registerTool(
    'create-payee',
    {
      title: 'Create Payee',
      description: 'Create a new payee',
      inputSchema: {
        payeeName: nonEmptyString,
        transferAccountId: nonEmptyString.nullish().describe('Optional transfer account ID')
      }
    },
    async args => {
      const id = await actualClient.createPayee(args.payeeName, args.transferAccountId);
      return { content: [{ type: 'text', text: `Created payee ${id}` }] };
    }
  );

  // Update Payee
  server.registerTool(
    'update-payee',
    {
      title: 'Update Payee',
      description: 'Update an existing payee',
      inputSchema: {
        payeeId: nonEmptyString,
        newName: nonEmptyString.nullish(),
        newTransferAccountId: nonEmptyString.nullish().describe('Optional transfer account ID')
      }
    },
    async args => {
      await actualClient.updatePayee(args.payeeId, {
        newName: args.newName,
        newTransferAccountId: args.newTransferAccountId
      });
      return { content: [{ type: 'text', text: `Updated payee ${args.payeeId}` }] };
    }
  );

  // Delete Payee
  server.registerTool(
    'delete-payee',
    {
      title: 'Delete Payee',
      description: 'Delete a payee',
      inputSchema: { payeeId: nonEmptyString }
    },
    async args => {
      await actualClient.deletePayee(args.payeeId);
      return { content: [{ type: 'text', text: `Deleted payee ${args.payeeId}` }] };
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
        stage: z.enum(['pre', 'post']).nullish().describe('When to run the rule (pre/post)'),
        conditionsOp: z.enum(['and', 'or']).default('and'),
        conditions: z.array(RuleConditionSchema).describe('Rule conditions; see Actual rule schema'),
        actions: z.array(RuleActionSchema).describe('Rule actions; see Actual rule schema')
      }
    },
    async args => {
      const created = await actualClient.createRule({
        stage: args.stage ?? null,
        conditionsOp: args.conditionsOp ?? 'and',
        conditions: args.conditions,
        actions: args.actions
      });
      return { content: [{ type: 'text', text: `Created rule ${created.id}` }] };
    }
  );

  // Update Rule
  server.registerTool(
    'update-rule',
    {
      title: 'Update Rule',
      description: 'Update a transaction rule',
      inputSchema: {
        ruleId: nonEmptyString,
        stage: z.enum(['pre', 'post']).nullish(),
        conditionsOp: z.enum(['and', 'or']).nullish(),
        conditions: z.array(RuleConditionSchema).nullish(),
        actions: z.array(RuleActionSchema).nullish()
      }
    },
    async args => {
      const updated = await actualClient.updateRule(args.ruleId, {
        stage: args.stage ?? undefined,
        conditionsOp: args.conditionsOp ?? undefined,
        conditions: args.conditions ?? undefined,
        actions: args.actions ?? undefined
      });
      return { content: [{ type: 'text', text: `Updated rule ${updated.id}` }] };
    }
  );

  // Delete Rule
  server.registerTool(
    'delete-rule',
    {
      title: 'Delete Rule',
      description: 'Delete a transaction rule',
      inputSchema: { ruleId: nonEmptyString }
    },
    async args => {
      await actualClient.deleteRule(args.ruleId);
      return { content: [{ type: 'text', text: `Deleted rule ${args.ruleId}` }] };
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

  // Get Monthly Summary
  server.registerTool(
    'get-monthly-summary',
    {
      title: 'Get Monthly Summary',
      description: 'Get income/expense/savings summary for a month',
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

  // Apply Budget Changes
  server.registerTool(
    'apply-budget-changes',
    {
      title: 'Apply Budget Changes',
      description: 'Flush local changes and sync the budget back to the Actual server'
    },
    async () => {
      await actualClient.shutdown();
      return { content: [{ type: 'text', text: 'Budget changes flushed and synced to the Actual server.' }] };
    }
  );
};
