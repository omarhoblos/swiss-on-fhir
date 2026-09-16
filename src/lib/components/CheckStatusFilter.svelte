<script lang="ts">
  import {
    FILTERABLE_STATUSES,
    STATUS_FILTER_LABELS,
    type FilterableStatus,
    type StatusFilter
  } from '$lib/diagnostics/filter';

  /**
   * Status filter for one diagnostics group, shown in its card header.
   *
   * A native <select> on purpose: it is a real dropdown with keyboard and
   * screen-reader behaviour already correct, needs no click-outside or focus
   * trapping, and renders above the card without any stacking-context work.
   *
   * `onChange` rather than `$bindable`, matching HeaderEditor -- binding into
   * an object held in the parent's $state trips no-useless-assignment.
   */
  let {
    value,
    counts,
    label,
    onChange
  }: {
    value: StatusFilter;
    counts: Record<FilterableStatus, number>;
    /** The group title, used to name the control for screen readers. */
    label: string;
    onChange: (next: StatusFilter) => void;
  } = $props();

  const total = $derived(FILTERABLE_STATUSES.reduce((sum, status) => sum + counts[status], 0));
</script>

<select
  class="border-border bg-bg text-fg-muted rounded-md border px-2 py-1 text-xs"
  aria-label="Filter {label} checks by status"
  data-status-filter={label}
  {value}
  onchange={(event) => onChange(event.currentTarget.value as StatusFilter)}
>
  <option value="all">All statuses ({total})</option>
  {#each FILTERABLE_STATUSES as status (status)}
    <option value={status}>{STATUS_FILTER_LABELS[status]} ({counts[status]})</option>
  {/each}
</select>
