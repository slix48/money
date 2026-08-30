"use client";

import { format } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";

const tooltipStyle = {
  background: "var(--surface-raised)",
  border: "1px solid var(--border)",
  borderRadius: "5px",
  boxShadow: "var(--shadow)",
  color: "var(--text)",
  fontSize: "11px",
};

const axisStyle = { fill: "var(--text-tertiary)", fontSize: 10 };

function ChartFrame({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="accessible-chart" role="img" aria-label={label}>
      {children}
    </div>
  );
}

export function NetWorthChart({
  data,
}: {
  data: Array<{
    date: Date;
    netWorthCents: number;
    cashCents: number;
    investmentsCents: number;
  }>;
}) {
  const chartData = data.map((item) => ({ ...item, label: format(item.date, "MMM") }));
  const accessibleLabel =
    "Net worth and cash history. " +
    chartData
      .map(
        (item) =>
          item.label +
          ": net worth " +
          formatCurrency(item.netWorthCents) +
          ", cash " +
          formatCurrency(item.cashCents),
      )
      .join("; ");
  return (
    <ChartFrame label={accessibleLabel}>
      <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 12, right: 14, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={false} />
        <YAxis
          tick={axisStyle}
          tickLine={false}
          axisLine={false}
          width={54}
          tickFormatter={(value) => formatCompactCurrency(Number(value))}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name) => [formatCurrency(Number(value)), String(name)]}
          labelStyle={{ color: "var(--text-secondary)", marginBottom: 4 }}
        />
        <Line
          type="monotone"
          dataKey="netWorthCents"
          name="Net worth"
          stroke="var(--chart-1)"
          strokeWidth={2.2}
          dot={false}
          activeDot={{ r: 4, fill: "var(--chart-1)" }}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="cashCents"
          name="Cash"
          stroke="var(--chart-3)"
          strokeWidth={1.4}
          strokeDasharray="4 4"
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function MonthlyCashChart({
  data,
}: {
  data: Array<{
    date: Date;
    incomeCents: number;
    spendingCents: number;
    savingsCents: number;
  }>;
}) {
  const chartData = data.map((item) => ({ ...item, label: format(item.date, "MMM") }));
  const accessibleLabel =
    "Monthly income and spending. " +
    chartData
      .map(
        (item) =>
          item.label +
          ": income " +
          formatCurrency(item.incomeCents) +
          ", spending " +
          formatCurrency(item.spendingCents),
      )
      .join("; ");
  return (
    <ChartFrame label={accessibleLabel}>
      <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 12, right: 14, left: 4, bottom: 0 }} barGap={4}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={false} />
        <YAxis
          tick={axisStyle}
          tickLine={false}
          axisLine={false}
          width={50}
          tickFormatter={(value) => formatCompactCurrency(Number(value))}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name) => [formatCurrency(Number(value)), String(name)]}
          labelStyle={{ color: "var(--text-secondary)", marginBottom: 4 }}
        />
        <Legend wrapperStyle={{ color: "var(--text-secondary)", fontSize: 10, paddingTop: 8 }} />
        <Bar dataKey="incomeCents" name="Income" fill="var(--chart-1)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="spendingCents" name="Spending" fill="var(--chart-4)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function ValueTrendChart<T extends { date: Date }>({
  data,
  valueKey,
  label,
  color = "var(--chart-1)",
}: {
  data: T[];
  valueKey: string;
  label: string;
  color?: string;
}) {
  const chartData = data.map((item) => ({
    ...item,
    label: format(item.date, "MMM"),
  }));
  const accessibleLabel =
    label +
    " history. " +
    chartData
      .map(
        (item) =>
          item.label +
          ": " +
          formatCurrency(
            Number((item as Record<string, unknown>)[valueKey] ?? 0),
          ),
      )
      .join("; ");
  return (
    <ChartFrame label={accessibleLabel}>
      <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 12, right: 14, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={false} />
        <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={50} tickFormatter={(value) => formatCompactCurrency(Number(value))} />
        <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatCurrency(Number(value)), label]} />
        <Line type="monotone" dataKey={valueKey} name={label} stroke={color} strokeWidth={2.1} dot={false} isAnimationActive={false} />
      </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--violet)",
];

export function DonutChart({
  data,
}: {
  data: Array<{ name: string; valueCents: number }>;
}) {
  const accessibleLabel =
    "Allocation. " +
    data
      .map((item) => item.name + ": " + formatCurrency(item.valueCents))
      .join("; ");
  return (
    <ChartFrame label={accessibleLabel}>
      <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, _name, item) => [formatCurrency(Number(value)), String(item.payload.name)]}
        />
        <Pie
          data={data}
          dataKey="valueCents"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius="58%"
          outerRadius="82%"
          paddingAngle={1.5}
          stroke="var(--surface)"
          strokeWidth={2}
          isAnimationActive={false}
        >
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
          ))}
        </Pie>
      </PieChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
