import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// Story 5.4 — the scheduled overdue-update flag. Once a day, scan every property and write an
// append-only `propertyUpdate.overdue` audit entry for any property overdue for the current-period
// update (idempotent per property per period; see `updates.flagOverdueUpdates`). This is the honest
// minimal "flag" absent notification infrastructure — the user-facing calm note is driven independently
// by `updates.summary.overdue`. A cron always references its target via the `internal` object.
const crons = cronJobs();

crons.daily(
  "flag overdue property updates",
  { hourUTC: 8, minuteUTC: 0 },
  internal.updates.flagOverdueUpdates,
);

export default crons;
