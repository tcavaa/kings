// The one place the table imports Phaser from, so every module shares one copy.
//
// The prebuilt bundle without Matter physics: plain `phaser` resolves to the
// full build, which carries Matter (~110 KB minified) that the table never
// uses. A custom build from phaser/src could drop more (Arcade, tilemaps),
// but needs Phaser's own webpack feature flags defined in the Next build.
import Phaser from "phaser/dist/phaser-arcade-physics.js";

export default Phaser;
