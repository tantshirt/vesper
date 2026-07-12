- source_spec: `_bmad-output/admin/implementation-artifacts/spec-property-first-admin-experience.md`
  summary: Replace capped admin overview scans with indexed pagination before the property portfolio grows beyond the MVP.
  evidence: The pre-existing overview read model applies fixed `take(...)` limits before filtering actionable records; at larger scale, completed rows could consume the cap and hide older unresolved work.
