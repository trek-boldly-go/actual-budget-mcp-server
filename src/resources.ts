import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { type ActualClient } from './actual/client.js';

/**
 * Registers read-only MCP resources and reusable prompt templates.
 * Resources here are lightweight snapshots for discovery (no side effects).
 */
export const registerResourcesAndPrompts = (server: McpServer, actualClient: ActualClient): void => {
  // Accounts snapshot (read-only)
  server.registerResource(
    'accounts',
    'actual://accounts',
    { mimeType: 'application/json', description: 'Current accounts snapshot (balances and metadata)' },
    async () => {
      const accounts = await actualClient.getAccounts();
      return {
        contents: [
          {
            uri: 'actual://accounts',
            mimeType: 'application/json',
            text: JSON.stringify(accounts, null, 2)
          }
        ]
      };
    }
  );

  // Categories snapshot
  server.registerResource(
    'categories',
    'actual://categories',
    { mimeType: 'application/json', description: 'Current categories and groups' },
    async () => {
      const categories = await actualClient.getCategories();
      return {
        contents: [
          {
            uri: 'actual://categories',
            mimeType: 'application/json',
            text: JSON.stringify(categories, null, 2)
          }
        ]
      };
    }
  );

  // Payees snapshot
  server.registerResource(
    'payees',
    'actual://payees',
    { mimeType: 'application/json', description: 'Current payees' },
    async () => {
      const payees = await actualClient.getPayees();
      return {
        contents: [
          {
            uri: 'actual://payees',
            mimeType: 'application/json',
            text: JSON.stringify(payees, null, 2)
          }
        ]
      };
    }
  );

  // Rules guide (static reference)
  server.registerResource(
    'rules-guide',
    'actual://rules/guide',
    { mimeType: 'text/plain', description: 'How to structure rules payloads for create/update-rule tools' },
    async () => ({
      contents: [
        {
          uri: 'actual://rules/guide',
          mimeType: 'text/plain',
          text: [
            'Rules are arrays of conditions and actions.',
            'Conditions: { field, op, value, options? } where field can be account, category, amount, date, notes, payee, imported_payee, saved, cleared, reconciled.',
            'Common ops: is, isNot, oneOf, notOneOf, contains, doesNotContain, matches; amount/date also support gt/gte/lt/lte/isbetween.',
            'Actions: set { field, value }, set-split-amount { value, options.method }, link-schedule { schedule }, prepend-notes { value }, append-notes { value }, delete-transaction { value }.',
            'Example payload (smallest currency unit amounts):',
            JSON.stringify({
              stage: 'post',
              conditionsOp: 'and',
              conditions: [
                { field: 'payee', op: 'contains', value: 'Coffee' },
                { field: 'amount', op: 'lt', value: 0 }
              ],
              actions: [
                { op: 'set', field: 'category', value: 'cat-id-here' },
                { op: 'prepend-notes', value: '[Coffee]' }
              ]
            }, null, 2),
            'Use the create-rule or update-rule tools with these structures. Amounts are in the currency\'s smallest unit (e.g., cents for USD).'
          ].join('\n')
        }
      ]
    })
  );

  // Prompt: Budget advisor
  server.registerPrompt(
    'budget-advisor',
    {
      description: 'Provide guidance using server tools and resources; remind that amounts are smallest currency units.',
      argsSchema: {
        month: z.number().int().min(1).max(12).nullish().describe('Optional month (1-12) to focus on'),
        year: z.number().int().nullish().describe('Optional year')
      }
    },
    async ({ month, year }) => {
      const monthPart = month != null && year != null
        ? `Focus on ${year}-${String(month).padStart(2, '0')}.`
        : 'Use the most recent month if none is provided.';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                'You are a budget advisor using the Actual MCP tools/resources.',
                'Amounts are in the currency\'s smallest unit (e.g., cents for USD).',
                monthPart,
                'Use these resources and tools as needed:',
                '- Resource actual://accounts for account context.',
                '- Resource actual://categories and actual://payees for names/IDs.',
                '- Tool get-monthly-summary (returns totals in smallest units).',
                '- Tool get-spending-by-category for top spending areas.',
                '- Resource actual://insights/latest for a quick baseline summary.',
                'Give concise advice and next steps.'
              ].join('\n')
            }
          }
        ]
      } satisfies { messages: Array<{ role: 'user', content: { type: 'text', text: string } }> };
    }
  );

  // Prompt: Categorization hygiene
  server.registerPrompt(
    'categorization-hygiene',
    {
      description: 'Guide the user to clean up uncategorized expenses.',
      argsSchema: {
        maxItems: z.number().int().positive().max(100).default(20).describe('Optional limit for examples to review')
      }
    },
    async ({ maxItems }) => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                'Help the user clean up uncategorized expenses.',
                'Amounts are in the currency\'s smallest unit (e.g., cents for USD).',
                'Steps:',
                `1) Call get-transactions with categoryId null/empty to fetch uncategorized expenses (limit to <=${maxItems}).`,
                '2) Group by likely payee or memo to suggest categories.',
                '3) Provide a short list of recommended categories or rules to apply.',
                '4) Keep responses concise and actionable.'
              ].join('\n')
            }
          }
        ]
      } satisfies { messages: Array<{ role: 'user', content: { type: 'text', text: string } }> };
    }
  );

  // Prompt: Spending summary
  server.registerPrompt(
    'spending-summary',
    {
      description: 'Summarize spending for a month in smallest currency units.',
      argsSchema: {
        year: z.number().int().describe('Year (e.g., 2025)'),
        month: z.number().int().min(1).max(12).describe('Month (1-12)')
      }
    },
    async ({ year, month }) => {
      const monthLabel = `${year}-${String(month).padStart(2, '0')}`;
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                `Provide a spending summary for ${monthLabel}.`,
                'Amounts are in the currency\'s smallest unit (e.g., cents for USD).',
                'Pull data using:',
                '- Tool get-monthly-summary (income, expenses, net savings).',
                '- Tool get-spending-by-category (top categories).',
                'Present totals clearly and keep the response brief.'
              ].join('\n')
            }
          }
        ]
      } satisfies { messages: Array<{ role: 'user', content: { type: 'text', text: string } }> };
    }
  );

  // Prompt: Rule builder
  server.registerPrompt(
    'rule-builder',
    {
      description: 'Guide the user/model to propose a transaction rule structure (no side effects).'
    },
    async () => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                'Help propose an Actual rule (no write yet).',
                'Ask the user/model for: payee pattern, amount filter, category to apply, note prefixes, and whether it should auto-apply.',
                'Construct a draft payload in the currency\'s smallest unit (e.g., cents for USD).',
                'Recommended shape (conditionsOp accepts "and" or "or"; example uses "and"):',
                JSON.stringify({
                  stage: 'post',
                  conditionsOp: 'and',
                  conditions: [
                    { field: 'payee', op: 'contains', value: 'Example' },
                    { field: 'amount', op: 'lt', value: 0 }
                  ],
                  actions: [
                    { op: 'set', field: 'category', value: 'category-id' },
                    { op: 'prepend-notes', value: '[Tag]' }
                  ]
                }, null, 2),
                'After drafting, suggest calling create-rule or update-rule with the payload.'
              ].join('\n')
            }
          }
        ]
      } satisfies { messages: Array<{ role: 'user', content: { type: 'text', text: string } }> };
    }
  );
};
