import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const baseUrl = process.env.MONEYOS_URL ?? "http://127.0.0.1:3000";
const artifacts = new URL("../artifacts/", import.meta.url);
await mkdir(artifacts, { recursive: true });
const artifactPath = (name) => fileURLToPath(new URL(name, artifacts));
const executablePath =
  process.env.PLAYWRIGHT_EXECUTABLE_PATH ??
  (process.platform === "win32"
    ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    : undefined);

const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : { channel: "chrome" }),
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  colorScheme: "light",
  reducedMotion: "reduce",
});
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.message));

const report = {
  baseUrl,
  routes: [],
  desktop: {},
  mobile: {},
  interactions: {},
  consoleErrors,
  pageErrors,
};

async function pageHealth(label) {
  await page.waitForLoadState("domcontentloaded");
  await page.locator("h1").first().waitFor({ state: "visible" });
  const result = await page.evaluate(() => ({
    title: document.querySelector("h1")?.textContent?.trim() ?? "",
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.getBoundingClientRect().width,
    appError: document.body.textContent?.includes("Application error") ?? false,
  }));
  if (result.appError) throw new Error(`${label} rendered an application error`);
  if (result.scrollWidth > result.viewportWidth + 1) {
    throw new Error(`${label} overflows horizontally: ${result.scrollWidth} > ${result.viewportWidth}`);
  }
  return result;
}

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/overview");
  report.interactions.login = "passed";

  await page.locator(".chart-container svg.recharts-surface").first().waitFor({ state: "visible" });
  const chartAudit = await page.locator(".chart-container svg.recharts-surface").evaluateAll((charts) =>
    charts.map((chart) => {
      const rect = chart.getBoundingClientRect();
      return { width: rect.width, height: rect.height, marks: chart.querySelectorAll("path, rect, line").length };
    }),
  );
  const renderedCharts = chartAudit.filter((chart) => chart.width >= 100 && chart.height >= 100);
  if (renderedCharts.length < 2 || renderedCharts.some((chart) => chart.marks < 3)) {
    throw new Error(`Overview chart audit failed: ${JSON.stringify(chartAudit)}`);
  }
  const chartAlternatives = await page.locator('.accessible-chart[role="img"]').evaluateAll(
    (charts) => charts.map((chart) => chart.getAttribute("aria-label")),
  );
  if (chartAlternatives.length < 2 || chartAlternatives.some((label) => !label || label.length < 20)) {
    throw new Error("Overview charts are missing useful accessible summaries");
  }
  report.desktop.overview = await pageHealth("overview desktop");
  report.desktop.charts = renderedCharts;
  report.desktop.chartAlternatives = chartAlternatives.length;
  await page.screenshot({ path: artifactPath("overview-desktop.png"), fullPage: true });

  const routes = [
    "/transactions",
    "/income",
    "/recurring",
    "/investments",
    "/goals",
    "/cash-flow",
    "/changes",
    "/ai",
    "/settings",
  ];
  for (const route of routes) {
    await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
    report.routes.push({ route, ...(await pageHealth(route)) });
  }
  const demoConnection = page.getByText("MoneyOS Demo Provider", { exact: true }).first();
  await demoConnection.waitFor({ state: "visible" });
  const demoConnectButton = page.getByRole("button", { name: "Connect account" });
  if (!(await demoConnectButton.isDisabled())) {
    throw new Error("Demo mode must not allow a real financial connection");
  }
  report.interactions.demoConnectionBoundary = "passed";
  await page.screenshot({ path: artifactPath("settings-connected-accounts.png"), fullPage: true });

  await page.goto(`${baseUrl}/transactions`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  const search = page.getByLabel("Search transactions");
  await search.fill("Nobu");
  const filteredRows = await page.locator("tbody tr").count();
  if (filteredRows !== 1) throw new Error(`Expected one Nobu transaction, found ${filteredRows}`);
  await page.locator("tbody tr").first().click();
  await page.getByRole("dialog", { name: "Transaction details" }).waitFor({ state: "visible" });
  await page.getByLabel("Notes").fill("Verified by visual smoke test");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Transaction updated").waitFor({ state: "visible" });
  report.interactions.transactionEdit = "passed";
  await page.screenshot({ path: artifactPath("transaction-drawer.png"), fullPage: true });

  await page.goto(`${baseUrl}/goals`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Add a financial goal" }).click();
  const goalDialog = page.getByRole("dialog", { name: "Create financial goal" });
  const goalName = `Visual QA goal ${Date.now()}`;
  await goalDialog.getByLabel("Name").fill(goalName);
  await goalDialog.getByLabel("Target amount").fill("1000");
  await goalDialog.getByLabel("Current amount").fill("100");
  await goalDialog.getByLabel("Monthly target").fill("100");
  await goalDialog.getByRole("button", { name: "Create goal" }).click();
  await page.getByRole("heading", { name: goalName }).waitFor({ state: "visible" });
  report.interactions.goalCreation = "passed";

  await page.goto(`${baseUrl}/ai`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "How much did I spend eating out?" }).click();
  await page.getByText(/You spent \$356\.70 on dining this month/).waitFor({ state: "visible" });
  await page.getByText("getSpendingByCategory", { exact: true }).first().waitFor({ state: "visible" });
  report.interactions.aiGrounding = "passed";
  await page.screenshot({ path: artifactPath("ai-grounded-answer.png"), fullPage: true });

  await page.goto(baseUrl + "/recurring", { waitUntil: "domcontentloaded" });
  await page.getByText(/External cancellation is not available in V1/).waitFor({ state: "visible" });
  const recurringStatus = page.getByLabel("Status for Streambox");
  await recurringStatus.selectOption("CANCELLED");
  await page.waitForFunction(() => {
    const control = document.querySelector('[aria-label="Status for Streambox"]');
    return control instanceof HTMLSelectElement && control.value === "CANCELLED";
  });
  await recurringStatus.selectOption("ACTIVE");
  report.interactions.actionBoundary = "passed";
  report.interactions.recurringUpdate = "passed";

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/overview`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  report.mobile.overview = await pageHealth("overview mobile");
  await page.locator(".chart-container svg.recharts-surface").first().waitFor({ state: "visible" });
  const mobileChartAudit = await page.locator(".chart-container svg.recharts-surface").evaluateAll((charts) =>
    charts.map((chart) => {
      const rect = chart.getBoundingClientRect();
      return { width: rect.width, height: rect.height, marks: chart.querySelectorAll("path, rect, line").length };
    }),
  );
  const renderedMobileCharts = mobileChartAudit.filter((chart) => chart.width >= 100 && chart.height >= 100);
  if (renderedMobileCharts.length < 2 || renderedMobileCharts.some((chart) => chart.marks < 3)) {
    throw new Error(`Mobile chart audit failed: ${JSON.stringify(mobileChartAudit)}`);
  }
  report.mobile.charts = renderedMobileCharts;
  await page.screenshot({ path: artifactPath("overview-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Open navigation" }).click();
  const mobileNavigation = page.getByRole("dialog", { name: "Navigation" });
  await mobileNavigation.waitFor({ state: "visible" });
  report.interactions.mobileNavigation = "passed";
  await page.screenshot({ path: artifactPath("mobile-navigation.png") });
  await mobileNavigation.locator("aside.mobile-nav-panel").getByRole("button", { name: "Close navigation" }).click();
  const mobileRoutes = [
    "/transactions",
    "/recurring",
    "/investments",
    "/goals",
    "/ai",
    "/settings",
  ];
  for (const route of mobileRoutes) {
    await page.goto(baseUrl + route, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    report.mobile[route.slice(1)] = await pageHealth(route + " mobile");
  }
  await page.goto(baseUrl + "/overview", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await page.locator("html.dark").waitFor({ state: "attached" });
  report.interactions.darkMode = "passed";
  await page.screenshot({ path: artifactPath("overview-mobile-dark.png"), fullPage: true });

  if (consoleErrors.length || pageErrors.length) {
    throw new Error(
      "Browser errors detected: " +
        JSON.stringify({ consoleErrors, pageErrors }),
    );
  }
  await writeFile(new URL("visual-report.json", artifacts), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}
