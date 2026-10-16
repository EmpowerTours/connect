# Security policy

## Reporting a vulnerability
Please report security problems privately to **admin@empowertours.xyz**. Do not open a public GitHub issue for them.

Include what you found, steps to reproduce, and the impact you expect. We aim to acknowledge reports within 3 business days and will keep you updated until the issue is fixed. We are happy to credit you once a fix is released, if you would like.

## Scope
- This repository and the reference deployment at `https://connect.empowertours.xyz`.
- Of particular interest: passkey sign-in and session handling (`src/lib/mera/`), authorization of server actions and API routes, the signed graph (`src/lib/graph/`), uploads, and rate limiting.

Please do not run denial-of-service tests, social engineering, or automated scans that degrade the service, and do not access data that is not yours.

## Supported versions
Only the latest `main` branch is supported.
