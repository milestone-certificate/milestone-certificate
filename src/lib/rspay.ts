import { z } from "zod";

export const rspayMethods = ["bkash", "nagad", "rocket", "upay"] as const;
export const paymentAmount = z
  .number()
  .finite()
  .positive()
  .max(1_000_000)
  .refine(
    (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.000001,
    "Use at most two decimal places",
  );
export const rspayEventSchema = z
  .object({
    status: z.enum(["COMPLETED", "PENDING", "FAILED"]),
    transaction_id: z.string().min(1).max(128),
    short_code: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    amount: paymentAmount,
    method: z.enum(rspayMethods),
    user_identyfy_address: z.string().min(3).max(254),
    checkout_items: z.object({ orderId: z.string().uuid() }),
    sender_number: z.string().max(30).optional(),
  })
  .refine(
    (e) =>
      e.status !== "COMPLETED" || !["INVALID", "PENDING_VERIFICATION"].includes(e.transaction_id),
  );
export type RspayEvent = z.infer<typeof rspayEventSchema>;

export function paymentStatusLabel(status: string | null): string {
  switch (status) {
    case "COMPLETED":
      return "ব্যালেন্স যোগ হয়েছে";
    case "FAILED":
      return "পেমেন্ট ব্যর্থ";
    case "LINK_FAILED":
      return "পেমেন্ট শুরু হয়নি";
    case "CREATING":
      return "পেমেন্ট তৈরি হচ্ছে";
    case "VERIFYING":
      return "পেমেন্ট যাচাই চলছে";
    default:
      return "পেমেন্ট অপেক্ষমাণ";
  }
}
