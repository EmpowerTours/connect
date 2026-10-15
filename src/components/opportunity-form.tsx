import { REGIONS } from "@/lib/constants";
import { REGION_LABELS, t, type Locale } from "@/lib/i18n";
import { FOCUS_TAGS } from "@/lib/onboarding";
import { DEFAULT_EXPIRY_DAYS, OPP_BODY_MAX, OPP_EXPIRY_DAYS, OPP_HEADLINE_MAX } from "@/lib/opportunities";

export interface OpportunityDefaults {
  kind: string;
  headline: string;
  body: string;
  region: string;
  topic: string;
  orgName: string;
}

/** Fields shared by "new" and "edit". When editing, expiry defaults to keeping the current date. */
export function OpportunityFields({ locale, d, editing = false, showOrg = true }: { locale: Locale; d: OpportunityDefaults; editing?: boolean; showOrg?: boolean }) {
  return (
    <>
      <fieldset>
        <legend className="label">{t(locale, "opps.kind")}</legend>
        <div className="inline-flex rounded-full bg-raised p-1">
          {(["ask", "offer"] as const).map((k) => (
            <label key={k} className="cursor-pointer rounded-full px-4 py-1.5 text-[13px] font-semibold text-faint transition has-[:checked]:bg-white has-[:checked]:text-accent-ink has-[:checked]:shadow-sm">
              <input type="radio" name="kind" value={k} defaultChecked={d.kind === k} className="sr-only" />
              {t(locale, k === "ask" ? "opps.ask" : "opps.offer")}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="label">{t(locale, "opps.headline")}</span>
        <input name="headline" required defaultValue={d.headline} maxLength={OPP_HEADLINE_MAX} className="input" placeholder={t(locale, "opps.headlinePh")} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">{t(locale, "opps.topic")}</span>
          <select name="topic" className="input" defaultValue={d.topic}>
            <option value="">{t(locale, "opps.anyTopic")}</option>
            {FOCUS_TAGS.map((tag) => (
              <option key={tag} value={tag}>{t(locale, `focus.${tag}`)}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">{t(locale, "opps.region")}</span>
          <select name="region" className="input" defaultValue={d.region}>
            <option value="">{t(locale, "opps.anyRegion")}</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>{REGION_LABELS[locale][r]}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="label">{t(locale, "opps.body")}</span>
        <textarea name="body" rows={3} defaultValue={d.body} maxLength={OPP_BODY_MAX} className="input" placeholder={t(locale, "opps.bodyPh")} />
      </label>
      <div className={`grid gap-3 ${showOrg ? "grid-cols-2" : ""}`}>
        {showOrg && (
          <label className="block">
            <span className="label">{t(locale, "opps.org")}</span>
            <input name="orgName" defaultValue={d.orgName} maxLength={80} className="input" />
          </label>
        )}
        <label className="block">
          <span className="label">{t(locale, "opps.expires")}</span>
          <select name="expiresIn" className="input" defaultValue={editing ? "keep" : String(DEFAULT_EXPIRY_DAYS)}>
            {editing && <option value="keep">{t(locale, "opps.keepExpiry")}</option>}
            {OPP_EXPIRY_DAYS.map((n) => (
              <option key={n} value={n}>{t(locale, "opps.inDays").replace("{n}", String(n))}</option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}

const ERROR_KEYS = {
  kind: "opps.err.kind",
  headline_empty: "opps.err.headline_empty",
  headline_long: "opps.err.headline_long",
  body_long: "opps.err.body_long",
  region: "opps.err.region",
  topic: "opps.err.topic",
  expiry: "opps.err.expiry",
  not_owner: "opps.err.not_owner",
  hidden: "opps.err.hidden",
  state: "opps.err.state",
} as const;

/** i18n key for an opportunity validation/lifecycle error code (whitelisted). */
export function opportunityErrorKey(error?: string) {
  return error && Object.hasOwn(ERROR_KEYS, error) ? ERROR_KEYS[error as keyof typeof ERROR_KEYS] : null;
}
