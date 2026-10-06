/*
 Copyright 2021 Omar Hoblos

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/

/**
 * The fireworks the Konami Code sets off, as plain state and a step
 * function, so the physics runs (and is tested) without a canvas.
 *
 * A show is a few rockets launched in turn. Each climbs from the bottom of
 * the screen, slowing as it goes, and bursts into sparks at the top of its
 * climb; the sparks fall, drag to a halt and fade. The show is over once the
 * last spark has faded.
 */

export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  /** 1 when lit, falling to 0. */
  life: number;
  /** How much life a spark loses per second. */
  fade: number;
  /** True while it is still a rocket that has not burst. */
  rocket: boolean;
}

export interface Show {
  sparks: Spark[];
  /** Rockets still to launch, by the show time they go up at. */
  pending: { at: number; x: number; color: string }[];
  time: number;
  width: number;
  height: number;
}

// Rockets fall back hard so they reach the top of their climb in about a
// second; sparks fall gently, so a burst hangs in the air.
const ROCKET_GRAVITY = 900; // px/s²
const SPARK_GRAVITY = 150; // px/s²
const DRAG = 1.6; // per second, on sparks
const SPARKS_PER_BURST = 60;
/** Used only if no colours are given. */
const FALLBACK_COLOR = '#ffffff';

export function createShow(
  width: number,
  height: number,
  colors: readonly string[],
  random: () => number = Math.random,
  rockets = 6
): Show {
  const pending = Array.from({ length: rockets }, (_, i) => ({
    at: i * 0.22 + random() * 0.12,
    x: width * (0.15 + random() * 0.7),
    color: colors[i % colors.length] ?? FALLBACK_COLOR
  }));
  return { sparks: [], pending, time: 0, width, height };
}

/** Adds another round of rockets to a show already running. */
export function addRockets(
  show: Show,
  colors: readonly string[],
  random: () => number = Math.random,
  rockets = 6
): void {
  const more = createShow(show.width, show.height, colors, random, rockets).pending;
  show.pending.push(...more.map((rocket) => ({ ...rocket, at: rocket.at + show.time })));
  show.pending.sort((a, b) => a.at - b.at);
}

function burst(at: Spark, random: () => number): Spark[] {
  return Array.from({ length: SPARKS_PER_BURST }, (_, i) => {
    const angle = (i / SPARKS_PER_BURST) * Math.PI * 2 + random() * 0.2;
    const speed = 90 + random() * 170;
    return {
      x: at.x,
      y: at.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: at.color,
      life: 1,
      fade: 0.55 + random() * 0.35,
      rocket: false
    };
  });
}

/**
 * Advances the show by `dt` seconds. Returns false once nothing is left to
 * draw or launch.
 */
export function step(show: Show, dt: number, random: () => number = Math.random): boolean {
  show.time += dt;

  for (let rocket = show.pending[0]; rocket && rocket.at <= show.time; rocket = show.pending[0]) {
    show.pending.shift();
    // Fast enough to climb to between a fifth and a half of the way down.
    const climb = show.height * (0.5 + random() * 0.3);
    show.sparks.push({
      x: rocket.x,
      y: show.height,
      vx: (random() - 0.5) * 60,
      vy: -Math.sqrt(2 * ROCKET_GRAVITY * climb),
      color: rocket.color,
      life: 1,
      fade: 0,
      rocket: true
    });
  }

  const next: Spark[] = [];
  for (const spark of show.sparks) {
    spark.vy += (spark.rocket ? ROCKET_GRAVITY : SPARK_GRAVITY) * dt;
    if (spark.rocket) {
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      // A rocket bursts at the top of its climb.
      if (spark.vy >= 0) next.push(...burst(spark, random));
      else next.push(spark);
      continue;
    }
    const drag = Math.exp(-DRAG * dt);
    spark.vx *= drag;
    spark.vy *= drag;
    spark.x += spark.vx * dt;
    spark.y += spark.vy * dt;
    spark.life -= spark.fade * dt;
    if (spark.life > 0) next.push(spark);
  }
  show.sparks = next;

  return show.sparks.length > 0 || show.pending.length > 0;
}
