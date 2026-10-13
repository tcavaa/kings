// The one place the table imports Phaser from, so every module shares one copy.
//
// A custom build from Phaser's source (phaser/src, as its custom-build docs
// describe) holding only what the table uses: the game loop, scenes, scale
// manager, both renderers, textures and canvas textures, the image and SVG
// loaders, input, tweens, timers, cameras, and the Graphics, Text, Image,
// Container and Rectangle objects. No physics, tilemaps, particles, sound
// (the shuffle is a plain <audio>, lib/shuffleSound.js) or other objects.
//
// It relies on Phaser's build flags (`typeof WEBGL_RENDERER` and friends),
// which next.config.mjs defines for both bundlers. Using something new from
// Phaser? Import it here: a scene.add.* or this.load.* method only exists
// once its factory or file type below has registered it.

// Scene plugins. Phaser looks them up by name when it boots a scene and
// silently skips the ones it can't find, so each must be imported.
import "phaser/src/events/EventEmitter.js";
import "phaser/src/cameras/2d/CameraManager.js";
import "phaser/src/gameobjects/GameObjectCreator.js";
import "phaser/src/gameobjects/GameObjectFactory.js";
import "phaser/src/gameobjects/DisplayList.js";
import "phaser/src/gameobjects/UpdateList.js";
import "phaser/src/scene/ScenePlugin.js";
import "phaser/src/time/Clock.js"; // this.time
import "phaser/src/data/DataManagerPlugin.js";
import "phaser/src/input/InputPlugin.js"; // this.input, pointer events
import "phaser/src/loader/LoaderPlugin.js"; // this.load
import "phaser/src/tweens/TweenManager.js"; // this.tweens

// Game objects: each factory/creator adds its scene.add.* / scene.make.* method.
import "phaser/src/gameobjects/container/ContainerFactory.js";
import "phaser/src/gameobjects/graphics/GraphicsFactory.js";
import "phaser/src/gameobjects/image/ImageFactory.js";
import "phaser/src/gameobjects/shape/rectangle/RectangleFactory.js";
import "phaser/src/gameobjects/text/TextFactory.js";
import "phaser/src/gameobjects/text/TextCreator.js";

// Loader file types: this.load.image and this.load.svg.
import "phaser/src/loader/filetypes/ImageFile.js";
import "phaser/src/loader/filetypes/SVGFile.js";

import CONST from "phaser/src/const.js";
import Game from "phaser/src/core/Game.js";
import Scene from "phaser/src/scene/Scene.js";
import Scenes from "phaser/src/scene/index.js";
import Scale from "phaser/src/scale/index.js";
import Between from "phaser/src/math/Between.js";

// The slice of the Phaser namespace the table uses (Phaser.AUTO,
// Phaser.Game, Phaser.Scene, Phaser.Scenes.Events, Phaser.Scale.FIT…).
const Phaser = {
  ...CONST,
  Game,
  Scene,
  Scenes,
  Scale,
  Math: { Between },
};

export default Phaser;
