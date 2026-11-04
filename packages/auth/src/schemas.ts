/** Input schemas (Next-free, unit-testable). */
import { z } from "zod";

/** Parent PIN: 4–6 digits. Re-validated on the server for every attempt. */
export const pinSchema = z
  .string()
  .regex(/^\d{4,6}$/, "PIN must be 4–6 digits");
