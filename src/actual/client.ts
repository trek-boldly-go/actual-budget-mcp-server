import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import {
  type BalanceEntry,
  type CategorySpending,
  type MonthlySummary
} from './types.js';
import api from '@actual-app/api';
import {
  type APIAccountEntity,
  type APICategoryEntity,
  type APICategoryGroupEntity,
  type APIPayeeEntity
} from '@actual-app/api/@types/loot-core/src/server/api-models.js';
import { type TransactionEntity } from '@actual-app/api/@types/loot-core/src/types/models/transaction.js';
import { type RuleEntity } from '@actual-app/api/@types/loot-core/src/types/models/rule.js';
import { logger } from '../logger.js';

const getLastFullMonthRange = (): { startDate: string, endDate: string, label: string, daysInMonth: number } => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));

  const toDate = (d: Date): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return {
    startDate: toDate(start),
    endDate: toDate(end),
    label: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
    daysInMonth: end.getUTCDate()
  };
};

export class ActualClient {
  private ready: Promise<void>;
  private shutdownPromise?: Promise<void>;
  private readonly initConfig: {
    serverURL: string
    password: string
    dataDir: string
    syncId: string
    encryptionPass?: string
  };

  constructor (config?: { serverURL?: string, password?: string, dataDir?: string, syncId?: string, encryptionPass?: string }) {
    const serverURL = config?.serverURL ?? process.env.ACTUAL_SERVER_URL ?? 'http://localhost:5006';
    const password = config?.password ?? process.env.ACTUAL_PASSWORD ?? '';
    const dataDir = config?.dataDir ?? process.env.ACTUAL_DATA_DIR ?? './.actual-data';
    const syncId = config?.syncId ?? process.env.ACTUAL_SYNC_ID ?? '';
    const encryptionPass = config?.encryptionPass ?? process.env.ACTUAL_ENCRYPTION_PASS ?? undefined;

    this.initConfig = { serverURL, password, dataDir, syncId, encryptionPass };
    this.ready = this.initActualApi(this.initConfig);
  }

  private async initActualApi (config: { serverURL: string, password: string, dataDir: string, syncId: string, encryptionPass?: string }): Promise<void> {
    const hasServerUrl = config.serverURL.trim() !== '';
    const hasPassword = config.password !== '';
    const hasSyncId = config.syncId !== '';
    if (!hasServerUrl || !hasPassword || !hasSyncId) {
      throw new Error('Actual API init failed: ACTUAL_SERVER_URL, ACTUAL_PASSWORD, and ACTUAL_SYNC_ID are required');
    }
    await mkdir(config.dataDir, { recursive: true });
    await api.init({
      dataDir: config.dataDir,
      serverURL: config.serverURL,
      password: config.password
    });
    logger.info('Connected to Actual server', { serverURL: config.serverURL });

    if (config.syncId !== '') {
      await api.downloadBudget(config.syncId, {
        password: config.password
      });
      logger.info('Budget file downloaded', { dataDir: config.dataDir });
    }
  }

  private async ensureReady (): Promise<void> {
    await this.ready;
  }

  async shutdown (): Promise<void> {
    if (this.shutdownPromise != null) {
      await this.shutdownPromise;
      return;
    }
    this.shutdownPromise = (async () => {
      await this.ensureReady();
      try {
        await api.shutdown();
        logger.info('Actual API shutdown complete (budget flushed)');
      } catch (error) {
        logger.error('Failed to shutdown Actual API cleanly', { error: String(error) });
      }
      // Reset ready so the next operation reinitializes and re-downloads the budget as needed.
      this.ready = this.initActualApi(this.initConfig);
      this.shutdownPromise = undefined;
    })();
    await this.shutdownPromise;
  }

  async getAccounts (): Promise<APIAccountEntity[]> {
    await this.ensureReady();
    return await api.getAccounts();
  }

