import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import {
  type Account,
  type BalanceEntry,
  type Category,
  type CategoryGroup,
  type CategorySpending,
  type MonthlySummary,
  type Payee,
  type Rule,
  type Transaction
} from './types.js';
import api from '@actual-app/api';
import { type APIAccountEntity, type APICategoryGroupEntity, type APIPayeeEntity } from '@actual-app/api/@types/loot-core/src/server/api-models.js';
import { type TransactionEntity } from '@actual-app/api/@types/loot-core/src/types/models/transaction.js';
import { type RuleEntity } from '@actual-app/api/@types/loot-core/src/types/models/rule.js';

/**
 * Minimal in-memory stub of the Actual Budget API.
 * Replace the body of these methods with real calls to the Actual API/SDK.
 */
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

  private readonly accounts: Account[] = [
    { id: 'acct-1', name: 'Checking', balance: 125000 }, // cents
    { id: 'acct-2', name: 'Savings', balance: 502340 }
  ];

  private categories: Category[] = [
    { id: 'cat-1', name: 'Groceries', groupId: 'grp-1' },
    { id: 'cat-2', name: 'Rent', groupId: 'grp-1' },
    { id: 'cat-3', name: 'Salary', groupId: 'grp-2' }
  ];

  private categoryGroups: CategoryGroup[] = [
    { id: 'grp-1', name: 'Expenses', isIncomeGroup: false },
    { id: 'grp-2', name: 'Income', isIncomeGroup: true }
  ];

  private payees: Payee[] = [
    { id: 'payee-1', name: 'Supermarket' },
    { id: 'payee-2', name: 'Landlord' },
    { id: 'payee-3', name: 'Employer' }
  ];

  private rules: Rule[] = [];

  private transactions: Transaction[] = [
    {
      id: 'txn-1',
      accountId: 'acct-1',
      date: '2025-12-01',
      amount: -7500,
      payeeId: 'payee-1',
      categoryId: 'cat-1',
      notes: 'Groceries'
    },
    {
      id: 'txn-2',
      accountId: 'acct-1',
      date: '2025-12-02',
      amount: -20000,
      payeeId: 'payee-2',
      categoryId: 'cat-2',
      notes: 'Rent'
    },
    {
      id: 'txn-3',
      accountId: 'acct-1',
      date: '2025-12-03',
      amount: 500000,
      payeeId: 'payee-3',
      categoryId: 'cat-3',
      notes: 'Salary'
    }
  ];

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
      console.warn('Actual API init skipped: ACTUAL_SERVER_URL, ACTUAL_PASSWORD, or ACTUAL_SYNC_ID not set.');
      return;
    }
    try {
      await mkdir(config.dataDir, { recursive: true });
      await api.init({
        dataDir: config.dataDir,
        serverURL: config.serverURL,
        password: config.password
      });
      console.log('Connected to Actual server at', config.serverURL);

      if (config.syncId !== '') {
        try {
          await api.downloadBudget(config.syncId, {
            password: config.password
          });
          console.log('Budget file downloaded to', config.dataDir);
        } catch (err) {
          console.error('Download budget failed; continuing with stub/local data:', err);
        }
      }
    } catch (error) {
      console.error('Failed to initialize Actual API. Falling back to in-memory stub.', error);
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
        console.log('Actual API shutdown complete (budget flushed).');
      } catch (error) {
        console.error('Failed to shutdown Actual API cleanly:', error);
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
    accountId: string
    startDate: string
    endDate: string
    minAmount?: number | null
    maxAmount?: number | null
    categoryId?: string | null
    payeeId?: string | null
  }): Promise<TransactionEntity[]> {
    await this.ensureReady();

    return (await api.getTransactions(filters.accountId, filters.startDate, filters.endDate)).filter(txn => {
      if (filters.minAmount !== undefined && filters.minAmount !== null && txn.amount < filters.minAmount) return false;
      if (filters.maxAmount !== undefined && filters.maxAmount !== null && txn.amount > filters.maxAmount) return false;
      if (filters.categoryId !== undefined && filters.categoryId !== null && filters.categoryId !== '' && txn.category !== filters.categoryId) return false;
      if (filters.payeeId !== undefined && filters.payeeId !== null && filters.payeeId !== '' && txn.payee !== filters.payeeId) return false;
      return true;
    });

    // return this.transactions.filter(txn => {
    //     if (filters.accountId && txn.accountId !== filters.accountId) return false;
    //     if (filters.startDate && txn.date < filters.startDate) return false;
    //     if (filters.endDate && txn.date > filters.endDate) return false;
    //     if (filters.minAmount !== undefined && filters.minAmount !== null && txn.amount < filters.minAmount) return false;
    //     if (filters.maxAmount !== undefined && filters.maxAmount !== null && txn.amount > filters.maxAmount) return false;
    //     if (filters.categoryId && txn.categoryId !== filters.categoryId) return false;
    //     if (filters.payeeId && txn.payeeId !== filters.payeeId) return false;
    //     return true;
    // });
  }

  async addTransaction (input: {
    accountId: string
    date: string
    amount: number
    payeeName: string
    categoryId?: string | null
    notes?: string | null
  }): Promise<string> {
    await this.ensureReady();
    const payee = this.findOrCreatePayee(input.payeeName);
    const id = randomUUID();
    this.transactions.push({
      id,
      accountId: input.accountId,
      date: input.date,
      amount: input.amount,
      payeeId: payee.id,
      payeeName: payee.name,
      categoryId: input.categoryId ?? null,
      notes: input.notes ?? null
    });
    return id;
  }

  async updateTransaction (transactionId: string, updatedFields: Partial<Transaction>): Promise<boolean> {
    await this.ensureReady();
    const idx = this.transactions.findIndex(t => t.id === transactionId);
    if (idx === -1) {
      throw new Error(`Transaction ${transactionId} not found`);
    }
    this.transactions[idx] = { ...this.transactions[idx], ...updatedFields };
    return true;
  }

  async deleteTransaction (transactionId: string): Promise<boolean> {
    await this.ensureReady();
    const before = this.transactions.length;
    this.transactions = this.transactions.filter(t => t.id !== transactionId);
    return before !== this.transactions.length;
  }

  async getBalanceHistory (accountId: string, startDate: string, endDate: string): Promise<BalanceEntry[]> {
    await this.ensureReady();
    const sorted = (await this.getTransactions({ accountId, startDate, endDate })).sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    const entries: BalanceEntry[] = [];
    let running = this.accounts.find(a => a.id === accountId)?.balance ?? 0;
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
    for (const txn of txns) {
      if (txn.category == null || txn.category === '') continue;
      if (txn.amount >= 0) continue; // expenses only
      spending.set(txn.category, (spending.get(txn.category) ?? 0) + Math.abs(txn.amount));
    }
    return [...spending.entries()].map(([categoryId, total]) => ({
      categoryId,
      categoryName: this.categories.find(c => c.id === categoryId)?.name ?? 'Unknown',
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
    const id = randomUUID();
    this.categories.push({ id, name: categoryName, groupId });
    return id;
  }

  async updateCategory (categoryId: string, update: { newName?: string | null, newGroupId?: string | null }): Promise<boolean> {
    await this.ensureReady();
    const idx = this.categories.findIndex(c => c.id === categoryId);
    if (idx === -1) throw new Error(`Category ${categoryId} not found`);
    const current = this.categories[idx];
    this.categories[idx] = {
      ...current,
      name: update.newName ?? current.name,
      groupId: update.newGroupId ?? current.groupId
    };
    return true;
  }

  async deleteCategory (categoryId: string): Promise<boolean> {
    await this.ensureReady();
    const before = this.categories.length;
    this.categories = this.categories.filter(c => c.id !== categoryId);
    return before !== this.categories.length;
  }

  async getGroupedCategories (): Promise<APICategoryGroupEntity[]> {
    await this.ensureReady();
    return await api.getCategoryGroups();
  }

  async createCategoryGroup (groupName: string, isIncomeGroup: boolean): Promise<string> {
    await this.ensureReady();
    const id = randomUUID();
    this.categoryGroups.push({ id, name: groupName, isIncomeGroup });
    return id;
  }

  async updateCategoryGroup (groupId: string, newName: string): Promise<boolean> {
    await this.ensureReady();
    const idx = this.categoryGroups.findIndex(g => g.id === groupId);
    if (idx === -1) throw new Error(`Category group ${groupId} not found`);
    this.categoryGroups[idx] = { ...this.categoryGroups[idx], name: newName };
    return true;
  }

  async deleteCategoryGroup (groupId: string): Promise<boolean> {
    await this.ensureReady();
    const before = this.categoryGroups.length;
    this.categoryGroups = this.categoryGroups.filter(g => g.id !== groupId);
    this.categories = this.categories.filter(c => c.groupId !== groupId);
    return before !== this.categoryGroups.length;
  }

  async getPayees (): Promise<APIPayeeEntity[]> {
    await this.ensureReady();
    return await api.getPayees();
  }

  async createPayee (payeeName: string, transferAccountId?: string | null): Promise<string> {
    await this.ensureReady();
    const id = randomUUID();
    this.payees.push({ id, name: payeeName, transferAccountId: transferAccountId ?? null });
    return id;
  }

  async updatePayee (payeeId: string, update: { newName?: string | null, newTransferAccountId?: string | null }): Promise<boolean> {
    await this.ensureReady();
    const idx = this.payees.findIndex(p => p.id === payeeId);
    if (idx === -1) throw new Error(`Payee ${payeeId} not found`);
    this.payees[idx] = {
      ...this.payees[idx],
      name: update.newName ?? this.payees[idx].name,
      transferAccountId: update.newTransferAccountId ?? this.payees[idx].transferAccountId
    };
    return true;
  }

  async deletePayee (payeeId: string): Promise<boolean> {
    await this.ensureReady();
    const before = this.payees.length;
    this.payees = this.payees.filter(p => p.id !== payeeId);
    return before !== this.payees.length;
  }

  async getRules (): Promise<RuleEntity[]> {
    await this.ensureReady();
    return await api.getRules();
  }

  async createRule (rule: Rule): Promise<Rule> {
    await this.ensureReady();
    const newRule = { ...rule, id: randomUUID() };
    this.rules.push(newRule);
    return newRule;
  }

  async updateRule (ruleId: string, updatedFields: Partial<Rule>): Promise<Rule> {
    await this.ensureReady();
    const idx = this.rules.findIndex(r => r.id === ruleId);
    if (idx === -1) throw new Error(`Rule ${ruleId} not found`);
    this.rules[idx] = { ...this.rules[idx], ...updatedFields };
    return this.rules[idx];
  }

  async deleteRule (ruleId: string): Promise<boolean> {
    await this.ensureReady();
    const before = this.rules.length;
    this.rules = this.rules.filter(r => r.id !== ruleId);
    return before !== this.rules.length;
  }

  async generateFinancialInsights (): Promise<string> {
    await this.ensureReady();
    // Toy example; replace with real analysis.
    const summary = await this.getMonthlySummary(2025, 12);
    return `Income: ${summary.totalIncome / 100}, Expenses: ${summary.totalExpenses / 100}, Savings: ${summary.netSavings / 100}`;
  }

  async generateBudgetReview (year: number, month: number): Promise<string> {
    await this.ensureReady();
    const summary = await this.getMonthlySummary(year, month);
    return `Review ${year}-${String(month).padStart(2, '0')}: income ${summary.totalIncome / 100}, expenses ${summary.totalExpenses / 100}, savings ${summary.netSavings / 100}`;
  }

  private findOrCreatePayee (name: string): Payee {
    const existing = this.payees.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (existing !== undefined) return existing;
    const id = randomUUID();
    const payee = { id, name };
    this.payees.push(payee);
    return payee;
  }
}

export const createActualClient = (): ActualClient => {
  // In a real implementation, you would pass base URL/token here.
  return new ActualClient();
};
