# Build Audio Workspace

This module provides the Build > Audio workspace. It authors reusable
`SoundCueDefinition` records in the content library: category, clip selection,
playback mode, volume/pitch, fades, event bindings, mixer values, and audition
controls.

Raw audio clips are managed in Library > Audio. Region application sites such
as emitters and ambience zones are placed from Build > Layout against
`RegionDocument.audio`. The workspace can audition cues through editor preview
audio, but runtime playback remains enforced by `packages/runtime-core/src/audio`
and realized by target adapters such as `targets/web/src/audio`.
