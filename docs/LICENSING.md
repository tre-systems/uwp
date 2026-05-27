# Licensing Guardrails

This is an engineering planning note, not legal advice.

## Working Position

UWP is a procedural generator for original 2d6 science-fiction worlds. It can
support Cepheus-compatible play, but public wording, sample data, generated
exports, screenshots, and examples should not imply affiliation with third-party
publishers, rightsholders, settings, or brands.

## Current Boundaries

- Application code is covered by the repository software licence.
- Generated worlds are intended to be original user/project output.
- UWP-style codes, trade-code helpers, and world-generation procedures must
  keep any Cepheus SRD provenance and notices visible where relevant.
- Do not bundle third-party sectors, maps, names, species, ships,
  organizations, or lore without explicit permission.

## Public Release Checklist

- [ ] Keep the About modal's legal/non-affiliation note visible.
- [ ] Keep sample subsectors/worlds original.
- [ ] If adding SRD text or tables, add OGL/CSL notices beside the feature or
      in a dedicated legal page.
- [ ] Keep generated exports free of protected third-party setting content
      unless the user supplies it privately.
- [ ] Run `npm run ip:check` before release and before any history rewrite.

## Primary References

- [Cepheus Engine SRD legal page](https://cepheus-srd.opengamingnetwork.com/cepheus-engine-srd/cepheus-engine-legal/)
