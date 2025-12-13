import * as z from 'zod/v4';
import { type RecurConfig, type ScheduleEntity } from '@actual-app/api/@types/loot-core/src/types/models/schedule.js';
import { type RuleActionEntity, type RuleConditionEntity } from '@actual-app/api/@types/loot-core/src/types/models/rule.js';

export const nonEmptyString = z.string().trim().min(1);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be YYYY-MM-DD' });
export const amountSchema = z.number().int();

export const numberRangeSchema = z.object({
  num1: z.number(),
  num2: z.number()
}).describe('Numeric range { num1, num2 }');

export const conditionOptionsSchema = z.object({
  inflow: z.boolean().optional(),
  outflow: z.boolean().optional(),
  month: z.boolean().optional(),
  year: z.boolean().optional()
}).partial().describe('Optional condition flags');

export const recurConfigSchema: z.ZodType<RecurConfig> = z.custom<RecurConfig>((val): val is RecurConfig => {
  if (val === null || typeof val !== 'object') return false;
  const obj = val as Record<string, unknown>;
  if (typeof obj.frequency !== 'string' || typeof obj.start !== 'string') return false;
  return true;
}, { message: 'Invalid recurrence config (requires frequency and start)' });

const ruleConditionSchema = z.discriminatedUnion('field', [
  z.object({
    field: z.literal('account'),
    op: z.enum(['is', 'isNot', 'oneOf', 'notOneOf', 'contains', 'doesNotContain', 'matches', 'onBudget', 'offBudget']),
    value: z.union([
      z.string(),
      z.array(z.string()),
      z.string()
    ]),
    options: conditionOptionsSchema.optional()
  }),
  z.object({
    field: z.literal('category'),
    op: z.enum(['is', 'isNot', 'oneOf', 'notOneOf', 'contains', 'doesNotContain', 'matches']),
    value: z.union([z.string(), z.array(z.string())]),
    options: conditionOptionsSchema.optional()
  }),
  z.object({
    field: z.literal('amount'),
    op: z.enum(['is', 'isapprox', 'isbetween', 'gt', 'gte', 'lt', 'lte']),
    value: z.union([z.number(), numberRangeSchema])
  }),
  z.object({
    field: z.literal('date'),
    op: z.enum(['is', 'isapprox', 'isbetween', 'gt', 'gte', 'lt', 'lte']),
    value: z.union([dateSchema, numberRangeSchema, recurConfigSchema]),
    options: conditionOptionsSchema.optional()
  }),
  z.object({
    field: z.literal('notes'),
    op: z.enum(['is', 'isNot', 'oneOf', 'notOneOf', 'contains', 'doesNotContain', 'matches', 'hasTags']),
    value: z.union([z.string(), z.array(z.string())]),
    options: conditionOptionsSchema.optional()
  }),
  z.object({
    field: z.literal('payee'),
    op: z.enum(['is', 'isNot', 'oneOf', 'notOneOf', 'contains', 'doesNotContain', 'matches']),
    value: z.union([z.string(), z.array(z.string())]),
    options: conditionOptionsSchema.optional()
  }),
  z.object({
    field: z.literal('imported_payee'),
    op: z.enum(['is', 'isNot', 'oneOf', 'notOneOf', 'contains', 'doesNotContain', 'matches']),
    value: z.union([z.string(), z.array(z.string())]),
    options: conditionOptionsSchema.optional()
  }),
  z.object({
    field: z.literal('saved'),
    op: z.literal('is'),
    value: z.string(),
    options: conditionOptionsSchema.optional()
  }),
  z.object({
    field: z.enum(['cleared', 'reconciled']),
    op: z.literal('is'),
    value: z.boolean(),
    options: conditionOptionsSchema.optional()
  })
]) satisfies z.ZodType<RuleConditionEntity>;

const setRuleActionSchema = z.object({
  op: z.literal('set'),
  field: z.string(),
  value: z.unknown(),
  options: z.object({
    template: z.string().optional(),
    formula: z.string().optional(),
    splitIndex: z.number().optional()
  }).partial().optional(),
  type: z.string().optional()
});

const setSplitAmountRuleActionSchema = z.object({
  op: z.literal('set-split-amount'),
  value: z.number(),
  options: z.object({
    splitIndex: z.number().optional(),
    method: z.enum(['fixed-amount', 'fixed-percent', 'remainder'])
  }).optional()
});

const linkScheduleRuleActionSchema = z.object({
  op: z.literal('link-schedule'),
  value: z.custom<ScheduleEntity>((val): val is ScheduleEntity => {
    if (val === null || typeof val !== 'object') return false;
    const obj = val as Record<string, unknown>;
    return typeof obj.id === 'string' && typeof obj.rule === 'string' && typeof obj.next_date === 'string';
  }, { message: 'Invalid schedule entity (requires id, rule, next_date)' })
});

const prependNoteRuleActionSchema = z.object({
  op: z.literal('prepend-notes'),
  value: z.string()
});

const appendNoteRuleActionSchema = z.object({
  op: z.literal('append-notes'),
  value: z.string()
});

const deleteTransactionRuleActionSchema = z.object({
  op: z.literal('delete-transaction'),
  value: z.string()
});

const ruleActionSchema = z.union([
  setRuleActionSchema,
  setSplitAmountRuleActionSchema,
  linkScheduleRuleActionSchema,
  prependNoteRuleActionSchema,
  appendNoteRuleActionSchema,
  deleteTransactionRuleActionSchema
]);

export const RuleConditionSchema = ruleConditionSchema as unknown as z.ZodType<RuleConditionEntity>;
export const RuleActionSchema = ruleActionSchema as unknown as z.ZodType<RuleActionEntity>;
