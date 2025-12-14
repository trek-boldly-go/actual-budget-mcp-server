export interface BalanceEntry {
  date: string
  balance: number
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
