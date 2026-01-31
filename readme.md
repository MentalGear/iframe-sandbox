# iFrame Sandbox

The goal is to have an iFrame that can display content from an untrusted source, but have the main window safe from attacks.

- network requests made by the untrusted source in the iFrame should be interceptable
- the iframe hosting the untrusted code must never be able to run arbitrary code on the main window, directly or indirectly

- use tests to verify your approach !