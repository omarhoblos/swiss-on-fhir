<!--
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
-->

<script lang="ts">
  import { addRockets, createShow, step, type Show } from '$lib/fireworks';
  import { konamiDetector } from '$lib/konami';

  /**
   * An easter egg: the Konami Code sets off fireworks over the page. Keys
   * typed into a field do not count, so it never goes off while someone is
   * writing a query. The canvas lets clicks through, is hidden from assistive
   * technology, and exists only while a show runs. Typing the code again
   * mid-show adds another round. Nothing happens for anyone who asked for
   * reduced motion.
   */
  const detect = konamiDetector();
  const COLOR_TOKENS = [
    '--color-primary',
    '--color-secondary',
    '--color-warning',
    '--color-info',
    '--color-error',
    '--color-success'
  ];

  let canvas = $state<HTMLCanvasElement>();
  let show = $state.raw<Show | null>(null);

  function isTyping(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLElement &&
      (target.isContentEditable || target.matches('input, textarea, select'))
    );
  }

  /** The theme's colours, read when the show starts so it matches light or dark. */
  function colors(): string[] {
    const style = getComputedStyle(document.documentElement);
    return COLOR_TOKENS.map((token) => style.getPropertyValue(token).trim()).filter(Boolean);
  }

  function launch() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (show) addRockets(show, colors());
    else show = createShow(innerWidth, innerHeight, colors());
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.repeat || isTyping(event.target)) return;
    if (detect(event.key)) launch();
  }

  // Runs the show once the canvas exists, and removes it when the last spark fades.
  $effect(() => {
    const running = show;
    const context = canvas?.getContext('2d');
    if (!running || !canvas || !context) return;

    const ratio = devicePixelRatio || 1;
    canvas.width = running.width * ratio;
    canvas.height = running.height * ratio;
    context.scale(ratio, ratio);

    let frame = 0;
    let last = performance.now();
    const draw = (now: number) => {
      // Capped, so a backgrounded tab does not resume with one huge step.
      const dt = Math.min((now - last) / 1000, 1 / 20);
      last = now;
      const alive = step(running, dt);
      context.clearRect(0, 0, running.width, running.height);
      // Each spark is a short streak back along its path, longer for rockets.
      context.lineCap = 'round';
      for (const spark of running.sparks) {
        const tail = spark.rocket ? 0.06 : 0.035;
        context.globalAlpha = Math.max(spark.life, 0);
        context.strokeStyle = spark.color;
        context.lineWidth = spark.rocket ? 3 : 2.5;
        context.beginPath();
        context.moveTo(spark.x - spark.vx * tail, spark.y - spark.vy * tail);
        context.lineTo(spark.x, spark.y);
        context.stroke();
      }
      if (alive) frame = requestAnimationFrame(draw);
      else show = null;
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  });
</script>

<svelte:window {onkeydown} />

{#if show}
  <canvas
    bind:this={canvas}
    data-testid="fireworks"
    aria-hidden="true"
    class="pointer-events-none fixed inset-0 z-50 h-full w-full"
  ></canvas>
{/if}
