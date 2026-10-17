# Dependency security review

## Braces stack exhaustion advisory

Reviewed October 17, 2026. The installed development dependency chain is:

```text
eslint-config-next@16.4.0
└─ @next/eslint-plugin-next@16.4.0
   └─ fast-glob@3.3.1
      └─ micromatch@4.0.8
         └─ braces@3.0.3
```

GitHub's reviewed advisory [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) (CVE-2026-93687) rates uncontrolled recursion depth in `braces` as high severity. Its affected range is `<=3.0.3`; it currently lists no patched version. The issue is a stack exhaustion denial of service from deeply nested brace patterns.

The upstream fix proposal adds a nesting-depth bound, but no released upstream package containing that patch was identified. The installed transitive constraints permit `braces` 3.x, but an npm override to an unreleased fork would not be an upstream-supported or verified fix. Updating the direct lint packages alone cannot establish remediation while the supported `micromatch` chain resolves the affected `braces` version. No dependency or lockfile change was made, and no Next.js downgrade was attempted.

## Audit access and limitation

`npm audit` and `npm audit --omit=dev` could not retrieve registry advisories during this review because DNS resolution for `registry.npmjs.org` failed (`ENOTFOUND`). Thus the prior report of five high-severity findings and zero production findings could not be independently refreshed from npm in this environment. Re-run both commands when registry access is available. The affected development dependency remains installed until an upstream patched release becomes available and can be verified.
