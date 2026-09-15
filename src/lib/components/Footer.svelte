<script lang="ts">
  // Version comes from kit.version.name in svelte.config.js, which reads
  // package.json at build time. Replaces the old deep relative import of
  // package.json (and the resolveJsonModule flag it required).
  import { version } from '$app/environment';
  import Heart from '$lib/icons/Heart.svelte';
  import Github from '$lib/icons/Github.svelte';
  import Linkedin from '$lib/icons/Linkedin.svelte';
</script>

<footer class="border-border text-fg-muted mt-16 border-t py-10 text-center text-sm">
  <p class="flex items-center justify-center gap-1.5">
    <span>Made with</span>
    <Heart class="text-error h-4 w-4" />
    <span>by Omar Hoblos</span>
  </p>
  <div class="mt-3 flex items-center justify-center gap-4">
    <a
      href="https://github.com/omarhoblos"
      target="_blank"
      rel="noopener noreferrer"
      class="hover:text-fg transition-colors"
      aria-label="GitHub"
    >
      <Github />
    </a>
    <a
      href="https://www.linkedin.com/in/omar-hoblos-5a7aa653/"
      target="_blank"
      rel="noopener noreferrer"
      class="hover:text-fg transition-colors"
      aria-label="LinkedIn"
    >
      <Linkedin />
    </a>
  </div>
  <p class="mt-3 font-mono text-xs">Version {version}</p>
</footer>
