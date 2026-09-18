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

import { redirect } from '@sveltejs/kit';

/**
 * An EHR launch lands wherever the EHR was told Swiss lives, and the bare
 * origin is the natural thing to register. Only /launch reads `iss` and
 * `launch`, so forward them there with the query intact rather than showing
 * the Session page and silently dropping the launch.
 */
export function load({ url }) {
  if (url.searchParams.has('iss') || url.searchParams.has('launch')) {
    redirect(307, `/launch${url.search}`);
  }
}
