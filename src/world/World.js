import { Heightfield } from './Heightfield.js';
import { Terrain } from './Terrain.js';
import { buildRoads } from './RoadMesh.js';
import { Colliders } from './Colliders.js';
import { Props } from './Props.js';
import { Scenery } from './Scenery.js';
import { Environment } from './Environment.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Builds the whole island. Reports progress through onProgress(fraction, label). */
export class World {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
  }

  async build(onProgress = () => {}) {
    onProgress(0.02, 'Shaping the island');
    await tick();
    this.hf = new Heightfield();
    this.hf.build();
    onProgress(0.35, 'Paving the roads');
    await tick();
    this.colliders = new Colliders();
    this.env = new Environment(this.renderer, this.scene);
    this.terrain = new Terrain(this.hf, this.scene);
    onProgress(0.5, 'Laying asphalt');
    await tick();
    this.roads = buildRoads(this.hf, this.scene, this.colliders);
    onProgress(0.6, 'Planting forests');
    await tick();
    this.props = new Props(this.scene, this.colliders, this.hf);
    this.scenery = new Scenery(this.hf, this.scene, this.colliders, this.props);
    this.scenery.build();
    onProgress(0.8, 'Building the festival');
    await tick();
    this.terrain.prewarm({ x: 0, z: 0 });
    onProgress(0.9, 'Drawing the map');
    await tick();
    this.mapImage = this.terrain.makeMapImage(1024);
    onProgress(1, 'Ready');
  }

  update(dt, focus, time) {
    this.terrain.update(focus);
    this.props.update(dt, focus);
    this.scenery.update(time);
    this.env.update(dt, focus);
    const night = this.env.nightAmount;
    this.props.setNight(night);
    this.scenery.setNight(night);
  }

  setSeason(season) {
    this.terrain.setSeason(season);
    this.props.setSeasonTint(season);
    this.mapImage = this.terrain.makeMapImage(1024);
  }
}
