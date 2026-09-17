# Security Policy

## Supported versions

ATC has not published a stable release. Security fixes currently target the default branch.

## Reporting a vulnerability

Please use GitHub private vulnerability reporting when enabled. Do not open a public issue containing exploit details, credentials, source code, or personal data.

## Security boundary

ATC coordinates agents; it does not grant them new execution capabilities. Coordination APIs must not expose arbitrary remote command execution. Shared events are metadata-only by default.

