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

// Applies the saved theme before first paint so there is no light flash on
// load. Loaded as a blocking script in <head>, which runs before <body>
// exists -- hence the `:root.light-theme, body.light-theme` selector pair in
// app.css. Uses the same `themeSelected` key and light/dark values as the
// Angular app, so existing users keep their preference.
//
// A file rather than an inline script so the Content-Security-Policy can be
// `script-src 'self'` with no inline allowance; see kit.csp in
// svelte.config.js.
try {
  var t = localStorage.getItem('themeSelected');
  if (!t) t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  if (t === 'light') document.documentElement.classList.add('light-theme');
} catch (e) {
  /* localStorage unavailable (private mode, partitioned iframe): keep the dark default */
}
