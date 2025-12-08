export interface Account {
  id: string
  name: string
  balance: number
}

export interface Transaction {
  id: string
  accountId: string
  date: string // YYYY-MM-DD
  amount: number // positive = income, negative = expense
  payeeId?: string | null
  payeeName?: string | null
  categoryId?: string | null
  notes?: string | null
}

export interface BalanceEntry {
  date: string
  balance: number
}

export interface Category {
  id: string
  name: string
  groupId: string
}

export interface CategoryGroup {
  id: string
  name: string
  isIncomeGroup: boolean
}

export interface Payee {
  id: string
  name: string
  transferAccountId?: string | null
}

export interface Rule {
  id: string
  name?: string
  conditions: Record<string, unknown>
  actions: Record<string, unknown>
}

export interface CategorySpending {
  categoryId: string
  categoryName: string
  total: number
}

export interface MonthlySummary {
  totalIncome: number
  totalExpenses: number
  netSavings: number
  savingsRate: number
}
