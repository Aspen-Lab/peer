// Single source of the version string the UI shows.
//
// The sidebar used to hardcode "v0.1.0" while public/CHANGELOG.md had reached
// v0.7.22 — twenty-two minor releases of drift, because the string lived in
// JSX. Bump this in the same commit as the CHANGELOG entry.
export const APP_VERSION = "0.11.0";
