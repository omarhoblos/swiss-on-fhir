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
  import { session } from '#lib/auth/session.svelte.ts';
  import { storedLaunchTypes } from '#lib/auth/storage.ts';
  import { config } from '#lib/config/config.svelte.ts';
  import { switchEnvironment } from '#lib/environments/switch.ts';
  import { LAUNCH_TYPES, type Environment, type LaunchType } from '#lib/environments/types.ts';
  import ChevronDown from '#lib/icons/ChevronDown.svelte';

  /**
   * Switches this tab's environment, from the nav on every page.
   *
   * An ARIA menu of radio items, grouped by where each environment comes
   * from. Each row shows the launch type the environment opens with and a
   * dot for each session it holds (standalone, EHR, Backend Services), so a
   * parked sign-in is visible before switching back to it. Keyboard: Arrow
   * keys, Home and End move, Enter chooses, Escape closes.
   */
  const uid = $props.id();
  let open = $state(false);
  let root = $state<HTMLElement>();
  let button = $state<HTMLButtonElement>();
  /** Held slots of the other environments, read from storage when the menu opens. */
  let held = $state<Record<string, LaunchType[]>>({});

  const TYPE_LABELS: Record<LaunchType, string> = {
    standalone: 'Standalone',
    ehr: 'EHR',
    'backend-services': 'Backend'
  };

  const groups = $derived(
    [
      {
        label: 'This deployment',
        environments: config.environments.filter((e) => e.origin !== 'browser')
      },
      {
        label: 'This browser',
        environments: config.environments.filter((e) => e.origin === 'browser')
      }
    ].filter((group) => group.environments.length > 0)
  );

  function heldFor(env: Environment): LaunchType[] {
    return env.id === config.activeEnvironmentId ? session.heldSlots : (held[env.id] ?? []);
  }

  function defaultTypeOf(env: Environment): LaunchType {
    return config.effectiveFor(env.id)?.defaultLaunchType ?? 'standalone';
  }

  function items(): HTMLElement[] {
    return root ? [...root.querySelectorAll<HTMLElement>('[role^="menuitem"]')] : [];
  }

  function show() {
    held = Object.fromEntries(config.environments.map((e) => [e.id, storedLaunchTypes(e.id)]));
    open = true;
    queueMicrotask(() => {
      const all = items();
      (all.find((item) => item.getAttribute('aria-checked') === 'true') ?? all[0])?.focus();
    });
  }

  function close(returnFocus: boolean) {
    open = false;
    if (returnFocus) button?.focus();
  }

  function choose(envId: string) {
    close(true);
    switchEnvironment(envId);
  }

  function onMenuKey(event: KeyboardEvent) {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      all[(to + all.length) % all.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(all.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') close(false);
  }

  $effect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root && !root.contains(event.target as Node)) close(false);
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  });
</script>

{#snippet dots(slots: LaunchType[])}
  <span class="flex shrink-0 items-center gap-0.5" aria-hidden="true">
    {#each LAUNCH_TYPES as launchType (launchType)}
      <span
        class="inline-block size-1.5 rounded-full {slots.includes(launchType)
          ? 'bg-success'
          : 'border-border-control border'}"
      ></span>
    {/each}
  </span>
{/snippet}

<div class="relative" bind:this={root}>
  <button
    bind:this={button}
    type="button"
    data-testid="environment-picker"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls="{uid}-menu"
    aria-label={`Environment: ${config.activeEnvironment.name}`}
    onclick={() => (open ? close(false) : show())}
    onkeydown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        show();
      }
    }}
    class="border-border-control text-fg-muted hover:text-fg flex max-w-44 items-center gap-1.5 rounded border px-2 py-1 text-xs sm:max-w-60"
  >
    <span class="truncate">{config.activeEnvironment.name}</span>
    {@render dots(session.heldSlots)}
    <ChevronDown class="h-3 w-3 shrink-0" />
  </button>
  {#if open}
    <div
      id="{uid}-menu"
      role="menu"
      aria-label="Environments"
      tabindex="-1"
      onkeydown={onMenuKey}
      class="bg-surface border-border absolute top-full right-0 z-50 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-md border py-1 shadow-lg"
    >
      {#each groups as group (group.label)}
        <div role="group" aria-label={group.label} class="py-1">
          <p
            class="text-fg-muted px-3 pb-1 text-[10px] tracking-wider uppercase"
            aria-hidden="true"
          >
            {group.label}
          </p>
          {#each group.environments as env (env.id)}
            {@const slots = heldFor(env)}
            <button
              type="button"
              role="menuitemradio"
              aria-checked={env.id === config.activeEnvironmentId}
              tabindex="-1"
              data-environment={env.id}
              onclick={() => choose(env.id)}
              class="hover:bg-surface-2 focus:bg-surface-2 flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs
                {env.id === config.activeEnvironmentId ? 'text-primary font-medium' : ''}"
            >
              <span class="w-3 shrink-0" aria-hidden="true"
                >{env.id === config.activeEnvironmentId ? '✓' : ''}</span
              >
              <span class="min-w-0 flex-1 truncate">{env.name}</span>
              <span
                class="border-border-control text-fg-muted shrink-0 rounded border px-1 text-[10px]"
              >
                {TYPE_LABELS[defaultTypeOf(env)]}
              </span>
              {@render dots(slots)}
              <span class="sr-only">
                {slots.length === 0
                  ? 'no sessions'
                  : `sessions: ${slots.map((s) => TYPE_LABELS[s]).join(', ')}`}
              </span>
            </button>
          {/each}
        </div>
      {/each}
      <div class="border-border mt-1 border-t pt-1">
        <a
          href="/config#environments"
          role="menuitem"
          tabindex="-1"
          onclick={() => close(false)}
          class="text-primary hover:bg-surface-2 focus:bg-surface-2 block px-3 py-1.5 text-xs"
        >
          Manage environments&hellip;
        </a>
      </div>
    </div>
  {/if}
</div>
