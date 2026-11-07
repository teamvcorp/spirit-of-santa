// Lets TypeScript understand `import logo from "../assets/logo.svg"` (Next turns it into { src, width, height }).
// The apps get the same types from their next-env.d.ts; this package type-checks on its own, so it needs them too.
/// <reference types="next/image-types/global" />