  async getTransactions (filters: {
    accountId?: string | null
    accountIds?: string[] | null
    startDate: string
    endDate: string
    minAmount?: number | null
    maxAmount?: number | null
    categoryId?: string | null
    payeeId?: string | null
  }): Promise<TransactionEntity[]> {
    await this.ensureReady();

    const targetAccountIds: string[] =
      filters.accountIds?.filter(Boolean) ??
      (filters.accountId !== undefined && filters.accountId !== null && filters.accountId !== '' ? [filters.accountId] : []);

    const accountsToQuery =
      targetAccountIds.length > 0
        ? targetAccountIds
        : (await api.getAccounts()).map(a => a.id);

    const batches = await Promise.all(
      accountsToQuery.map(async acctId => await api.getTransactions(acctId, filters.startDate, filters.endDate))
    );

    return batches.flat().filter(txn => {
      if (filters.minAmount !== undefined && filters.minAmount !== null && txn.amount < filters.minAmount) return false;
      if (filters.maxAmount !== undefined && filters.maxAmount !== null && txn.amount > filters.maxAmount) return false;
      if (filters.categoryId !== undefined && filters.categoryId !== null && filters.categoryId !== '' && txn.category !== filters.categoryId) return false;
      if (filters.payeeId !== undefined && filters.payeeId !== null && filters.payeeId !== '' && txn.payee !== filters.payeeId) return false;
      return true;
    });
  }

  async addTransaction (input: {
    accountId: string
    date: string
    amount: number
    payeeId?: string | null
    payeeName?: string | null
    importedId?: string | null
    importedPayee?: string | null
    categoryId?: string | null
    notes?: string | null
    cleared?: boolean | null
    subtransactions?: Array<{
      amount: number
      categoryId?: string | null
      notes?: string | null
    }>
  }): Promise<{ importedId: string, transactionId: string }> {
    await this.ensureReady();
    const importedId = input.importedId ?? randomUUID();
    const payload = {
      date: input.date,
      amount: input.amount,
      payee: input.payeeId ?? undefined,
      payee_name: input.payeeId === undefined || input.payeeId === null ? input.payeeName ?? undefined : undefined,
      category: input.categoryId ?? undefined,
      notes: input.notes ?? undefined,
      imported_id: importedId,
      imported_payee: input.importedPayee ?? undefined,
      cleared: input.cleared ?? undefined,
      subtransactions: input.subtransactions?.map(st => ({
        amount: st.amount,
        category: st.categoryId ?? undefined,
        notes: st.notes ?? undefined
      }))
    };
    await api.addTransactions(input.accountId, [payload]);
    // Find the transaction we just created so callers can delete it later.
    const created = (await api.getTransactions(input.accountId, input.date, input.date))
      .find(txn => txn.imported_id === importedId);
    return { importedId, transactionId: created?.id ?? importedId };
  }

  async updateTransaction (transactionId: string, updatedFields: Partial<TransactionEntity>): Promise<boolean> {
    await this.ensureReady();
    const payload: Partial<TransactionEntity> = {
      amount: updatedFields.amount,
      date: updatedFields.date,
      payee: updatedFields.payee ?? undefined,
      category: updatedFields.category ?? undefined,
      notes: updatedFields.notes ?? undefined,
      cleared: (updatedFields as any).cleared ?? undefined,
      reconciled: (updatedFields as any).reconciled ?? undefined
    };
    await api.updateTransaction(transactionId, payload);
    return true;
  }

  async deleteTransaction (transactionId: string): Promise<boolean> {
    await this.ensureReady();
    await api.deleteTransaction(transactionId);
    return true;
  }

  async getBalanceHistory (accountId: string, startDate: string, endDate: string): Promise<BalanceEntry[]> {
    await this.ensureReady();
    const cutoffDate = new Date(startDate);
    const starting = await api.getAccountBalance(accountId, cutoffDate);
    const sorted = (await this.getTransactions({ accountId, startDate, endDate })).sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    const entries: BalanceEntry[] = [];
    let running = starting;
    for (const txn of sorted) {
      running += txn.amount;
      entries.push({ date: txn.date, balance: running });
    }
    return entries;
  }

  async getSpendingByCategory (startDate: string, endDate: string): Promise<CategorySpending[]> {
    await this.ensureReady();
    const accounts = await this.getAccounts();
    const txnBatches = await Promise.all(
      accounts.map(async acct => await this.getTransactions({ accountId: acct.id, startDate, endDate }))
    );
    const txns = txnBatches.flat();
    const spending = new Map<string, number>();
    const categories = (await api.getCategories()).filter((c): c is APICategoryEntity => 'group_id' in c);
    for (const txn of txns) {
      if (txn.category == null || txn.category === '') continue;
      if (txn.amount >= 0) continue; // expenses only
      spending.set(txn.category, (spending.get(txn.category) ?? 0) + Math.abs(txn.amount));
    }
    return [...spending.entries()].map(([categoryId, total]) => ({
      categoryId,
      categoryName: categories.find(c => c.id === categoryId)?.name ?? 'Unknown',
      total
    }));
  }

