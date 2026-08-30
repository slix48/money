# MoneyOS Financial Calculations

This document is the accounting contract for V1. Application logic calculates financial values; UI and AI layers only present structured results from src/domain/calculations.ts.

## Units And Classification

- Domain services use integer USD cents.
- PostgreSQL stores monetary values as Decimal(19,4) major currency units. Repository adapters convert at the boundary with explicit rounding to cents.
- A transaction type is authoritative for reporting. The amount sign alone never turns a transfer into income or a card payment into spending.
- Date ranges are inclusive.
- Pending transactions remain visible but are excluded from all settled totals.
- V1 does not convert currencies. A multi-currency total must not be shown until an explicit FX methodology exists.

## Income

Only settled transactions classified as INCOME with a positive amount are income.

~~~text
income = sum(positive settled INCOME transactions)
~~~

TRANSFER, REFUND, DEBT_PAYMENT, INVESTMENT_CONTRIBUTION, INVESTMENT_ACTIVITY, EXPENSE, and ADJUSTMENT records are excluded. Investment withdrawals are not income. Income streams are grouped by merchant/payer and income type. Recurring, side, and investment-income subtotals are descriptive subsets of total income.

## Spending And Refunds

Settled EXPENSE records add their absolute amount. Settled REFUND records subtract their absolute amount.

~~~text
net spending = max(0, sum(abs(EXPENSE)) - sum(abs(REFUND)))
~~~

Refunds remain signed within category and merchant groups. MoneyOS sums signed groups before applying the final zero floor; flooring each category independently would overstate spending when a refund exceeds purchases in one category.

Refund accuracy depends on classification. Providers should match a refund to its original transaction/category where reliable. Otherwise users can correct the category without changing preserved raw provider text.

## Transfers And Credit Cards

- Internal transfers never count as income or spending.
- A paired transfer has a source account and linked owned destination account.
- Transfers into savings are reported as a cash-savings allocation, not as new income.
- Credit-card purchases are EXPENSE records when they settle.
- A payment to the card is DEBT_PAYMENT or TRANSFER, never another expense.
- Debt payments are shown separately from consumption so the underlying purchase is not counted twice.

Provider ingestion must classify and pair these records before financial summaries are considered reconciled.

## Cash Flow And Savings

The period summary uses:

~~~text
retained savings = income - net spending - debt payments
savings rate = retained savings / income
~~~

Retained savings answers how much settled income was not consumed or used for debt payments. Investment contributions and transfers into savings are allocations of that retained amount, not additional expenses.

Money Flow then explains the allocation:

~~~text
cash remaining =
  income
  - necessities
  - wants
  - other spending
  - debt payments
  - transfers into savings
  - investment contributions
~~~

A negative cash-remaining value is shown as a cash-flow gap. Transfers between owned accounts do not change total retained savings.

## Net Worth

Accounts with isLiability=true are liabilities even when a provider supplies a positive balance. Negative account balances are also treated as liabilities.

~~~text
assets = cash + investments + other assets
liabilities = absolute value of tracked debt balances
net worth = assets - liabilities
~~~

Cash includes checking, savings, and cash accounts. Investments include brokerage and retirement accounts. Historical charts use stored NetWorthSnapshot records and do not reconstruct the past from current balances.

## Portfolio Value And Allocation

For each position:

~~~text
market value = tracked current value
average cost basis = total cost basis / quantity
unrealized gain or loss = market value - total cost basis
portfolio weight = market value / total portfolio value
~~~

Portfolio concentration reports the largest position, top-five weight, individual-stock weight, and cash weight. These are descriptive analytics, not recommendations.

Cash positions have zero market gain. When a provider omits cash cost basis, MoneyOS uses current cash value as the effective basis for aggregate return calculations rather than reporting the cash balance as appreciation.

Demo prices are delayed mock values and are always labeled as such. MoneyOS never describes them as live.

## Contributions And Investment Performance

Contributions and withdrawals are external cash flows. They are never market performance.

~~~text
contributions = sum(abs(CONTRIBUTION))
withdrawals = sum(abs(WITHDRAWAL))
dividend income = sum(abs(DIVIDEND))
interest income = sum(abs(INTEREST))
fees = explicit fees + abs(FEE activity)

realized gain or loss = sum(recorded realized gain on sales)
unrealized gain or loss = current holdings value - current holdings cost basis
investment gain or loss = realized + unrealized - fees
tracked total return = investment gain or loss + dividends + interest
~~~

If any sale lacks realized cost-basis data, realized gain and aggregate performance are unavailable. If a non-cash holding lacks reliable cost basis, unrealized gain and aggregate performance are unavailable. The UI must say so; it must not substitute zero or infer cost basis.

V1 does not claim time-weighted or money-weighted return. Price/value history is a balance series and is labeled as such.

Selected-period investment activity can report contributions, withdrawals, realized gains with supplied basis, dividends, interest, and fees. Aggregate period gain remains unavailable until opening portfolio valuations exist; MoneyOS never combines period activity with current all-time unrealized gain.

## Goals

~~~text
progress = min(1, current amount / target amount)
remaining = max(0, target amount - current amount)
average contribution = total contributions / elapsed calendar months since the first contribution
months remaining = ceil(remaining / contribution pace)
~~~

Contribution history is the preferred pace and includes zero-contribution months through the calculation date. The configured monthly target is used only when history is absent. Goal scenarios assume zero return unless the user explicitly selects and sees another assumption. No return is promised.

## Recurring Detection

Detection groups settled expenses by user, account, and normalized merchant. It evaluates:

- repeated history with at least two observations
- median interval and supported weekly, biweekly, monthly, quarterly, semiannual, or annual cadence
- amount variation no greater than 35 percent
- cadence deviation and interval consistency

Two or low-confidence observations remain POSSIBLE. Stronger histories can become ACTIVE. Next-charge estimates use the detected cadence. Annualized cost uses average observed amount multiplied by cadence.

A price increase is material when it is at least 1 USD and at least 3 percent. Annual impact uses the detected billing frequency. Confidence is evidence, not certainty.

## Period Comparisons And Insights

Category and merchant changes below 20 USD are omitted from comparisons. What Changed keeps only material findings, ranks them by financial impact, and limits output. The attention center caps repeated bill-change alerts so one issue type cannot crowd out income, investment, goal, or net-worth signals.

## Verification

src/domain/calculations.test.ts covers income exclusions, refunds, pending records, transfers, credit-card payments, liabilities, cash flow, portfolio allocation, contributions, withdrawals, fees, dividends, missing cost basis, goals, recurring cadence, and price changes. src/ai/tool-registry.test.ts verifies that displayed receipts match the underlying structured calculations.
