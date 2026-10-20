# Third-party notices

## Farcaster (hub-monorepo, contracts)

Parts of the following files are adapted from Farcaster's MIT-licensed code
(https://github.com/farcasterxyz/hub-monorepo, https://github.com/farcasterxyz/contracts):

- `src/lib/protocol/message-rules.ts` (from `packages/core/src/validations.ts`)
- `contracts/src/ConnectKeyRegistry.sol`, `contracts/src/ConnectGateway.sol`: the
  per-ID key cap and the signed key request (which app asked for a key), from
  `src/KeyRegistry.sol` and `src/validators/SignedKeyRequestValidator.sol`

Both repositories use the same MIT license text:

The MIT License (MIT)

Copyright (c) 2020-2025 Merkle Manufactory and others (hub-monorepo)
Copyright (c) 2020-2024 Merkle Manufactory and others (contracts)

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