  async getMonthlySummary (year: number, month: number): Promise<MonthlySummary> {
    await this.ensureReady();
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDateObj = new Date(year, month, 0); // last day of month
    const endDate = `${endDateObj.getFullYear()}-${String(endDateObj.getMonth() + 1).padStart(2, '0')}-${String(endDateObj.getDate()).padStart(2, '0')}`;

    const accounts = await this.getAccounts();
    const txnBatches = await Promise.all(
      accounts.map(async acct => await this.getTransactions({ accountId: acct.id, startDate, endDate }))
    );
    const txns = txnBatches.flat();

    const income = txns.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    const expenses = txns.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const netSavings = income - expenses;
    return {
      totalIncome: income,
      totalExpenses: expenses,
      netSavings,
      savingsRate: income > 0 ? netSavings / income : 0
    };
  }

  async getCategories (): Promise<Awaited<ReturnType<typeof api.getCategories>>> {
    await this.ensureReady();
    return await api.getCategories();
  }

  async createCategory (groupId: string, categoryName: string): Promise<string> {
    await this.ensureReady();
    return await api.createCategory({
      name: categoryName,
      group_id: groupId,
      is_income: false,
      hidden: false
    });
  }

  async updateCategory (categoryId: string, update: { newName?: string | null, newGroupId?: string | null }): Promise<boolean> {
    await this.ensureReady();
    const fields: Partial<APICategoryEntity> = {};
    if (update.newName !== undefined && update.newName !== null) fields.name = update.newName;
    if (update.newGroupId !== undefined && update.newGroupId !== null) (fields as unknown as { group_id: string }).group_id = update.newGroupId;
    await api.updateCategory(categoryId, fields);
    return true;
  }

  async deleteCategory (categoryId: string, transferCategoryId?: string | null): Promise<boolean> {
    await this.ensureReady();
    await api.deleteCategory(categoryId, transferCategoryId ?? undefined);
    return true;
  }

  async getGroupedCategories (): Promise<APICategoryGroupEntity[]> {
    await this.ensureReady();
    return await api.getCategoryGroups();
  }

  async createCategoryGroup (groupName: string, isIncomeGroup: boolean): Promise<string> {
    await this.ensureReady();
    return await api.createCategoryGroup({
      name: groupName,
      is_income: isIncomeGroup,
      hidden: false
    });
  }

  async updateCategoryGroup (groupId: string, newName: string): Promise<boolean> {
    await this.ensureReady();
    await api.updateCategoryGroup(groupId, { name: newName });
    return true;
  }

  async deleteCategoryGroup (groupId: string, transferCategoryId?: string | null): Promise<boolean> {
    await this.ensureReady();
    await api.deleteCategoryGroup(groupId, transferCategoryId ?? undefined);
    return true;
  }

  async getPayees (): Promise<APIPayeeEntity[]> {
    await this.ensureReady();
    return await api.getPayees();
  }

  async createPayee (payeeName: string, transferAccountId?: string | null): Promise<string> {
    await this.ensureReady();
    return await api.createPayee({ name: payeeName, transfer_acct: transferAccountId ?? undefined });
  }

  async updatePayee (payeeId: string, update: { newName?: string | null, newTransferAccountId?: string | null }): Promise<boolean> {
    await this.ensureReady();
    await api.updatePayee(payeeId, {
      name: update.newName ?? undefined,
      transfer_acct: update.newTransferAccountId ?? undefined
    });
    return true;
  }

  async deletePayee (payeeId: string): Promise<boolean> {
    await this.ensureReady();
    await api.deletePayee(payeeId);
    return true;
  }

  async getRules (): Promise<RuleEntity[]> {
    await this.ensureReady();
    return await api.getRules();
  }

