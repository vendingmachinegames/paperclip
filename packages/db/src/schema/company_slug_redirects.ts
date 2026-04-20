import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const companySlugRedirects = pgTable(
  "company_slug_redirects",
  {
    oldSlug: text("old_slug").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    retiredAt: timestamp("retired_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("company_slug_redirects_company_idx").on(table.companyId),
  }),
);
