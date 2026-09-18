<script lang="ts">
  import { copyToClipboard } from '$lib/clipboard';

  /**
   * The one copy button, so every card header carries the same control.
   *
   * `value` may be a function for anything costly or sensitive to compute, so
   * it is only built when someone actually clicks.
   */
  let { value, label = 'Copy' }: { value: string | (() => string); label?: string } = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy(event: MouseEvent) {
    // These sit inside <summary> headers: without this, copying would also
    // open or close the section.
    event.preventDefault();
    event.stopPropagation();
    copied = await copyToClipboard(typeof value === 'function' ? value() : value);
    clearTimeout(timer);
    timer = setTimeout(() => (copied = false), 1600);
  }
</script>

<button
  type="button"
  class="bg-primary shrink-0 rounded px-2 py-1 font-sans text-xs font-medium text-white"
  onclick={copy}
>
  {copied ? 'Copied' : label}
</button>
