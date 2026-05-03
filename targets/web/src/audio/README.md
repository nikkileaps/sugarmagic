# Web Audio Adapter

Owns browser playback for runtime audio commands. This is the only production
place in Sugarmagic that imports Howler. Runtime-core resolves authored sound
intent into target-agnostic commands; this adapter loads audio blob URLs,
handles browser unlock, applies mixer volume, panning, fades, loops, and
session teardown.
