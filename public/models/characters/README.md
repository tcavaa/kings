# Temporary character cast

Source: [Kenney — Mini Characters](https://kenney.nl/assets/mini-characters), version 1.0.
License: CC0; the original license is included in `LICENSE.txt`.
Downloaded directly from the publisher on 2026-10-14. Three female and three male
GLB models (variants a/b/c), with the publisher's shared colormap texture.
Original model files are unchanged. The runtime adjusts head proportions and
poses their existing skeletons for the table. These stylized placeholders are
not exact replicas of the concept-art characters.

The set includes sitting, idle, interaction, and other animation clips. Only the
seated clip and procedural head/arm/card movement are currently used by KING.

Custom heads or full characters can be selected from the in-game Characters
panel. These overrides are stored in IndexedDB on the current browser only;
other players keep the default cast. To replace the shipped cast for everyone,
change the URLs in `src/online/game/three/characters.js` and provide the assets
under `public/models/characters/`.
