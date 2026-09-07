import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
});

export const registrationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  password: z
    .string()
    .min(12)
    .max(128)
    .regex(/[a-z]/, "Use a lowercase letter")
    .regex(/[A-Z]/, "Use an uppercase letter")
    .regex(/[0-9]/, "Use a number"),
});

const categoryNames = [
  "Housing",
  "Food",
  "Dining",
  "Transportation",
  "Shopping",
  "Entertainment",
  "Health",
  "Education",
  "Travel",
  "Utilities",
  "Subscriptions",
  "Insurance",
  "Income",
  "Investments",
  "Transfers",
  "Other",
] as const;

export const transactionUpdateSchema = z
  .object({
    category: z.enum(categoryNames).optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    isRecurring: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "No changes provided");

export const entityIdSchema = z.string().trim().min(1).max(100);

export const connectionSessionSchema = z.object({
  connectionId: entityIdSchema.optional(),
});

export const publicTokenExchangeSchema = z.object({
  publicToken: z.string().trim().min(10).max(2_000),
});

const webAuthnResponseSchema = z.object({
  id: z.string().min(1).max(2_048),
  rawId: z.string().min(1).max(2_048),
  response: z.record(z.string(), z.unknown()),
  type: z.literal("public-key"),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
  authenticatorAttachment: z.string().nullable().optional(),
}).passthrough();

export const passkeyRegistrationOptionsSchema = z.object({
  password: z.string().min(8).max(128),
});

export const passkeyRegistrationVerificationSchema = z.object({
  ceremonyToken: z.string().min(32).max(256),
  name: z.string().trim().min(2).max(80),
  response: webAuthnResponseSchema,
});

export const passkeyAuthenticationVerificationSchema = z.object({
  ceremonyToken: z.string().min(32).max(256),
  response: webAuthnResponseSchema,
});

export const passkeyDeleteSchema = z.object({
  password: z.string().min(8).max(128),
});

export const financialDataDeletionSchema = z.object({
  password: z.string().min(8).max(128),
  confirmation: z.literal("DELETE FINANCIAL DATA"),
});

export const accountDeletionSchema = z.object({
  password: z.string().min(8).max(128),
  email: z.string().trim().email().max(254),
  confirmation: z.literal("DELETE ACCOUNT"),
});

export const recurringUpdateSchema = z
  .object({
    status: z.enum(["ACTIVE", "POSSIBLE", "CANCELLED", "IGNORED"]).optional(),
    isSubscription: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "No changes provided");

export const incomeStreamUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    type: z
      .enum([
        "SALARY",
        "FREELANCE",
        "BUSINESS",
        "INTEREST",
        "DIVIDENDS",
        "INVESTMENT_INCOME",
        "RENTAL",
        "OTHER",
      ])
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "No changes provided");

export const goalContributionSchema = z.object({
  amountCents: z.number().int().positive().max(100_000_000_00),
  date: z.string().datetime().optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const assistantQuerySchema = z.object({
  message: z.string().trim().min(2).max(600),
  conversationId: z.string().trim().max(100).optional(),
});

export const goalCreateSchema = z.object({
  type: z.enum(["EMERGENCY_FUND", "CAR", "HOUSE", "VACATION", "EDUCATION", "CUSTOM"]),
  name: z.string().trim().min(2).max(80),
  targetAmountCents: z.number().int().positive().max(100_000_000_00),
  currentAmountCents: z.number().int().min(0).max(100_000_000_00),
  targetDate: z.string().datetime().nullable().optional(),
  linkedAccountId: z.string().trim().min(1).max(100).nullable().optional(),
  monthlyTargetCents: z.number().int().min(0).max(10_000_000_00),
  notes: z.string().trim().max(1000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
