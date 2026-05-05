# Fireflies Plugin

Fireflies is a generic mechanics mini-game plugin. It listens for authored
mechanics emit events, opens a small pattern-recognition puzzle, and dispatches
authored castables on success or failure.

The plugin does not know what the castables do. A project can use the same
plugin to award focus, unlock evidence, advance a quest, or mutate any other
mechanic it has authored.

## Configuration

Enable the plugin through the project `pluginConfigurations` list:

```json
{
  "pluginId": "fireflies",
  "enabled": true,
  "config": {
    "triggers": [
      {
        "emitKind": "open-focus-puzzle",
        "difficulty": "medium",
        "onSuccess": {
          "id": "gain-focus",
          "args": { "amount": 25 }
        }
      }
    ]
  }
}
```

Each trigger maps one mechanics emit kind to one puzzle configuration. When the
player solves the puzzle, `onSuccess` is dispatched through the runtime
castable executor. If the player fails or abandons the puzzle, `onFail` is
dispatched when configured.

## Runtime Boundary

Fireflies uses only the public `mechanics.emitHandler` seam:

- `context.mountRoot` for its DOM overlay.
- `context.claimInput` and `context.releaseInput` while the modal puzzle is open.
- `context.dispatchCastable` to return authored outcomes to the engine.

The plugin does not import game code, does not register JavaScript callbacks
from a project, and does not mutate stats directly.