  async createRule (rule: Omit<RuleEntity, 'id'>): Promise<RuleEntity> {
    await this.ensureReady();
    const payload: Omit<RuleEntity, 'id'> = {
      stage: rule.stage ?? null,
      conditionsOp: rule.conditionsOp ?? 'and',
      conditions: rule.conditions ?? [],
      actions: rule.actions ?? []
    };
    const created = await api.createRule(payload);
    return created;
  }

  async updateRule (ruleId: string, updatedFields: Partial<RuleEntity>): Promise<RuleEntity> {
    await this.ensureReady();
    const allRules = await api.getRules();
    const base: RuleEntity = allRules.find(r => r.id === ruleId) ?? {
      id: ruleId,
      stage: null,
      conditionsOp: 'and',
      conditions: [],
      actions: []
    };

    const payload: RuleEntity = {
      id: ruleId,
      stage: updatedFields.stage ?? base.stage ?? null,
      conditionsOp: updatedFields.conditionsOp ?? base.conditionsOp ?? 'and',
      conditions: updatedFields.conditions ?? base.conditions ?? [],
      actions: updatedFields.actions ?? base.actions ?? []
    };

    const updated = await api.updateRule(payload);
    return updated;
  }

  async deleteRule (ruleId: string): Promise<boolean> {
    await this.ensureReady();
    await api.deleteRule(ruleId);
    return true;
  }

  async generateFinancialInsights (): Promise<string> {
    await this.ensureReady();
    const { startDate, endDate, label, daysInMonth } = getLastFullMonthRange();
    const txns = await this.getTransactions({ startDate, endDate });

    const income = txns.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    const expenses = txns.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const net = income - expenses;
    const savingsRate = income > 0 ? net / income : 0;
    const avgDailySpend = Math.round(expenses / daysInMonth);

    const categories = (await api.getCategories()).filter((c): c is APICategoryEntity => 'group_id' in c);
    const categorySpend = new Map<string, number>();
    for (const txn of txns) {
      if (txn.amount >= 0) continue;
      if (txn.category == null || txn.category === '') continue;
      categorySpend.set(txn.category, (categorySpend.get(txn.category) ?? 0) + Math.abs(txn.amount));
    }
    const topCategories = [...categorySpend.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([categoryId, total]) => `${categories.find(c => c.id === categoryId)?.name ?? 'Unknown'}: ${total}`);

    const uncategorized = txns.filter(t => t.amount < 0 && (t.category == null || t.category === ''));
    const uncategorizedTotal = uncategorized.reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const lines = [
      `Period: ${label} (${startDate} to ${endDate})`,
      'Amounts are shown in the currency\'s smallest unit (e.g., if USD then values are in cents, not dollars).',
      `Income: ${income}, Expenses: ${expenses}, Net savings: ${net} (Savings rate: ${(savingsRate * 100).toFixed(1)}%)`,
      `Average daily spend: ${avgDailySpend}`,
      topCategories.length > 0 ? `Top spending categories: ${topCategories.join('; ')}` : 'Top spending categories: none found',
      uncategorized.length > 0
        ? `Hygiene: ${uncategorized.length} uncategorized transactions totaling ${uncategorizedTotal}`
        : 'Hygiene: no uncategorized transactions'
    ];

    // const suggestions: string[] = [];
    // if (uncategorized.length > 0) suggestions.push('Categorize remaining uncategorized expenses to keep reports accurate');
    // if (topCategories.length > 0) suggestions.push('Review top spending categories for quick wins (e.g., trim 5-10%)');
    // if (savingsRate < 0.1) suggestions.push('Savings rate is low; consider a fixed transfer to savings right after payday');
    // if (suggestions.length === 0) suggestions.push('Spending hygiene looks good; maintain current habits');

    // lines.push(`Suggestions: ${suggestions.join('; ')}`);
    return lines.join('\n');
  }

  async generateBudgetReview (year: number, month: number): Promise<string> {
    await this.ensureReady();
    const summary = await this.getMonthlySummary(year, month);
    const monthLabel = `${year}-${String(month).padStart(2, '0')}`;
    return [
      `Review ${monthLabel} (amounts are in the currency's smallest unit; e.g., cents for USD):`,
      `Income: ${summary.totalIncome}, Expenses: ${summary.totalExpenses}, Savings: ${summary.netSavings}`
    ].join(' ');
  }
}

export const createActualClient = (): ActualClient => {
  return new ActualClient();
};
