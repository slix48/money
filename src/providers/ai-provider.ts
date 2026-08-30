import type { FinancialToolName } from "@/ai/tool-registry";

export interface AIProviderTool {
  name: FinancialToolName;
  description: string;
  inputSchema: unknown;
}

export interface AIProviderPlanRequest {
  question: string;
  availableTools: AIProviderTool[];
}

export interface AIProviderPlannedCall {
  name: FinancialToolName;
  input: Record<string, unknown>;
}

export interface AIProviderPlan {
  calls: AIProviderPlannedCall[];
  explanation?: string;
}

export interface AIProviderAnswerRequest {
  question: string;
  toolResults: Array<{
    tool: FinancialToolName;
    data: unknown;
  }>;
  instruction: string;
}

export interface AIProvider {
  readonly id: string;
  plan(request: AIProviderPlanRequest): Promise<AIProviderPlan>;
  formatAnswer(request: AIProviderAnswerRequest): Promise<string>;
}

// Provider output is untrusted. The application must revalidate every planned
// call against the allowlisted registry and never expose mutation capabilities.
