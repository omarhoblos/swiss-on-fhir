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
  import { page } from '$app/state';
</script>

<div class="mx-auto max-w-lg py-16 text-center">
  <h1 class="text-primary text-5xl font-semibold">{page.status}</h1>
  <p class="text-fg-muted mt-4">{page.error?.message ?? 'Something went wrong.'}</p>
  <a href="/" class="text-primary mt-8 inline-block text-sm hover:underline">Back to Session</a>
</div>
