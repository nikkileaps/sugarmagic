# Runtime-Core Shader

This module is the shared runtime shader boundary.

- resolves authored shader bindings into effective runtime bindings
- compiles canonical shader graph documents into platform-agnostic IR
- does **not** finalize materials or own GPU lifecycle

Target hosts consume this IR through their own `ShaderRuntime` enforcers.
