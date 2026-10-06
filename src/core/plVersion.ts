/**
 * PrairieLearn has no semver releases: it deploys continuously from `master`.
 * A PL version is therefore identified by a date (the state of `master` at the
 * end of that UTC day), a full commit sha, or "latest".
 */

export type IsoDate = string; // YYYY-MM-DD
export type PlVersion = "latest" | IsoDate | string; // string: 40-hex commit sha

/**
 * A space-separated conjunction of date comparisons, or "*".
 * e.g. ">=2023-05-01 <2025-04-17"
 */
export type VersionRange = string;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const shaPattern = /^[0-9a-f]{40}$/;
const comparatorPattern = /^(>=|<=|>|<|=)?(\d{4}-\d{2}-\d{2})$/;

function isIsoDate(s: string): boolean {
  return datePattern.test(s) && !Number.isNaN(Date.parse(s));
}

export function isCommitSha(s: string): boolean {
  return shaPattern.test(s);
}

/** Returns an error message if `s` is not a valid PL version. */
export function validatePlVersion(s: unknown): string | undefined {
  if (typeof s !== "string") {
    return "plVersion must be a string";
  }
  if (s === "latest" || isIsoDate(s) || isCommitSha(s)) {
    return undefined;
  }
  return `invalid plVersion "${s}": expected "latest", a date (YYYY-MM-DD), or a 40-character commit sha`;
}

export function today(): IsoDate {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The date used to select version-ranged rules. A sha's commit date is not
 * known offline, so a pinned sha selects rules as if it were current.
 */
export function versionDate(version: PlVersion): IsoDate {
  return isIsoDate(version) ? version : today();
}

/** Whether `date` satisfies every comparator in `range`. */
export function matchesRange(range: VersionRange, date: IsoDate): boolean {
  const parts = range.trim().split(/\s+/);
  return parts.every((part) => {
    if (part === "*") {
      return true;
    }
    const m = comparatorPattern.exec(part);
    if (!m) {
      throw new Error(`invalid version range "${range}"`);
    }
    const [, op = "=", bound] = m;
    // ISO dates compare correctly as strings
    switch (op) {
      case ">=":
        return date >= bound;
      case "<=":
        return date <= bound;
      case ">":
        return date > bound;
      case "<":
        return date < bound;
      default:
        return date === bound;
    }
  });
}
