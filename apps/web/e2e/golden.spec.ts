/*
 * Copyright 2026 Darkcollective, LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { test, openApp, expectOutput } from "./fixtures";

// The RECIPES section 12.5 golden fragment (the same one packages/worker/scripts/gate2-browser.mjs bakes).
const GOLDEN =
  "v=1&r=1bY2xDgIhEAX_5dU0F43F_oqx2IP1jggsYTGaEP7dWBqvmW5mBu7aNgEtDtalGug68IglgKAV7gvCyiaXMwXxGgQOlRtnAw1wqjuv0kGwziVwC5jTHTR8YrPoOVHT_tvI-iwdtJyOzV3eJOVv7dkEhKQvaXAIkmKOXRoIRYtgztv8AA&i=0VlhKNWVXSXNJRXBpWlhseElRPT0&ie=utf8";

test("the golden share fragment bakes to the expected bytes", async ({ page }) => {
  await openApp(page, "#" + GOLDEN);
  await expectOutput(page, "48656c6c6f2c20576f726c6421");
});
