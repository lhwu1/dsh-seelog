import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/host/web.d.ts
/** Plugin config limiting the read-only graph materialized for one browser request. */
interface Config {
  /** Maximum number of lineage sessions represented by one snapshot. */
  maxSessions: number;
  /** Maximum tail events retained for any one session. */
  maxEventsPerSession: number;
}
/** Validated deployment limits for the snapshot endpoint. */
declare const Config: z<Config>;
/** Stable Cordis plugin name. */
declare const name = "dsh-seelog-web";
/** Services required to read durable events and publish the local web route. */
declare const inject: string[];
/** Mount the same-origin endpoint serving a frozen topology-aware log projection. */
declare function apply(ctx: Context, config: Config): void;
//#endregion
export { Config, apply, inject, name };
//# sourceMappingURL=web.d.mts.map