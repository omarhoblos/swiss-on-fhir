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

import { describe, expect, it } from 'vitest';
import { addRockets, createShow, step } from './fireworks';

/** A repeatable stand-in for Math.random. */
function seeded(seed = 1): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

const COLORS = ['#bb86fc', '#03dac6', '#e6a23c'];

/** Runs a show to its end, recording what happened. */
function run(show = createShow(1280, 800, COLORS, seeded()), random = seeded(2)) {
  let seconds = 0;
  let maxSparks = 0;
  let highestBurst = Infinity;
  while (step(show, 1 / 60, random)) {
    seconds += 1 / 60;
    maxSparks = Math.max(maxSparks, show.sparks.filter((s) => !s.rocket).length);
    for (const s of show.sparks) if (!s.rocket) highestBurst = Math.min(highestBurst, s.y);
    if (seconds > 30) break;
  }
  return { seconds, maxSparks, highestBurst, show };
}

describe('fireworks', () => {
  it('launches every rocket, bursts them, and ends within a few seconds', () => {
    const { seconds, maxSparks, show } = run();
    expect(show.pending).toHaveLength(0);
    expect(show.sparks).toHaveLength(0);
    expect(maxSparks).toBeGreaterThan(60);
    expect(seconds).toBeGreaterThan(1.5);
    expect(seconds).toBeLessThan(6);
  });

  it('bursts in the top part of the screen, never above it', () => {
    const { highestBurst } = run();
    expect(highestBurst).toBeGreaterThan(0);
    expect(highestBurst).toBeLessThan(800 * 0.6);
  });

  it('uses the colours it was given', () => {
    const show = createShow(1280, 800, COLORS, seeded());
    const seen = new Set<string>();
    const random = seeded(3);
    while (step(show, 1 / 60, random)) for (const s of show.sparks) seen.add(s.color);
    expect([...seen].sort()).toEqual([...COLORS].sort());
  });

  it('takes another round while a show is running', () => {
    const show = createShow(1280, 800, COLORS, seeded(), 2);
    const random = seeded(4);
    for (let i = 0; i < 30; i++) step(show, 1 / 60, random);
    addRockets(show, COLORS, seeded(5), 3);
    expect(show.pending.length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...show.pending.map((p) => p.at))).toBeGreaterThanOrEqual(show.time);
    const { show: done } = run(show, random);
    expect(done.pending).toHaveLength(0);
  });
});
