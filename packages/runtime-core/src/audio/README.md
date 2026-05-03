# Runtime Audio

Owns target-agnostic sound intent for Sugarmagic. This module resolves authored
sound cues, event bindings, region emitters, and mixer state into
`RuntimeSoundCommand`s. It never imports browser audio APIs or Howler; target
packages translate these commands into platform playback.
