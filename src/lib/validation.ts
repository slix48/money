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
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
